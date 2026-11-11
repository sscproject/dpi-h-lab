// Events, group lifecycle and time controls (SPEC §4, FR-T1–T4, FR-F1, FR-F5, FR-L1, FR-O2).
// Every change returns the ids of groups whose state or end time changed, so the caller can
// push the new state to everyone looking at them.

import { randomBytes, randomUUID } from 'node:crypto';
import { isCodeShape, makeCode, normalizeCode } from '../shared/codes.js';
import { progressPct, type Worksheet } from '../shared/worksheet.js';
import { isUuid, type Db, type Queryable } from './db.js';
import { countryFields, countryName, representedCountry, teamLabel } from '../shared/countries.js';
import { isAdmin, type Role } from './staff.js';

export type State = 'draft' | 'open' | 'closed' | 'deleted';
export type LinkPolicy = 'approval' | 'auto';
export type Consent = 'private' | 'aggregate' | 'identified';

export interface EventRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  location: string | null;
  timezone: string | null;
  facilitator_id: string | null;
  state: State;
  starts_at: Date | null;
  ends_at: Date | null;
  link_policy: LinkPolicy;
  content_version: string | null;
  created_at: Date;
  closed_at: Date | null;
  /** No longer set (was "All teams represent"); kept for older data. */
  country_code: string | null;
  /** A dated workshop, or an open (ongoing) session. */
  kind: 'workshop' | 'open';
  /** One team, or several. */
  scope: 'single' | 'multi';
}

/**
 * A team as the facilitator sets it up: a country it represents (ISO code), or none; and a
 * team name, which is required when there is no country.
 */
export interface TeamSpec { name?: string | null; countryCode?: string | null }

/** The group name and worksheet fields for a team set up by the facilitator. */
export function teamIdentity(t: TeamSpec): { name: string; fields: Worksheet } {
  const name = (t.name ?? '').trim();
  const code = t.countryCode ?? null;
  return {
    name: name || (code ? countryName(code) : ''),
    fields: { ...(name ? { country: name } : {}), ...(code ? countryFields(code) : {}) },
  };
}

export interface Changed {
  groups: string[];
  events: string[];
}

const none = (): Changed => ({ groups: [], events: [] });

/** Event code: "E-" + 6 Crockford characters (SPEC §9.1). Accepts "e-abc123", "ABC 123" etc. */
export function normalizeEventCode(input: string): string {
  const c = normalizeCode(input);
  return c.length === 7 && c.startsWith('E') ? c.slice(1) : c;
}
export const formatEventCode = (code: string) => `E-${code}`;

async function unique(q: Queryable, table: 'events' | 'groups', column: 'code' | 'team_code') {
  for (let i = 0; i < 20; i++) {
    const code = makeCode((n) => randomBytes(n));
    const { rows } = await q.query(`SELECT 1 FROM ${table} WHERE ${column} = $1`, [code]);
    if (!rows.length) return code;
  }
  throw new Error('Could not allocate a unique code.');
}

export const uniqueTeamCode = (q: Queryable) => unique(q, 'groups', 'team_code');

// ---------------------------------------------------------------- events

export interface NewEvent {
  facilitatorId: string;
  name: string;
  description?: string | null;
  location?: string | null;
  timezone?: string | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  kind: 'workshop' | 'open';
  scope: 'single' | 'multi';
  /** The teams, as the facilitator sets them up. */
  teams: TeamSpec[];
  contentVersion: string;
}

export async function createEvent(db: Db, e: NewEvent): Promise<string> {
  return db.tx(async (q) => {
    const id = randomUUID();
    const code = await unique(q, 'events', 'code');
    const state: State = e.startsAt && e.startsAt.getTime() > Date.now() ? 'draft' : 'open';
    await q.query(
      `INSERT INTO events (id, code, name, description, location, timezone, facilitator_id, state, starts_at, ends_at, content_version, kind, scope)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [id, code, e.name, e.description ?? null, e.location ?? null, e.timezone ?? null, e.facilitatorId, state,
        e.startsAt ?? (state === 'open' ? new Date() : null), e.endsAt ?? null, e.contentVersion, e.kind, e.scope],
    );
    await addGroups(q, id, e.teams);
    return id;
  });
}

/** Adds teams to a session; they take its state and times. */
export async function addGroups(q: Queryable, eventId: string, teams: TeamSpec[]) {
  const ev = await getEvent(q, eventId);
  if (!ev) throw new Error('Event not found.');
  const { rows } = await q.query<{ n: number }>('SELECT coalesce(max(sort), -1)::int + 1 AS n FROM groups WHERE event_id = $1', [eventId]);
  let sort = rows[0].n;
  const state: State = ev.state === 'closed' ? 'closed' : ev.state === 'draft' ? 'draft' : 'open';
  for (const t of teams) {
    const { name, fields } = teamIdentity(t);
    await q.query(
      `INSERT INTO groups (id, team_code, event_id, name, country, state, starts_at, ends_at, content_version, worksheet, sort, closed_by_event)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)`,
      [randomUUID(), await uniqueTeamCode(q), eventId, name, teamLabel(fields) || name, state, ev.starts_at, ev.ends_at,
        ev.content_version, JSON.stringify(fields), sort++, state === 'closed'],
    );
  }
}

export async function getEvent(q: Queryable, id: string): Promise<EventRow | null> {
  if (!isUuid(id)) return null;
  const { rows } = await q.query<EventRow>("SELECT * FROM events WHERE id = $1 AND state <> 'deleted'", [id]);
  return rows[0] ?? null;
}

export async function findEventByCode(q: Queryable, raw: string): Promise<EventRow | null> {
  const code = normalizeEventCode(raw);
  if (!isCodeShape(code)) return null;
  const { rows } = await q.query<EventRow>("SELECT * FROM events WHERE code = $1 AND state <> 'deleted'", [code]);
  return rows[0] ?? null;
}

/** The person's own and co-facilitated workshops, or every workshop with `all` (admins only). */
export async function listEvents(q: Queryable, user: { uid: string; role: Role }, all?: boolean) {
  const { rows } = await q.query<EventRow & { group_count: number; facilitator_name: string | null }>(
    `SELECT e.*, (SELECT count(*)::int FROM groups g WHERE g.event_id = e.id AND g.state <> 'deleted'
                    AND (g.link_status IS NULL OR g.link_status = 'approved')) AS group_count,
            u.name AS facilitator_name
     FROM events e LEFT JOIN users u ON u.id = e.facilitator_id
     WHERE e.state <> 'deleted' AND ($1::boolean OR e.facilitator_id = $2
       OR EXISTS (SELECT 1 FROM event_facilitators ef WHERE ef.event_id = e.id AND ef.user_id = $2))
     ORDER BY coalesce(e.starts_at, e.created_at) DESC`,
    [all ?? false, user.uid],
  );
  return rows;
}

/** Facilitators see only their own events; admins see all (SPEC §11). */
/** Admins, the workshop's facilitator and its co-facilitators can run it. */
export async function canManage(q: Queryable, ev: EventRow, user: { uid: string; role: Role }): Promise<boolean> {
  if (isAdmin(user.role) || ev.facilitator_id === user.uid) return true;
  const { rows } = await q.query('SELECT 1 FROM event_facilitators WHERE event_id = $1 AND user_id = $2', [ev.id, user.uid]);
  return rows.length > 0;
}

export interface Person { id: string; name: string | null; email: string }

/** The workshop's facilitator and co-facilitators. */
export async function eventPeople(q: Queryable, ev: EventRow): Promise<{ facilitator: Person | null; co: Person[] }> {
  const one = ev.facilitator_id
    ? (await q.query<Person>('SELECT id, name, email FROM users WHERE id = $1', [ev.facilitator_id])).rows[0] ?? null
    : null;
  const { rows } = await q.query<Person>(
    `SELECT u.id, u.name, u.email FROM event_facilitators ef JOIN users u ON u.id = ef.user_id
     WHERE ef.event_id = $1 ORDER BY ef.added_at`,
    [ev.id],
  );
  return { facilitator: one, co: rows };
}

export async function addCoFacilitator(q: Queryable, eventId: string, userId: string) {
  await q.query('INSERT INTO event_facilitators (event_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [eventId, userId]);
}

export async function removeCoFacilitator(q: Queryable, eventId: string, userId: string) {
  await q.query('DELETE FROM event_facilitators WHERE event_id = $1 AND user_id = $2', [eventId, userId]);
}

/** Hands a workshop to another facilitator (admins); they stop being a co-facilitator of it. */
export async function setEventFacilitator(q: Queryable, eventId: string, userId: string) {
  await q.query('UPDATE events SET facilitator_id = $2, updated_at = now() WHERE id = $1', [eventId, userId]);
  await removeCoFacilitator(q, eventId, userId);
}

/** Paths only the facilitator sets: the team's name and the country it represents. */
export const TEAM_IDENTITY_PATHS = ['country', 'country.rep', 'country.code'] as const;

/**
 * The facilitator changes a team's name or country. Saved straight into the worksheet (with
 * new field versions and an edit-log line) so it works whatever the team's state; returns
 * the changed fields so they can be pushed to anyone with the worksheet open.
 */
export async function setTeamIdentity(db: Db, groupId: string, t: TeamSpec, by: string | null) {
  return db.tx(async (q) => {
    const { rows } = await q.query<{ worksheet: Worksheet; field_versions: Record<string, { v: number; at: string; by?: string | null }> }>(
      'SELECT worksheet, field_versions FROM groups WHERE id = $1 FOR UPDATE', [groupId],
    );
    const ws = { ...rows[0].worksheet };
    const fv = { ...rows[0].field_versions };
    const { name, fields } = teamIdentity(t);
    const at = new Date().toISOString();
    const changed: { path: string; value: string | boolean | null; version: number }[] = [];
    for (const path of TEAM_IDENTITY_PATHS) {
      const next = fields[path] ?? null;
      const old = ws[path] ?? null;
      if (next === old) continue;
      if (next === null) delete ws[path]; else ws[path] = next;
      const version = (fv[path]?.v ?? 0) + 1;
      fv[path] = { v: version, at, by };
      changed.push({ path, value: next, version });
      await q.query(
        `INSERT INTO edit_log (group_id, path, old_value, new_value, display_name, client_id, at)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, NULL, $6)`,
        [groupId, path, JSON.stringify(old), JSON.stringify(next), by, at],
      );
    }
    await q.query(
      'UPDATE groups SET worksheet = $2::jsonb, field_versions = $3::jsonb, name = $4, country = $5, updated_at = now() WHERE id = $1',
      [groupId, JSON.stringify(ws), JSON.stringify(fv), name, teamLabel(ws) || name],
    );
    return changed;
  });
}

/**
 * Groups made before every team belonged to a session (do-it-yourself groups, and groups
 * that asked to join a workshop) move into one open session run by the Super Admin, as
 * teams with no country. Runs at start-up; does nothing until a Super Admin exists.
 */
export async function adoptOrphanGroups(db: Db): Promise<number> {
  const orphans = "NOT practice AND state <> 'deleted' AND (event_id IS NULL OR link_status IN ('pending', 'declined'))";
  const { rows: count } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM groups WHERE ${orphans}`);
  if (!count[0].n) return 0;
  const { rows: owner } = await db.query<{ id: string }>(
    "SELECT id FROM users WHERE role = 'super_admin' AND status = 'active' ORDER BY created_at LIMIT 1",
  );
  if (!owner.length) return 0;
  return db.tx(async (q) => {
    const { rows: found } = await q.query<{ id: string }>(
      "SELECT id FROM events WHERE kind = 'open' AND name = $1 AND state <> 'deleted' ORDER BY created_at LIMIT 1", [EARLIER_GROUPS],
    );
    let id = found[0]?.id;
    if (!id) {
      id = randomUUID();
      const { rows: cv } = await q.query<{ version: string }>('SELECT version FROM content_versions WHERE is_active');
      await q.query(
        `INSERT INTO events (id, code, name, facilitator_id, state, starts_at, content_version, kind, scope)
         VALUES ($1, $2, $3, $4, 'open', now(), $5, 'open', 'multi')`,
        [id, await unique(q, 'events', 'code'), EARLIER_GROUPS, owner[0].id, cv[0]?.version ?? null],
      );
    }
    const { rows: moved } = await q.query(
      `UPDATE groups SET event_id = $1, link_status = NULL, closed_by_event = false,
         worksheet = worksheet - 'country.rep' - 'country.code', updated_at = now()
       WHERE ${orphans} RETURNING id`,
      [id],
    );
    return moved.length;
  });
}

/** The open session older groups are moved into. */
export const EARLIER_GROUPS = 'Earlier groups';

export async function updateEvent(q: Queryable, id: string, f: { name?: string; description?: string | null; location?: string | null }) {
  await q.query(
    `UPDATE events SET name = coalesce($2, name), description = CASE WHEN $3::boolean THEN $4 ELSE description END,
       location = CASE WHEN $5::boolean THEN $6 ELSE location END, updated_at = now()
     WHERE id = $1`,
    [id, f.name ?? null, f.description !== undefined, f.description ?? null, f.location !== undefined, f.location ?? null],
  );
}

const eventGroupIds = async (q: Queryable, eventId: string) =>
  (await q.query<{ id: string }>("SELECT id FROM groups WHERE event_id = $1 AND state <> 'deleted'", [eventId])).rows.map((r) => r.id);

/** Opens a draft event now (FR-F5 start). */
export async function startEvent(db: Db, id: string): Promise<Changed> {
  return db.tx(async (q) => {
    await q.query("UPDATE events SET state = 'open', starts_at = now(), updated_at = now() WHERE id = $1 AND state = 'draft'", [id]);
    await q.query("UPDATE groups SET state = 'open', starts_at = now(), updated_at = now() WHERE event_id = $1 AND state = 'draft'", [id]);
    return { groups: await eventGroupIds(q, id), events: [id] };
  });
}

/** Closing an event closes all its open groups, remembering which (SPEC §4.1). */
export async function closeEvent(db: Db, id: string): Promise<Changed> {
  return db.tx(async (q) => {
    await q.query("UPDATE events SET state = 'closed', closed_at = now(), updated_at = now() WHERE id = $1 AND state IN ('open', 'draft')", [id]);
    await q.query(
      `UPDATE groups SET state = 'closed', closed_by_event = true, closed_at = now(), updated_at = now()
       WHERE event_id = $1 AND state IN ('open', 'draft')`,
      [id],
    );
    return { groups: await eventGroupIds(q, id), events: [id] };
  });
}

/** Reopens the event and the groups that its closing closed. A past end time is cleared. */
export async function reopenEvent(db: Db, id: string): Promise<Changed> {
  return db.tx(async (q) => reopenEventIn(q, id));
}

async function reopenEventIn(q: Queryable, id: string): Promise<Changed> {
  await q.query("UPDATE events SET ends_at = NULL WHERE id = $1 AND ends_at <= now()", [id]);
  await q.query("UPDATE events SET state = 'open', closed_at = NULL, updated_at = now() WHERE id = $1 AND state = 'closed'", [id]);
  await q.query("UPDATE groups SET ends_at = NULL WHERE event_id = $1 AND ends_at <= now()", [id]);
  await q.query(
    `UPDATE groups SET state = 'open', closed_by_event = false, closed_at = NULL, updated_at = now()
     WHERE event_id = $1 AND state = 'closed' AND closed_by_event`,
    [id],
  );
  return { groups: await eventGroupIds(q, id), events: [id] };
}

/** New end time from "+N minutes" (counted from the later of now and the current end) or a set time. */
export function newEndTime(current: Date | null, by: { minutes?: number; until?: Date }): Date {
  if (by.until) return by.until;
  const base = Math.max(Date.now(), current?.getTime() ?? Date.now());
  return new Date(base + (by.minutes ?? 0) * 60_000);
}

/**
 * Sets or extends the event's end time (FR-T2), for all its groups too. If the event had
 * closed because time ran out, it reopens, so groups can carry on editing.
 */
export async function extendEvent(db: Db, id: string, by: { minutes?: number; until?: Date }): Promise<Changed> {
  return db.tx(async (q) => {
    const ev = await getEvent(q, id);
    if (!ev) return none();
    const timedOut = ev.state === 'closed' && ev.ends_at !== null && ev.ends_at.getTime() <= Date.now();
    const end = newEndTime(ev.ends_at, by);
    await q.query('UPDATE events SET ends_at = $2, updated_at = now() WHERE id = $1', [id, end]);
    await q.query("UPDATE groups SET ends_at = $2, updated_at = now() WHERE event_id = $1 AND state <> 'deleted'", [id, end]);
    if (timedOut) await reopenEventIn(q, id);
    return { groups: await eventGroupIds(q, id), events: [id] };
  });
}

/** Clears the end time (no countdown). */
export async function clearEventEnd(db: Db, id: string): Promise<Changed> {
  return db.tx(async (q) => {
    await q.query('UPDATE events SET ends_at = NULL, updated_at = now() WHERE id = $1', [id]);
    await q.query("UPDATE groups SET ends_at = NULL, updated_at = now() WHERE event_id = $1 AND state <> 'deleted'", [id]);
    return { groups: await eventGroupIds(q, id), events: [id] };
  });
}

/** Soft delete (SPEC §4.1): hidden from everyone but admins; purged after 30 days (M4). */
export async function deleteEvent(db: Db, id: string): Promise<Changed> {
  return db.tx(async (q) => {
    const groups = await eventGroupIds(q, id);
    await q.query("UPDATE events SET state = 'deleted', deleted_at = now(), updated_at = now() WHERE id = $1", [id]);
    await q.query("UPDATE groups SET state = 'deleted', deleted_at = now(), updated_at = now() WHERE event_id = $1 AND state <> 'deleted'", [id]);
    return { groups, events: [id] };
  });
}

export async function setEventConsent(db: Db, id: string, consent: Consent): Promise<void> {
  await db.query(
    "UPDATE groups SET consent = $2, consent_at = now() WHERE event_id = $1 AND state <> 'deleted' AND (link_status IS NULL OR link_status = 'approved')",
    [id, consent],
  );
}

// ---------------------------------------------------------------- single groups

export interface GroupAdminRow {
  id: string;
  team_code: string;
  name: string | null;
  country: string | null;
  state: State;
  event_id: string | null;
  link_status: 'pending' | 'approved' | 'declined' | null;
  starts_at: Date | null;
  ends_at: Date | null;
  consent: Consent | null;
  content_version: string | null;
  worksheet: Worksheet;
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
  sort: number;
  submitted_at: Date | null;
}

export async function getGroupAdmin(q: Queryable, id: string): Promise<GroupAdminRow | null> {
  if (!isUuid(id)) return null;
  const { rows } = await q.query<GroupAdminRow>("SELECT * FROM groups WHERE id = $1 AND state <> 'deleted'", [id]);
  return rows[0] ?? null;
}

export async function closeGroup(db: Db, id: string): Promise<Changed> {
  await db.query(
    "UPDATE groups SET state = 'closed', closed_by_event = false, closed_at = now(), updated_at = now() WHERE id = $1 AND state IN ('open', 'draft')",
    [id],
  );
  return { groups: [id], events: [] };
}

export async function reopenGroup(db: Db, id: string): Promise<Changed> {
  await db.query("UPDATE groups SET ends_at = NULL WHERE id = $1 AND ends_at <= now()", [id]);
  await db.query(
    "UPDATE groups SET state = 'open', closed_by_event = false, closed_at = NULL, updated_at = now() WHERE id = $1 AND state = 'closed'",
    [id],
  );
  return { groups: [id], events: [] };
}

export async function deleteGroup(db: Db, id: string): Promise<Changed> {
  await db.query("UPDATE groups SET state = 'deleted', deleted_at = now(), updated_at = now() WHERE id = $1", [id]);
  return { groups: [id], events: [] };
}

/**
 * New team code (a leaked code, or a team that lost theirs). The old code stops working at
 * once, and sign-ins made with it end: the code generation is part of every team token.
 */
export async function regenerateTeamCode(db: Db, id: string): Promise<string> {
  return db.tx(async (q) => {
    const code = await uniqueTeamCode(q);
    await q.query('UPDATE groups SET team_code = $2, code_gen = code_gen + 1, updated_at = now() WHERE id = $1', [id, code]);
    return code;
  });
}

export async function eventGroups(q: Queryable, eventId: string): Promise<GroupAdminRow[]> {
  const { rows } = await q.query<GroupAdminRow>(
    "SELECT * FROM groups WHERE event_id = $1 AND state <> 'deleted' ORDER BY sort, created_at",
    [eventId],
  );
  return rows;
}

// ---------------------------------------------------------------- dashboard

export interface GroupCard {
  id: string;
  teamCode: string;
  name: string | null;
  country: string | null;
  countryCode: string | null;
  submittedAt: string | null;
  state: State;
  linkStatus: GroupAdminRow['link_status'];
  progressPct: number;
  priority: string | null;
  regional: string | null;
  connected: number;
  lastActivity: string;
  endsAt: string | null;
  consent: Consent | null;
}

export function groupCard(g: GroupAdminRow, connected: number, fmtCode: (c: string) => string): GroupCard {
  const s = (k: string) => (typeof g.worksheet[k] === 'string' ? (g.worksheet[k] as string) : null);
  return {
    id: g.id,
    teamCode: fmtCode(g.team_code),
    name: g.name,
    country: teamLabel(g.worksheet) || null,
    countryCode: representedCountry(g.worksheet),
    submittedAt: g.submitted_at?.toISOString() ?? null,
    state: g.state,
    linkStatus: g.link_status,
    progressPct: progressPct(g.worksheet),
    priority: s('pw.priority'),
    regional: s('rg.component'),
    connected,
    lastActivity: g.updated_at.toISOString(),
    endsAt: g.ends_at?.toISOString() ?? null,
    consent: g.consent,
  };
}

// ---------------------------------------------------------------- scheduler

/** Opens what should have started and closes what has ended (SPEC §4.2, §14 auto-close sweep). */
// A group follows its event's lifecycle when it belongs to the event (created in it, or linked and approved).
const IN_EVENT = "(g.event_id IS NOT NULL AND (g.link_status IS NULL OR g.link_status = 'approved'))";

/** Last activity of an event: its own changes or any edit in its groups. */
const EVENT_ACTIVITY = `greatest(e.updated_at, coalesce((SELECT max(g.updated_at) FROM groups g WHERE g.event_id = e.id AND g.state <> 'deleted'), e.updated_at))`;

/**
 * When an open group will close for lack of use (SPEC §4.4 X1), or null if it is not open
 * or its event has a set end time (that end time applies instead).
 */
export async function idleCloseAt(q: Queryable, groupId: string, idleDays: number): Promise<Date | null> {
  const { rows } = await q.query<{ at: Date | null }>(
    `SELECT CASE
       WHEN g.state <> 'open' THEN NULL
       WHEN ${IN_EVENT} THEN (SELECT CASE WHEN e.ends_at IS NULL THEN ${EVENT_ACTIVITY} END FROM events e WHERE e.id = g.event_id)
       ELSE g.updated_at
     END + make_interval(days => $2::int) AS at
     FROM groups g WHERE g.id = $1`,
    [groupId, idleDays],
  );
  return rows[0]?.at ?? null;
}

export async function sweep(db: Db, opts: { idleDays?: number; practiceHours?: number } = {}): Promise<Changed> {
  const changed = none();
  const due = async (sql: string, params: unknown[] = []) => (await db.query<{ id: string }>(sql, params)).rows.map((r) => r.id);
  // Practice groups are removed for good (with their edit log) once they are a day old.
  await db.query('DELETE FROM groups WHERE practice AND created_at < now() - make_interval(hours => $1::int)', [opts.practiceHours ?? 24]);
  // Unused groups and events close on their own; nothing is deleted and the owner or facilitator can reopen.
  if (opts.idleDays && opts.idleDays > 0) {
    for (const id of await due(`SELECT e.id FROM events e WHERE e.state = 'open' AND e.ends_at IS NULL AND ${EVENT_ACTIVITY} < now() - make_interval(days => $1::int)`, [opts.idleDays])) {
      const c = await closeEvent(db, id);
      changed.groups.push(...c.groups);
      changed.events.push(id);
    }
    for (const id of await due(`SELECT g.id FROM groups g WHERE g.state = 'open' AND NOT ${IN_EVENT} AND g.updated_at < now() - make_interval(days => $1::int)`, [opts.idleDays])) {
      await closeGroup(db, id);
      changed.groups.push(id);
    }
  }
  for (const id of await due("SELECT id FROM events WHERE state = 'draft' AND starts_at <= now()")) {
    const c = await startEvent(db, id);
    changed.groups.push(...c.groups);
    changed.events.push(id);
  }
  for (const id of await due("SELECT id FROM events WHERE state = 'open' AND ends_at <= now()")) {
    const c = await closeEvent(db, id);
    changed.groups.push(...c.groups);
    changed.events.push(id);
  }
  for (const id of await due("SELECT id FROM groups WHERE state = 'draft' AND starts_at <= now() AND event_id IS NULL")) {
    await db.query("UPDATE groups SET state = 'open', updated_at = now() WHERE id = $1", [id]);
    changed.groups.push(id);
  }
  for (const id of await due("SELECT id FROM groups WHERE state = 'open' AND ends_at <= now()")) {
    await closeGroup(db, id);
    changed.groups.push(id);
  }
  return changed;
}

/** Every team except practice and deleted ones, newest activity first (admin Teams tab). */
export async function allGroups(q: Queryable) {
  const { rows } = await q.query<GroupAdminRow & { event_name: string | null }>(
    `SELECT g.*, e.name AS event_name FROM groups g LEFT JOIN events e ON e.id = g.event_id
     WHERE g.state <> 'deleted' AND NOT g.practice AND (g.link_status IS NULL OR g.link_status <> 'declined')
     ORDER BY g.updated_at DESC LIMIT 2000`,
  );
  return rows;
}
