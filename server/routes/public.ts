// Public, code-based API (SPEC §10.1): start a group, join with a team code, read and
// write the worksheet, live stream, presence, summary and Excel export.

import { z } from 'zod';
import { formatTeamCode, isWorkshopCode } from '../../shared/codes.js';
import { teamLabel } from '../../shared/countries.js';
import { buildSummary, summaryMarkdown, summaryText } from '../../shared/summary.js';
import { progressPct, type Worksheet } from '../../shared/worksheet.js';
import { activeContentVersion, getContent } from '../content-store.js';
import { badRequest, forbidden, notFound, requireGroup, type Ctx, type GroupClaims } from '../context.js';
import { groupWorkbook } from '../export-xlsx.js';
import { eventGroups, findEventByCode, formatEventCode, idleCloseAt, TEAM_IDENTITY_PATHS } from '../events.js';
import { applyPatch, createGroup, findByCode, getGroup, GroupError, lastSubmission, submitGroup, type GroupRow } from '../groups.js';
import { openSse, sseFrame } from '../realtime.js';

/** Practice groups are deleted 24 hours after they start (the sweep); their code works until then. */
export const PRACTICE_HOURS = 24;
const practiceExpiry = (start: Date) => new Date(new Date(start).getTime() + PRACTICE_HOURS * 3_600_000);

const GROUP_TOKEN_TTL = '12h';

/** Tracks failed code attempts per IP: 20 failures in 10 minutes locks that IP out (SPEC §11). */
export class Lockout {
  private fails = new Map<string, number[]>();
  constructor(private max = 20, private windowMs = 10 * 60_000) {}
  private recent(key: string) {
    const now = Date.now();
    const list = (this.fails.get(key) ?? []).filter((t) => now - t < this.windowMs);
    // Forget keys with no recent failures, so lots of one-off keys can't fill memory.
    if (list.length) this.fails.set(key, list); else this.fails.delete(key);
    return list;
  }
  locked(key: string) { return this.recent(key).length >= this.max; }
  fail(key: string) {
    const list = this.recent(key);
    list.push(Date.now());
    this.fails.set(key, list);
    // Drop expired entries now and then.
    if (this.fails.size > 10_000) for (const k of [...this.fails.keys()]) this.recent(k);
  }
  clear(key: string) { this.fails.delete(key); }
  /** Recent failures for a key. */
  count(key: string) { return this.recent(key).length; }
}

/**
 * The key failures are counted under: the address, or its /64 for IPv6, since one IPv6
 * connection usually controls a whole /64 and could otherwise rotate addresses freely.
 */
export function addressKey(ip: string): string {
  if (!ip.includes(':') || ip.startsWith('::ffff:')) return ip.replace(/^::ffff:/, '');
  const full = ip.includes('::')
    ? (() => { const [a, b] = ip.split('::'); const l = a ? a.split(':') : []; const r = b ? b.split(':') : []; return [...l, ...Array(8 - l.length - r.length).fill('0'), ...r]; })()
    : ip.split(':');
  return `${full.slice(0, 4).join(':')}::/64`;
}

/**
 * Personal names on the Team step. Team codes spread (slides, printed cards, chat), so once a
 * group has closed, people reading it with a team code no longer see them. Owners and staff do.
 */
const PERSONAL_PATHS = ['members', 'buddies'] as const;
export function forCodeReader(g: GroupRow & { worksheet: Worksheet }, user: GroupClaims) {
  if (g.state !== 'closed' || user.ro) return { worksheet: g.worksheet, hidden: [] as string[] };
  const worksheet = { ...g.worksheet };
  const hidden = PERSONAL_PATHS.filter((p) => p in worksheet);
  for (const p of PERSONAL_PATHS) delete worksheet[p];
  return { worksheet, hidden };
}

export const groupSummary = (g: GroupRow) => ({
  id: g.id,
  teamCode: formatTeamCode(g.team_code),
  name: g.name,
  country: g.country,
  state: g.state,
  eventId: g.event_id,
  startsAt: g.starts_at,
  endsAt: g.ends_at,
  contentVersion: g.content_version,
  practice: g.practice === true,
  /** Practice groups: when they are deleted (24 hours after they started). */
  expiresAt: g.practice && g.starts_at ? practiceExpiry(g.starts_at) : null,
});

/** Only practice groups are started from the home page; facilitators set up every other team. */
const startBody = z.object({ practice: z.literal(true) });
const joinBody = z.object({
  /** A team code, or a workshop code together with the team picked from its list. */
  teamCode: z.string().max(40),
  groupId: z.uuid().optional(),
  /** One name, or several on one line ("Ana, Ben, Mere"). */
  displayName: z.string().trim().max(200).nullish(),
});
const presenceBody = z.object({
  clientId: z.string().min(1).max(64),
  step: z.number().int().min(0).max(7),
});
const streamQuery = z.object({
  clientId: z.string().min(1).max(64),
  step: z.coerce.number().int().min(0).max(7).default(0),
});
const patchBody = z.object({
  clientId: z.string().max(64).optional(),
  ops: z
    .array(z.object({
      path: z.string().max(80),
      value: z.union([z.string(), z.boolean(), z.null()]),
      baseVersion: z.number().int().min(0),
    }))
    .min(1)
    .max(200),
});

export function publicRoutes(ctx: Ctx) {
  const { app, db, hub } = ctx;
  // Generous, because a whole workshop room usually shares one internet address (venue Wi-Fi).
  const lockout = new Lockout(100, 10 * 60_000);
  // Across all addresses: wrong codes from many places at once look like guessing, so pause
  // code checks for everyone for a while rather than let a large network keep trying.
  const allLookups = new Lockout(2000, 10 * 60_000);
  const failCode = (ip: string) => {
    lockout.fail(addressKey(ip));
    allLookups.fail('all');
    if (allLookups.count('all') === 2000) app.log.warn('Many wrong team or workshop codes from many addresses: code checks paused for 10 minutes.');
  };
  const codeLocked = (ip: string) => lockout.locked(addressKey(ip)) || allLookups.locked('all');
  // Live streams: per team (members and viewers) and per address (a venue shares one).
  const MAX_STREAMS_PER_GROUP = 60;
  const MAX_STREAMS_PER_ADDRESS = 400;
  const streamsByAddress = new Map<string, number>();
  // One submission at a time per team: each stores a full copy of the answers.
  const lastSubmit = new Map<string, number>();
  const SUBMIT_GAP_MS = ctx.config.submitGapMs ?? 20_000;
  // Practice groups are throwaway, so cap them per address (on top of the general rate limit)
  // to stop anyone filling the database with them. Real workshop groups are not affected.
  const practiceCap = new Lockout(30, 60 * 60_000);

  return async (api: typeof app) => {
    api.get('/health', async () => ({ ok: true }));

    // Start a practice group ("Just exploring"). Every other team is set up by a facilitator.
    api.post('/groups', ctx.limited, async (req, reply) => {
      const body = startBody.safeParse(req.body);
      if (!body.success) return badRequest(reply, 'Teams are set up by facilitators. Ask yours for a workshop or team code.');
      // Opens straight away; its code can be shared until it is deleted 24 hours later.
      {
        if (practiceCap.locked(req.ip)) return reply.code(429).send({ error: 'rate_limited', message: 'Too many practice groups from here. Try again later, or start a real group.' });
        practiceCap.fail(req.ip);
        const contentVersion = await activeContentVersion(db);
        if (!contentVersion) throw new Error('No active content version.');
        const g = await createGroup(db, { name: '', contentVersion, practice: true });
        return reply.code(201).send({
          groupId: g.id,
          teamCode: formatTeamCode(g.teamCode),
          joinUrl: `${ctx.origin(req)}/join/${formatTeamCode(g.teamCode)}`,
          expiresAt: practiceExpiry(new Date()),
          practice: true,
          groupToken: app.jwt.sign({ scope: 'group', gid: g.id, name: null, gen: 0 }, { expiresIn: GROUP_TOKEN_TTL }),
        });
      }
    });

    // What a code opens: a workshop (its teams, to pick one) or a team. Wrong codes count
    // towards the same lockout as joining.
    api.post('/lookup', ctx.limited, async (req, reply) => {
      const ip = req.ip;
      if (codeLocked(ip)) return reply.code(429).send({ error: 'locked', message: 'Too many attempts. Wait a few minutes, then try again.' });
      const body = z.object({ code: z.string().max(40) }).safeParse(req.body);
      const raw = body.success ? body.data.code : '';
      if (isWorkshopCode(raw)) {
        const ev = await findEventByCode(db, raw);
        if (ev) {
          const teams = (await eventGroups(db, ev.id)).filter((g) => g.link_status === null || g.link_status === 'approved');
          return {
            kind: 'workshop',
            workshop: { name: ev.name, code: formatEventCode(ev.code), state: ev.state, startsAt: ev.starts_at },
            teams: teams.map((g) => ({ id: g.id, label: teamLabel(g.worksheet) || g.name || 'Team', state: g.state })),
          };
        }
      } else {
        const g = await findByCode(db, raw);
        const expired = g?.practice && (!g.starts_at || practiceExpiry(g.starts_at).getTime() <= Date.now());
        if (g && !expired) return { kind: 'team', team: { label: g.practice ? null : g.country || g.name, practice: g.practice } };
      }
      failCode(ip);
      return notFound(reply, "We can't find that code. Check it with your facilitator.");
    });

    // Exchange a team code (or a workshop code and the picked team) for a group-scoped token (FR-J1, FR-J2).
    api.post('/join', ctx.limited, async (req, reply) => {
      const ip = req.ip;
      if (codeLocked(ip)) return reply.code(429).send({ error: 'locked', message: 'Too many attempts. Wait a few minutes, then try again.' });
      const body = joinBody.safeParse(req.body);
      let g: GroupRow | null = null;
      if (body.success && isWorkshopCode(body.data.teamCode)) {
        // Workshop code: the team must be one of that workshop's teams.
        const ev = await findEventByCode(db, body.data.teamCode);
        const picked = ev && body.data.groupId ? await getGroup(db, body.data.groupId) : null;
        const visible = picked && (await eventGroups(db, ev!.id)).some((x) => x.id === picked.id && (x.link_status === null || x.link_status === 'approved'));
        g = visible ? picked : null;
      } else if (body.success) {
        g = await findByCode(db, body.data.teamCode);
      }
      // A practice group's code works until it is deleted, 24 hours after it started.
      const expired = g?.practice && (!g.starts_at || practiceExpiry(g.starts_at).getTime() <= Date.now());
      if (!body.success || !g || expired) {
        failCode(ip);
        return notFound(reply, "We can't find that code. Check it with your group or facilitator.");
      }
      if (g.state === 'draft') {
        return reply.code(403).send({ error: 'not_open', message: 'Not open yet.', startsAt: g.starts_at });
      }
      // A team code stops opening a group some time after it closed (SPEC §4.4 X4).
      const closedLongAgo = g.state === 'closed' && g.closed_at
        && g.closed_at.getTime() < Date.now() - ctx.config.codeReadDays * 86_400_000;
      if (closedLongAgo) {
        return reply.code(403).send({ error: 'archived', message: 'This group is closed. Ask the owner or facilitator for the summary.' });
      }
      const groupToken = app.jwt.sign(
        { scope: 'group', gid: g.id, name: body.data.displayName || null, gen: g.code_gen },
        { expiresIn: GROUP_TOKEN_TTL },
      );
      return { groupToken, group: groupSummary(g), readOnly: g.state !== 'open' };
    });

    // Renews a member's sign-in while the group is open (SPEC §4.4 X5).
    api.post('/groups/:id/token', { ...ctx.limited, preHandler: requireGroup }, async (req, reply) => {
      const user = req.user as GroupClaims;
      if (user.ro) return forbidden(reply, 'This is a read-only view.');
      const g = await getGroup(db, user.gid);
      if (!g) return notFound(reply, 'Group not found.');
      if (g.state !== 'open') return reply.code(409).send({ error: 'closed', message: 'The group is closed.' });
      return { groupToken: app.jwt.sign({ scope: 'group', gid: g.id, name: user.name ?? null, gen: g.code_gen }, { expiresIn: GROUP_TOKEN_TTL }) };
    });

    api.get('/groups/:id/worksheet', { preHandler: requireGroup }, async (req, reply) => {
      const g = await getGroup(db, (req.params as { id: string }).id);
      if (!g) return notFound(reply, 'Group not found.');
      const { worksheet, hidden } = forCodeReader(g, req.user as GroupClaims);
      return {
        group: groupSummary(g),
        readOnly: g.state !== 'open' || (req.user as GroupClaims).ro === true,
        worksheet,
        hiddenPaths: hidden,
        versions: Object.fromEntries(Object.entries(g.field_versions).filter(([p]) => p in worksheet).map(([p, v]) => [p, v.v])),
        progressPct: progressPct(g.worksheet),
        idleCloseAt: await idleCloseAt(db, g.id, ctx.config.idleDays),
        submission: await (async () => {
          const s = await lastSubmission(db, g.id);
          return s && hidden.length ? { ...s, by: null } : s;
        })(),
      };
    });

    // Submit (Summary step): a dated snapshot of the answers and the team's sharing choice.
    // Works after the group has closed too (it changes no answers). Not for practice groups.
    api.post('/groups/:id/submit', { ...ctx.limited, preHandler: requireGroup }, async (req, reply) => {
      const user = req.user as GroupClaims;
      if (user.ro) return forbidden(reply, 'This is a read-only view.');
      const body = z.object({ share: z.boolean() }).safeParse(req.body);
      if (!body.success) return badRequest(reply, 'Choose whether to share.');
      const g = await getGroup(db, user.gid);
      if (!g) return notFound(reply, 'Group not found.');
      if (g.practice) return badRequest(reply, 'Practice groups are not submitted.');
      if (g.state !== 'open') return reply.code(409).send({ error: 'closed', message: 'This team is closed. Ask your facilitator to reopen it to submit.' });
      const prev = lastSubmit.get(g.id) ?? 0;
      if (Date.now() - prev < SUBMIT_GAP_MS) return reply.code(429).send({ error: 'rate_limited', message: 'Just submitted. Wait a few seconds before submitting again.' });
      lastSubmit.set(g.id, Date.now());
      if (lastSubmit.size > 5000) for (const [k, t] of lastSubmit) if (Date.now() - t > SUBMIT_GAP_MS) lastSubmit.delete(k);
      const submission = await submitGroup(db, g.id, body.data.share, user.name ?? null);
      ctx.notifyCard(g.id);
      return { submission };
    });

    api.patch('/groups/:id/worksheet', { ...ctx.limited, preHandler: requireGroup }, async (req, reply) => {
      const user = req.user as GroupClaims;
      if (user.ro) return forbidden(reply, 'This is a read-only view.');
      const body = patchBody.safeParse(req.body);
      if (!body.success) return badRequest(reply, 'The change could not be read.');
      // The team's name and country are set by the facilitator.
      if (body.data.ops.some((o) => (TEAM_IDENTITY_PATHS as readonly string[]).includes(o.path))) {
        return forbidden(reply, 'Your facilitator sets the team name and country.');
      }
      try {
        const groupId = (req.params as { id: string }).id;
        const out = await applyPatch(db, groupId, body.data.ops, {
          clientId: body.data.clientId,
          displayName: user.name,
        });
        // Push the saved values to everyone in the group (FR-R2). The last op per path wins.
        const values = new Map(body.data.ops.map((o) => [o.path, o.value]));
        const member = hub.member(groupId, body.data.clientId);
        hub.broadcast(groupId, 'patch', {
          ops: out.applied.map((a) => ({ path: a.path, value: values.get(a.path) ?? null, version: a.version })),
          clientId: body.data.clientId ?? null,
          by: { name: user.name ?? null, guestNo: member?.guestNo ?? null },
        });
        ctx.notifyCard(groupId);
        return out;
      } catch (e) {
        if (!(e instanceof GroupError)) throw e;
        const status = { not_found: 404, not_open: 403, closed: 409, invalid: 400 }[e.code];
        return reply.code(status).send({ error: e.code, message: e.message, detail: e.detail });
      }
    });

    // Live updates for one group (FR-R2, FR-J4). Read-only viewers watch without joining presence.
    api.get('/groups/:id/stream', { ...ctx.limited, preHandler: requireGroup }, async (req, reply) => {
      const q = streamQuery.safeParse(req.query);
      if (!q.success) return badRequest(reply, 'Missing client id.');
      const groupId = (req.params as { id: string }).id;
      const g = await getGroup(db, groupId);
      if (!g) return notFound(reply, 'Group not found.');
      const user = req.user as GroupClaims;
      const addr = addressKey(req.ip);
      if (hub.streamCount(groupId) >= MAX_STREAMS_PER_GROUP || (streamsByAddress.get(addr) ?? 0) >= MAX_STREAMS_PER_ADDRESS) {
        return reply.code(429).send({ error: 'rate_limited', message: 'Too many open connections. Close some tabs and try again.' });
      }
      streamsByAddress.set(addr, (streamsByAddress.get(addr) ?? 0) + 1);
      req.raw.on('close', () => {
        const n = (streamsByAddress.get(addr) ?? 1) - 1;
        if (n > 0) streamsByAddress.set(addr, n); else streamsByAddress.delete(addr);
      });
      reply.hijack();
      const res = reply.raw;
      openSse(res);
      res.write(sseFrame('state', { state: g.state, endsAt: g.ends_at }));
      if (user.ro) {
        res.write(sseFrame('presence', hub.presence(groupId)));
        hub.watch(`group:${groupId}`, res);
        req.raw.on('close', () => hub.unwatch(`group:${groupId}`, res));
      } else {
        hub.join(groupId, { clientId: q.data.clientId, name: user.name ?? null, step: q.data.step }, res);
        req.raw.on('close', () => hub.leave(groupId, q.data.clientId, res));
      }
    });

    api.post('/groups/:id/presence', { ...ctx.limited, preHandler: requireGroup }, async (req, reply) => {
      if ((req.user as GroupClaims).ro) return forbidden(reply, 'This is a read-only view.');
      const body = presenceBody.safeParse(req.body);
      if (!body.success) return badRequest(reply, 'The update could not be read.');
      hub.setStep((req.params as { id: string }).id, body.data.clientId, body.data.step);
      return reply.code(204).send();
    });

    // 60-second readout and key facts (FR-SU1, SU2), in the group's content version.
    api.get('/groups/:id/summary', { preHandler: requireGroup }, async (req, reply) => {
      const g = await getGroup(db, (req.params as { id: string }).id);
      const content = g && (await getContent(db, g.content_version ?? (await activeContentVersion(db)) ?? ''));
      if (!g || !content) return notFound(reply, 'Group not found.');
      const summary = buildSummary(forCodeReader(g, req.user as GroupClaims).worksheet, content);
      return { ...summary, text: summaryText(summary), markdown: summaryMarkdown(summary) };
    });

    // The group's answers as an Excel workbook; works while open and after closing.
    api.get('/groups/:id/export.xlsx', { preHandler: requireGroup }, async (req, reply) => {
      const g = await getGroup(db, (req.params as { id: string }).id);
      const content = g && (await getContent(db, g.content_version ?? (await activeContentVersion(db)) ?? ''));
      if (!g || !content) return notFound(reply, 'Group not found.');
      const file = await groupWorkbook(forCodeReader(g, req.user as GroupClaims).worksheet, content, { teamCode: formatTeamCode(g.team_code), exportedAt: new Date() });
      const name = `DPI-H pathway - ${(g.country || formatTeamCode(g.team_code)).replace(/[^\p{L}\p{N} _-]/gu, '')}.xlsx`;
      return reply
        .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('content-disposition', `attachment; filename="export.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`)
        .send(file);
    });

    api.get('/content/active', async () => ({ version: await activeContentVersion(db) }));

    api.get('/content/:version', async (req, reply) => {
      const content = await getContent(db, (req.params as { version: string }).version);
      if (!content) return notFound(reply, 'Content version not found.');
      // Versions are immutable once published, so clients may cache them.
      // In development the workbook is rebuilt under the same version, so browsers must check each time.
      reply.header('cache-control', ctx.config.devClientUrl ? 'no-cache' : 'public, max-age=86400, immutable');
      return content;
    });
  };
}
