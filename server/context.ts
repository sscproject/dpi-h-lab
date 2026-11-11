// Shared server context: token types, access checks, and live notifications that every
// route module uses.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { formatTeamCode } from '../shared/codes.js';
import type { Config } from './config.js';
import { isUuid, type Db } from './db.js';
import { formatEventCode, groupCard, type Changed, type EventRow, type GroupAdminRow } from './events.js';
import type { Hub } from './realtime.js';
import { getUser, isAdmin, type Role, type SetupCode } from './staff.js';

/** Team member (from a team code). `ro` marks a facilitator's read-only view (FR-F9). */
export interface GroupClaims {
  scope: 'group'; gid: string; name?: string | null; ro?: boolean;
  /** Team code generation the sign-in was made with (a new code ends older sign-ins). */
  gen?: number;
  /** Read-only views: the staff member who opened it (their account must still be active). */
  by?: string;
}
/** Admin or facilitator, signed in with an in-app password. */
export interface StaffClaims {
  scope: 'staff'; uid: string; role: Role; name?: string | null;
  /** When the password was last set, as signed into the token: a newer password ends this sign-in. */
  pwc?: number;
}
export type Claims = GroupClaims | StaffClaims;

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: Claims;
    user: Claims;
  }
}

export interface Ctx {
  app: FastifyInstance;
  db: Db;
  config: Config;
  hub: Hub;
  setup: SetupCode;
  /** Pushes new state to group members and dashboards after a lifecycle change. */
  notify(changed: Changed): Promise<void>;
  /** Refreshes one group's dashboard card (debounced). */
  notifyCard(groupId: string): void;
  origin(req: FastifyRequest): string;
  limited: { config: { rateLimit: { max: number; timeWindow: string } } };
}

export const unauthorised = (reply: FastifyReply, message = 'Please sign in again.') =>
  reply.code(401).send({ error: 'unauthorised', message });
export const forbidden = (reply: FastifyReply, message = 'You do not have access to this.') =>
  reply.code(403).send({ error: 'forbidden', message });
export const notFound = (reply: FastifyReply, message = 'Not found.') => reply.code(404).send({ error: 'not_found', message });
export const badRequest = (reply: FastifyReply, message: string, detail?: unknown) =>
  reply.code(400).send({ error: 'invalid', message, detail });

async function verify(req: FastifyRequest): Promise<Claims | null> {
  try {
    await req.jwtVerify();
    return req.user;
  } catch {
    return null;
  }
}

/**
 * Team member token for the group in the URL (read-only view tokens included), checked live:
 * a new team code ends sign-ins made with the old one, and a read-only view ends when the
 * staff member who opened it is deactivated.
 */
export async function requireGroup(req: FastifyRequest, reply: FastifyReply) {
  const id = (req.params as { id: string }).id;
  if (!isUuid(id)) return notFound(reply);
  const u = await verify(req);
  if (!u) return unauthorised(reply, 'Your session has ended. Join again with your team code.');
  if (u.scope !== 'group' || u.gid !== id) return forbidden(reply, 'This session is for a different group.');
  if (u.ro) {
    const staff = u.by ? await getUser(req.server.db, u.by) : null;
    if (!staff || staff.status !== 'active') return unauthorised(reply);
    return;
  }
  const { rows } = await req.server.db.query<{ code_gen: number }>('SELECT code_gen FROM groups WHERE id = $1', [id]);
  if (rows.length && (u.gen ?? 0) !== rows[0].code_gen) {
    return unauthorised(reply, 'Your team has a new code. Join again with the new code from your facilitator.');
  }
}


/**
 * Staff token plus a live account check, so a disabled account or a changed role takes
 * effect at once rather than when the 12-hour token runs out.
 */
async function liveStaff(req: FastifyRequest): Promise<(StaffClaims & { mustChange: boolean }) | null> {
  const u = await verify(req);
  if (!u || u.scope !== 'staff') return null;
  const account = await getUser(req.server.db, u.uid);
  if (!account || account.status !== 'active') return null;
  // A changed or reset password ends sign-ins made before it.
  if ((u.pwc ?? 0) !== (account.password_changed_at?.getTime() ?? 0)) return null;
  const live: StaffClaims = { ...u, role: account.role, name: account.name };
  req.user = live;
  return { ...live, mustChange: account.must_change_password };
}

/** Someone whose password was set for them can only change it until they do. */
const mustChange = (reply: FastifyReply) =>
  reply.code(403).send({ error: 'password_change', message: 'Choose a new password before you continue.' });

export async function requireStaff(req: FastifyRequest, reply: FastifyReply) {
  const u = await liveStaff(req);
  if (!u) return unauthorised(reply);
  if (u.mustChange) return mustChange(reply);
}

/** Signed-in staff, even before they replace a temporary password (to see who they are and change it). */
export async function requireStaffAccount(req: FastifyRequest, reply: FastifyReply) {
  if (!(await liveStaff(req))) return unauthorised(reply);
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  const u = await liveStaff(req);
  if (!u) return unauthorised(reply);
  if (u.mustChange) return mustChange(reply);
  if (!isAdmin(u.role)) return forbidden(reply, 'Only admins can do this.');
}

export const staffOf = (req: FastifyRequest) => req.user as StaffClaims;

export function eventDto(ev: EventRow & { facilitator_name?: string | null; group_count?: number }) {
  return {
    id: ev.id,
    code: formatEventCode(ev.code),
    name: ev.name,
    description: ev.description,
    location: ev.location,
    timezone: ev.timezone,
    state: ev.state,
    startsAt: ev.starts_at,
    endsAt: ev.ends_at,
    contentVersion: ev.content_version,
    facilitatorId: ev.facilitator_id,
    facilitatorName: ev.facilitator_name ?? null,
    groupCount: ev.group_count ?? null,
    kind: ev.kind,
    scope: ev.scope,
  };
}

/** Builds the notify functions on top of the hub. */
export function makeNotifier(db: Db, hub: Hub) {
  const card = (g: GroupAdminRow) => groupCard(g, hub.connectedCount(g.id), formatTeamCode);

  async function pushCard(groupId: string) {
    const { rows } = await db.query<GroupAdminRow>('SELECT * FROM groups WHERE id = $1', [groupId]);
    const g = rows[0];
    if (!g?.event_id) return;
    const visible = g.state !== 'deleted' && (g.link_status === null || g.link_status === 'approved');
    hub.notify(`event:${g.event_id}`, 'group', visible ? card(g) : { id: g.id, removed: true, linkStatus: g.link_status });
  }

  const timers = new Map<string, NodeJS.Timeout>();
  function notifyCard(groupId: string) {
    if (timers.has(groupId)) return;
    timers.set(groupId, setTimeout(() => {
      timers.delete(groupId);
      void pushCard(groupId).catch(() => {});
    }, 400).unref());
  }

  async function notify(changed: Changed) {
    for (const id of new Set(changed.groups)) {
      const { rows } = await db.query<GroupAdminRow>('SELECT * FROM groups WHERE id = $1', [id]);
      const g = rows[0];
      if (!g) continue;
      hub.broadcast(id, 'state', { state: g.state, endsAt: g.ends_at });
      await pushCard(id);
    }
    for (const id of new Set(changed.events)) {
      const { rows } = await db.query<EventRow>('SELECT * FROM events WHERE id = $1', [id]);
      if (rows[0]) hub.notify(`event:${id}`, 'event', eventDto(rows[0]));
    }
  }

  return { notify, notifyCard, card };
}
