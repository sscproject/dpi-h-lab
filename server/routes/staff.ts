// Staff API: sign-in with in-app passwords (decision D1), staff accounts, and the facilitator
// console: events, groups, time controls, live dashboard, link approvals and exports
// (FR-F1–F9, FR-T1–T4, FR-L1).

import { z } from 'zod';
import { formatTeamCode } from '../../shared/codes.js';
import { COUNTRY_CODES, representedCountry, teamLabel } from '../../shared/countries.js';
import { progressPct } from '../../shared/worksheet.js';
import { activeContentVersion, getContent } from '../content-store.js';
import {
  badRequest, eventDto, forbidden, notFound, requireAdmin, requireStaff, requireStaffAccount, staffOf, unauthorised, type Ctx,
} from '../context.js';
import {
  addCoFacilitator, addGroups, allGroups, canManage, clearEventEnd, eventPeople, removeCoFacilitator, setEventFacilitator, closeEvent, closeGroup, createEvent, deleteEvent, deleteGroup, eventGroups,
  extendEvent, getEvent, getGroupAdmin, groupCard, listEvents, regenerateTeamCode, reopenEvent, reopenGroup, setEventConsent, setTeamIdentity, startEvent,
  updateEvent, type EventRow,
} from '../events.js';
import { csvColumns, csvRow, editLogCsv, toCsv } from '../export-csv.js';
import { audit } from '../groups.js';
import { openSse, sseFrame } from '../realtime.js';
import {
  countActiveAdmins, createUser, findUserForLogin, getUser, isAdmin, listUsers, passwordProblem, setPassword, setRole, setStatus, touchLogin,
  verifyPassword, workshopCounts, type Role, type StaffUser,
} from '../staff.js';
import { Lockout } from './public.js';

const STAFF_TOKEN_TTL = '12h';
const VIEW_TOKEN_TTL = '2h';

const email = z.email().max(200);
const loginBody = z.object({ email, password: z.string().min(1).max(200) });
const setupBody = z.object({ setupCode: z.string().max(20), email, name: z.string().trim().min(1).max(120), password: z.string().max(200) });
const passwordBody = z.object({ current: z.string().max(200), password: z.string().max(200) });
const role = z.enum(['super_admin', 'admin', 'facilitator']);
const newUserBody = z.object({ email, name: z.string().trim().min(1).max(120), role, password: z.string().max(200) });
const userPatch = z.object({
  status: z.enum(['active', 'inactive']).optional(),
  password: z.string().max(200).optional(),
  role: role.optional(),
  name: z.string().trim().min(1).max(120).optional(),
});
const countryCode = z.string().refine((c) => COUNTRY_CODES.includes(c), 'Unknown country');

const iso = z.iso.datetime({ offset: true });
/** A team as the facilitator sets it up: the country it represents, or a team name (or both). */
const teamSpec = z.object({
  name: z.string().trim().max(80).nullish(),
  countryCode: countryCode.nullish(),
}).refine((t) => !!t.countryCode || !!t.name, 'Each team needs a country or a team name.');
const teamsBody = z.object({ teams: z.array(teamSpec).min(1).max(60) });
const eventBody = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullish(),
  location: z.string().trim().max(120).nullish(),
  timezone: z.string().max(64).nullish(),
  startsAt: iso.nullish(),
  endsAt: iso.nullish(),
  /** A dated workshop, or an open (ongoing) session. */
  kind: z.enum(['workshop', 'open']),
  /** One team, or several. */
  scope: z.enum(['single', 'multi']),
  teams: z.array(teamSpec).min(1).max(60),
}).refine((e) => e.scope === 'multi' || e.teams.length === 1, 'A single-team session has exactly one team.');
const eventPatch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullish(),
  location: z.string().trim().max(120).nullish(),
  /** Admins only: hand the workshop to another facilitator. */
  facilitatorId: z.uuid().optional(),
});
const extendBody = z.object({ minutes: z.number().int().min(1).max(24 * 60).optional(), until: iso.optional(), clear: z.boolean().optional() });

const userDto = (u: StaffUser, workshops?: number) => ({
  id: u.id, email: u.email, name: u.name, role: u.role, status: u.status, lastLoginAt: u.last_login_at,
  mustChangePassword: u.must_change_password, workshops: workshops ?? null,
});

/** Only the Super Admin creates, changes or removes admins (and other Super Admins). */
const managesAdmins = (r: Role) => r === 'super_admin';


export function staffRoutes(ctx: Ctx) {
  const { app, db, hub } = ctx;
  const loginLock = new Lockout(10, 15 * 60_000);
  const accountLock = new Lockout(30, 15 * 60_000);

  const sign = (u: StaffUser) => app.jwt.sign(
    { scope: 'staff', uid: u.id, role: u.role, name: u.name, pwc: u.password_changed_at?.getTime() ?? 0 },
    { expiresIn: STAFF_TOKEN_TTL },
  );

  /** Loads an event the signed-in person may manage, or replies 404 (other facilitators' events look absent). */
  async function ownEvent(id: string, req: Parameters<typeof staffOf>[0]): Promise<EventRow | null> {
    const ev = await getEvent(db, id);
    return ev && (await canManage(db, ev, staffOf(req))) ? ev : null;
  }

  /** The facilitator in charge, or an admin (co-facilitators run the session but don't manage it). */
  const leads = (ev: EventRow, req: Parameters<typeof staffOf>[0]) => isAdmin(staffOf(req).role) || ev.facilitator_id === staffOf(req).uid;

  async function eventView(ev: EventRow, origin: string) {
    const groups = await eventGroups(db, ev.id);
    const on = groups.filter((g) => g.link_status === null || g.link_status === 'approved');
    const people = await eventPeople(db, ev);
    return {
      event: eventDto({ ...ev, facilitator_name: people.facilitator?.name ?? people.facilitator?.email ?? null }),
      facilitator: people.facilitator,
      coFacilitators: people.co,
      groups: on.map((g) => ({ ...groupCard(g, hub.connectedCount(g.id), formatTeamCode), joinUrl: `${origin}/join/${formatTeamCode(g.team_code)}` })),
    };
  }

  return async (api: typeof app) => {
    // ------------------------------------------------------------ sign-in

    api.get('/auth/status', async () => ({ setupNeeded: ctx.setup.needed }));

    // First admin: needs the one-time setup code printed in the server log.
    api.post('/auth/setup', ctx.limited, async (req, reply) => {
      const body = setupBody.safeParse(req.body);
      if (!body.success) return badRequest(reply, 'Fill in every field.');
      if ((await countActiveAdmins(db)) > 0) return forbidden(reply, 'An admin account already exists. Sign in instead.');
      if (!ctx.setup.check(body.data.setupCode)) return forbidden(reply, "That setup code isn't right. It is printed in the server log.");
      const problem = passwordProblem(body.data.password);
      if (problem) return badRequest(reply, problem);
      const u = await createUser(db, { email: body.data.email, name: body.data.name, role: 'super_admin', password: body.data.password });
      ctx.setup.clear();
      await audit(db, u.email, 'staff.setup', u.id, null);
      return { token: sign(u), user: userDto(u) };
    });

    api.post('/auth/login', ctx.limited, async (req, reply) => {
      const body = loginBody.safeParse(req.body);
      if (!body.success) return badRequest(reply, 'Enter your email and password.');
      const email = body.data.email.trim().toLowerCase();
      const key = `${req.ip}|${email}`;
      // Guesses from many addresses at one account are capped too, not only per address.
      // The per-account cap only stops addresses that are themselves getting it wrong, so a
      // stranger can't lock a facilitator out of their own account.
      if (loginLock.locked(key) || (accountLock.locked(email) && loginLock.count(key) > 0)) return reply.code(429).send({ error: 'locked', message: 'Too many attempts. Wait 15 minutes, then try again.' });
      const u = await findUserForLogin(db, email);
      const passwordOk = await verifyPassword(body.data.password, u?.password_hash ?? null);
      const ok = u && u.status === 'active' && passwordOk;
      if (!ok) {
        loginLock.fail(key);
        accountLock.fail(email);
        req.log.warn({ event: 'staff.login.failed' }, 'staff sign-in failed');
        return unauthorised(reply, "That email and password don't match an active account.");
      }
      loginLock.clear(key);
      await touchLogin(db, u.id);
      await audit(db, u.id, 'staff.login', u.id, null);
      return { token: sign(u), user: userDto(u) };
    });

    api.get('/auth/me', { preHandler: requireStaffAccount }, async (req, reply) => {
      const u = await getUser(db, staffOf(req).uid);
      if (!u || u.status !== 'active') return unauthorised(reply);
      return { user: userDto(u) };
    });

    api.post('/auth/password', { preHandler: requireStaffAccount }, async (req, reply) => {
      const body = passwordBody.safeParse(req.body);
      if (!body.success) return badRequest(reply, 'Fill in both passwords.');
      const me = await getUser(db, staffOf(req).uid);
      const full = me && (await findUserForLogin(db, me.email));
      if (!full || !(await verifyPassword(body.data.current, full.password_hash))) return forbidden(reply, 'Your current password is not right.');
      const problem = passwordProblem(body.data.password);
      if (problem) return badRequest(reply, problem);
      if (body.data.password === body.data.current) return badRequest(reply, 'Choose a password different from the current one.');
      await setPassword(db, full.id, body.data.password);
      await audit(db, full.id, 'staff.password', full.id, null);
      // Older sign-ins stop working; this one gets a fresh token.
      const updated = (await getUser(db, full.id))!;
      return { user: userDto(updated), token: sign(updated) };
    });

    // ------------------------------------------------------------ staff accounts (admin)

    api.get('/admin/users', { preHandler: requireAdmin }, async () => {
      const counts = await workshopCounts(db);
      return { users: (await listUsers(db)).map((u) => userDto(u, counts.get(u.id) ?? 0)) };
    });

    api.post('/admin/users', { preHandler: requireAdmin }, async (req, reply) => {
      const body = newUserBody.safeParse(req.body);
      if (!body.success) return badRequest(reply, 'Fill in email, name, role and a starting password.');
      const problem = passwordProblem(body.data.password);
      if (problem) return badRequest(reply, problem);
      if (body.data.role !== 'facilitator' && !managesAdmins(staffOf(req).role)) return forbidden(reply, 'Only the Super Admin can add admins.');
      if (await findUserForLogin(db, body.data.email)) return reply.code(409).send({ error: 'exists', message: 'An account with that email already exists.' });
      // The starting password was chosen for them, so they set their own when they first sign in.
      const u = await createUser(db, { ...body.data, temporary: true });
      await audit(db, staffOf(req).uid, 'staff.create', u.id, { role: u.role });
      return reply.code(201).send({ user: userDto(u) });
    });

    api.patch('/admin/users/:id', { preHandler: requireAdmin }, async (req, reply) => {
      const id = (req.params as { id: string }).id;
      const body = userPatch.safeParse(req.body);
      if (!body.success) return badRequest(reply, 'The change could not be read.');
      const u = await getUser(db, id);
      if (!u) return notFound(reply, 'Account not found.');
      const me = staffOf(req);
      const d = body.data;
      if (id === me.uid && (d.role !== undefined || d.status !== undefined || d.password !== undefined)) {
        return forbidden(reply, 'Change your own password from your name menu. Another admin changes your role or status.');
      }
      if ((u.role !== 'facilitator' || (d.role && d.role !== 'facilitator')) && !managesAdmins(me.role)) {
        return forbidden(reply, 'Only the Super Admin can change admins.');
      }
      const losesSuper = u.role === 'super_admin' && u.status === 'active' && ((d.role && d.role !== 'super_admin') || d.status === 'inactive');
      if (losesSuper && (await countActiveAdmins(db)) <= 1) {
        return reply.code(409).send({ error: 'last_admin', message: 'Keep at least one active Super Admin.' });
      }
      if (d.password !== undefined) {
        const problem = passwordProblem(d.password);
        if (problem) return badRequest(reply, problem);
        // A reset password is temporary: they choose their own at the next sign-in.
        await setPassword(db, id, d.password, true);
      }
      if (d.role) await setRole(db, id, d.role);
      if (d.name) await db.query('UPDATE users SET name = $2 WHERE id = $1', [id, d.name]);
      if (d.status) await setStatus(db, id, d.status);
      await audit(db, me.uid, 'staff.update', id, { status: d.status, role: d.role, passwordReset: d.password !== undefined });
      return { user: userDto((await getUser(db, id))!) };
    });

    // ------------------------------------------------------------ events

    // ?all=1: every workshop (admins); otherwise the person's own and co-facilitated ones.
    api.get('/events', { preHandler: requireStaff }, async (req) => {
      const all = (req.query as { all?: string }).all === '1' && isAdmin(staffOf(req).role);
      return { events: (await listEvents(db, staffOf(req), all)).map(eventDto) };
    });

    api.post('/events', { preHandler: requireStaff }, async (req, reply) => {
      const body = eventBody.safeParse(req.body);
      if (!body.success) {
        // Say which rule failed when it is one of ours (one team per single-team session; a country or name per team).
        const ours = body.error.issues.find((i) => i.message.startsWith('A single') || i.message.startsWith('Each team'));
        return badRequest(reply, ours?.message ?? 'Check the session details: a name and at least one team are needed.', body.error.issues);
      }
      const d = body.data;
      const startsAt = d.startsAt ? new Date(d.startsAt) : null;
      const endsAt = d.endsAt ? new Date(d.endsAt) : null;
      if (endsAt && endsAt.getTime() <= Math.max(Date.now(), startsAt?.getTime() ?? 0)) return badRequest(reply, 'The end time must be after the start time and in the future.');
      const contentVersion = await activeContentVersion(db);
      if (!contentVersion) throw new Error('No active content version.');
      const id = await createEvent(db, {
        facilitatorId: staffOf(req).uid, name: d.name, description: d.description, location: d.location, timezone: d.timezone,
        startsAt, endsAt, kind: d.kind, scope: d.scope, teams: d.teams, contentVersion,
      });
      await audit(db, staffOf(req).uid, 'event.create', id, null);
      return reply.code(201).send(await eventView((await getEvent(db, id))!, ctx.origin(req)));
    });

    api.get('/events/:id', { preHandler: requireStaff }, async (req, reply) => {
      const ev = await ownEvent((req.params as { id: string }).id, req);
      return ev ? eventView(ev, ctx.origin(req)) : notFound(reply, 'Event not found.');
    });

    api.patch('/events/:id', { preHandler: requireStaff }, async (req, reply) => {
      const ev = await ownEvent((req.params as { id: string }).id, req);
      if (!ev) return notFound(reply, 'Event not found.');
      const body = eventPatch.safeParse(req.body);
      if (!body.success) return badRequest(reply, 'The change could not be read.');
      const { facilitatorId, ...rest } = body.data;
      if (facilitatorId !== undefined) {
        if (!isAdmin(staffOf(req).role)) return forbidden(reply, 'Only admins can hand a workshop to someone else.');
        const to = await getUser(db, facilitatorId);
        if (!to || to.status !== 'active') return badRequest(reply, 'Choose an active person.');
        await setEventFacilitator(db, ev.id, facilitatorId);
        await audit(db, staffOf(req).uid, 'event.reassign', ev.id, { to: facilitatorId });
      }
      await updateEvent(db, ev.id, rest);
      await ctx.notify({ groups: [], events: [ev.id] });
      return eventView((await getEvent(db, ev.id))!, ctx.origin(req));
    });

    // Event controls (FR-F5, FR-T2).
    api.post('/events/:id/:action', { preHandler: requireStaff }, async (req, reply) => {
      const { id, action } = req.params as { id: string; action: string };
      const ev = await ownEvent(id, req);
      if (!ev) return notFound(reply, 'Event not found.');
      let changed;
      switch (action) {
        case 'start': changed = await startEvent(db, id); break;
        case 'close': changed = await closeEvent(db, id); break;
        case 'reopen': changed = await reopenEvent(db, id); break;
        case 'delete':
          if (!leads(ev, req)) return forbidden(reply, 'Only the facilitator in charge or an admin can delete this session.');
          changed = await deleteEvent(db, id);
          break;
        case 'extend': {
          const body = extendBody.safeParse(req.body);
          if (!body.success || (!body.data.minutes && !body.data.until && !body.data.clear)) return badRequest(reply, 'Choose how long to extend, or an end time.');
          if (body.data.clear) changed = await clearEventEnd(db, id);
          else {
            const until = body.data.until ? new Date(body.data.until) : undefined;
            if (until && until.getTime() <= Date.now()) return badRequest(reply, 'The end time must be in the future.');
            changed = await extendEvent(db, id, { minutes: body.data.minutes, until });
          }
          break;
        }
        case 'consent': {
          const body = z.object({ consent: z.enum(['private', 'aggregate', 'identified']) }).safeParse(req.body);
          if (!body.success) return badRequest(reply, 'Choose a consent option.');
          await setEventConsent(db, id, body.data.consent);
          changed = { groups: (await eventGroups(db, id)).map((g) => g.id), events: [] };
          break;
        }
        default: return notFound(reply);
      }
      await audit(db, staffOf(req).uid, `event.${action}`, id, action === 'extend' || action === 'consent' ? req.body ?? null : null);
      await ctx.notify(changed);
      if (action === 'delete') return { deleted: true };
      return eventView((await getEvent(db, id))!, ctx.origin(req));
    });

    // Add teams: only facilitators add teams; a single-team session keeps one.
    api.post('/events/:id/groups', { preHandler: requireStaff }, async (req, reply) => {
      const ev = await ownEvent((req.params as { id: string }).id, req);
      if (!ev) return notFound(reply, 'Session not found.');
      const body = teamsBody.safeParse(req.body);
      if (!body.success) return badRequest(reply, body.error.issues.find((i) => i.message.startsWith('Each team'))?.message ?? 'Add between 1 and 60 teams.');
      const existing = (await eventGroups(db, ev.id)).filter((g) => g.link_status === null || g.link_status === 'approved').length;
      if (ev.scope === 'single' && existing + body.data.teams.length > 1) return badRequest(reply, 'This is a single-team session: it has one team.');
      await db.tx((q) => addGroups(q, ev.id, body.data.teams));
      await audit(db, staffOf(req).uid, 'event.teams.add', ev.id, { n: body.data.teams.length });
      return eventView(ev, ctx.origin(req));
    });

    api.patch('/events/:id/groups/:gid', { preHandler: requireStaff }, async (req, reply) => {
      const { id, gid } = req.params as { id: string; gid: string };
      const ev = await ownEvent(id, req);
      const g = ev && (await getGroupAdmin(db, gid));
      if (!ev || !g || g.event_id !== ev.id) return notFound(reply, 'Group not found.');
      // The team's country (or none) and name: set by the facilitator, shown read-only to the team.
      const body = teamSpec.safeParse(req.body);
      if (!body.success) return badRequest(reply, 'Choose a country, or enter a team name (up to 80 characters).');
      const by = staffOf(req).name ?? null;
      const ops = await setTeamIdentity(db, gid, body.data, by);
      if (ops.length) hub.broadcast(gid, 'patch', { ops, clientId: null, by: { name: by, guestNo: null } });
      await audit(db, staffOf(req).uid, 'group.identity', gid, body.data);
      ctx.notifyCard(gid);
      return eventView(ev, ctx.origin(req));
    });

    // Per-group controls (FR-F5) and the read-only view (FR-F9).
    api.post('/events/:id/groups/:gid/:action', { preHandler: requireStaff }, async (req, reply) => {
      const { id, gid, action } = req.params as { id: string; gid: string; action: string };
      const ev = await ownEvent(id, req);
      const g = ev && (await getGroupAdmin(db, gid));
      if (!ev || !g || g.event_id !== ev.id) return notFound(reply, 'Group not found.');
      if (action === 'view') {
        return {
          token: app.jwt.sign({ scope: 'group', gid, name: staffOf(req).name ?? null, ro: true, by: staffOf(req).uid }, { expiresIn: VIEW_TOKEN_TTL }),
          teamCode: formatTeamCode(g.team_code),
          contentVersion: g.content_version,
        };
      }
      let changed;
      if (action === 'close') changed = await closeGroup(db, gid);
      else if (action === 'reopen') changed = await reopenGroup(db, gid);
      else if (action === 'remove') changed = await deleteGroup(db, gid);
      else if (action === 'newcode') {
        // A leaked or lost code: the old one stops working and its sign-ins end.
        await regenerateTeamCode(db, gid);
        hub.kick(gid);
        changed = { groups: [gid], events: [] };
      } else return notFound(reply);
      await audit(db, staffOf(req).uid, `group.${action}`, gid, { eventId: id });
      await ctx.notify(changed);
      return eventView(ev, ctx.origin(req));
    });

    // Live dashboard stream (FR-F3): group cards and event state as they change.
    api.get('/events/:id/stream', { preHandler: requireStaff }, async (req, reply) => {
      const ev = await ownEvent((req.params as { id: string }).id, req);
      if (!ev) return notFound(reply, 'Event not found.');
      reply.hijack();
      const res = reply.raw;
      openSse(res);
      res.write(sseFrame('event', eventDto(ev)));
      hub.watch(`event:${ev.id}`, res);
      const me = staffOf(req);
      const recheck = setInterval(async () => {
        const account = await getUser(db, me.uid).catch(() => null);
        const still = account && account.status === 'active' && (await getEvent(db, ev.id)) && (await canManage(db, ev, { uid: me.uid, role: account.role }));
        if (!still) res.end();
      }, 60_000);
      recheck.unref();
      req.raw.on('close', () => { clearInterval(recheck); hub.unwatch(`event:${ev.id}`, res); });
    });

    // ------------------------------------------------------------ co-facilitators

    // Adds another staff member (by their sign-in email) to run this workshop too.
    api.post('/events/:id/facilitators', { preHandler: requireStaff }, async (req, reply) => {
      const ev = await ownEvent((req.params as { id: string }).id, req);
      if (!ev) return notFound(reply, 'Workshop not found.');
      if (!leads(ev, req)) return forbidden(reply, 'Only the facilitator in charge or an admin can add co-facilitators.');
      const body = z.object({ email }).safeParse(req.body);
      if (!body.success) return badRequest(reply, 'Enter their sign-in email.');
      const u = await findUserForLogin(db, body.data.email);
      if (!u || u.status !== 'active') return notFound(reply, 'No active staff account has that email. An admin can add them first.');
      if (u.id === ev.facilitator_id) return badRequest(reply, 'They already run this workshop.');
      await addCoFacilitator(db, ev.id, u.id);
      await audit(db, staffOf(req).uid, 'event.cofacilitator.add', ev.id, { user: u.id });
      return eventView(ev, ctx.origin(req));
    });

    api.delete('/events/:id/facilitators/:uid', { preHandler: requireStaff }, async (req, reply) => {
      const { id, uid } = req.params as { id: string; uid: string };
      const ev = await ownEvent(id, req);
      if (!ev) return notFound(reply, 'Workshop not found.');
      if (uid !== staffOf(req).uid && !leads(ev, req)) return forbidden(reply, 'Only the facilitator in charge or an admin can remove co-facilitators.');
      await removeCoFacilitator(db, ev.id, uid);
      await audit(db, staffOf(req).uid, 'event.cofacilitator.remove', ev.id, { user: uid });
      // Removing yourself leaves the workshop: it is no longer yours to see.
      const still = await ownEvent(id, req);
      return still ? eventView(still, ctx.origin(req)) : { left: true };
    });

    // ------------------------------------------------------------ all teams (admins)

    api.get('/admin/groups', { preHandler: requireAdmin }, async () => ({
      groups: (await allGroups(db)).map((g) => ({
        id: g.id,
        teamCode: formatTeamCode(g.team_code),
        name: g.name,
        label: teamLabel(g.worksheet) || g.name || formatTeamCode(g.team_code),
        countryCode: representedCountry(g.worksheet),
        useCase: typeof g.worksheet['uc.option'] === 'string' ? g.worksheet['uc.option'] : null,
        state: g.state,
        eventId: g.event_id,
        eventName: g.event_name,
        linkStatus: g.link_status,
        progressPct: progressPct(g.worksheet),
        consent: g.consent,
        submittedAt: g.submitted_at,
        updatedAt: g.updated_at,
      })),
    }));

    // Read-only view of any team, including ones not in a workshop.
    api.post('/admin/groups/:id/view', { preHandler: requireAdmin }, async (req, reply) => {
      const g = await getGroupAdmin(db, (req.params as { id: string }).id);
      if (!g) return notFound(reply, 'Team not found.');
      await audit(db, staffOf(req).uid, 'group.view', g.id, null);
      return {
        token: app.jwt.sign({ scope: 'group', gid: g.id, name: staffOf(req).name ?? null, ro: true, by: staffOf(req).uid }, { expiresIn: VIEW_TOKEN_TTL }),
        teamCode: formatTeamCode(g.team_code),
        contentVersion: g.content_version,
      };
    });

    // ------------------------------------------------------------ exports (FR-F6)

    api.get('/events/:id/export.csv', { preHandler: requireStaff }, async (req, reply) => {
      const ev = await ownEvent((req.params as { id: string }).id, req);
      if (!ev) return notFound(reply, 'Event not found.');
      const groups = (await eventGroups(db, ev.id)).filter((g) => g.link_status === null || g.link_status === 'approved');
      const content = await getContent(db, ev.content_version ?? (await activeContentVersion(db)) ?? '');
      const csv = toCsv([csvColumns(), ...groups.map((g) => csvRow(ev, g, content))]);
      return download(reply, csv, 'text/csv; charset=utf-8', `${ev.name} - groups.csv`);
    });

    api.get('/events/:id/export.json', { preHandler: requireStaff }, async (req, reply) => {
      const ev = await ownEvent((req.params as { id: string }).id, req);
      if (!ev) return notFound(reply, 'Event not found.');
      const groups = (await eventGroups(db, ev.id)).filter((g) => g.link_status === null || g.link_status === 'approved');
      const json = {
        exportedAt: new Date().toISOString(),
        event: eventDto(ev),
        groups: groups.map((g) => ({
          teamCode: formatTeamCode(g.team_code), name: g.name, state: g.state, consent: g.consent, contentVersion: g.content_version,
          createdAt: g.created_at, closedAt: g.closed_at, worksheet: g.worksheet,
        })),
      };
      return download(reply, JSON.stringify(json, null, 2), 'application/json; charset=utf-8', `${ev.name} - worksheets.json`);
    });

    api.get('/events/:id/edit-log.csv', { preHandler: requireStaff }, async (req, reply) => {
      const ev = await ownEvent((req.params as { id: string }).id, req);
      if (!ev) return notFound(reply, 'Event not found.');
      const groups = (await eventGroups(db, ev.id)).filter((g) => g.link_status === null || g.link_status === 'approved');
      return download(reply, await editLogCsv(db, groups), 'text/csv; charset=utf-8', `${ev.name} - edit log.csv`);
    });
  };
}

function download(reply: import('fastify').FastifyReply, body: string, type: string, filename: string) {
  const safe = filename.replace(/[^\p{L}\p{N} ._-]/gu, '');
  return reply
    .header('content-type', type)
    .header('content-disposition', `attachment; filename="export"; filename*=UTF-8''${encodeURIComponent(safe)}`)
    .send(body);
}
