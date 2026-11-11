// Group domain logic, kept free of HTTP so it can move to another runtime later (SPEC §14 option B).

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { isCodeShape, makeCode, normalizeCode } from '../shared/codes.js';
import { validateValue, type FieldValue, type FieldVersions, type OpError, type Worksheet } from '../shared/worksheet.js';
import { isUuid, type Db, type Queryable } from './db.js';
import { teamLabel } from '../shared/countries.js';
import { representedCountry } from '../shared/countries.js';

export type GroupState = 'draft' | 'open' | 'closed' | 'deleted';

export interface GroupRow {
  id: string;
  team_code: string;
  name: string | null;
  country: string | null;
  state: GroupState;
  event_id: string | null;
  starts_at: Date | null;
  ends_at: Date | null;
  content_version: string | null;
  closed_at: Date | null;
  updated_at: Date;
  /** "Just exploring": deleted 24 hours after creation; its code works until then. */
  practice: boolean;
  /** Goes up each time the facilitator issues a new team code; team sign-ins carry it. */
  code_gen: number;
}

export interface PatchOp {
  path: string;
  value: FieldValue | null;
  baseVersion: number;
}

export interface AppliedOp {
  path: string;
  version: number;
  /** True when someone else changed this field since `baseVersion` (last write still wins). */
  conflict: boolean;
}

export class GroupError extends Error {
  constructor(public code: 'not_found' | 'not_open' | 'closed' | 'invalid', message: string, public detail?: unknown) {
    super(message);
  }
}

// An open group past its end time reads as closed straight away; the scheduled
// auto-close sweep (M3) persists the change.
const STATE_SQL = "CASE WHEN state = 'open' AND ends_at IS NOT NULL AND ends_at <= now() THEN 'closed' ELSE state END";

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

async function uniqueTeamCode(q: Queryable): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const code = makeCode((n) => randomBytes(n));
    const { rows } = await q.query('SELECT 1 FROM groups WHERE team_code = $1', [code]);
    if (!rows.length) return code;
  }
  throw new Error('Could not allocate a unique team code.');
}

/** Do-it-yourself group (FR-O1). Opens immediately; the owner token is returned once and stored hashed. */
export async function createGroup(db: Db, input: { name: string; endsAt?: Date | null; contentVersion: string; practice?: boolean }) {
  const id = randomUUID();
  const ownerToken = randomBytes(32).toString('base64url');
  const teamCode = await uniqueTeamCode(db);
  const name = input.name.trim();
  const worksheet: Worksheet = name ? { country: name } : {};
  await db.query(
    `INSERT INTO groups (id, team_code, owner_token_hash, name, country, state, starts_at, ends_at, content_version, worksheet, practice)
     VALUES ($1, $2, $3, $4, $5, 'open', now(), $6, $7, $8::jsonb, $9)`,
    [id, teamCode, sha256(ownerToken), name, name, input.endsAt ?? null, input.contentVersion, JSON.stringify(worksheet), input.practice === true],
  );
  await audit(db, 'owner', 'group.create', id, { teamCode });
  return { id, teamCode, ownerToken };
}

/** Looks up a joinable group by code. Deleted groups look exactly like unknown codes (FR-J1). */
export async function findByCode(db: Db, rawCode: string): Promise<GroupRow | null> {
  const code = normalizeCode(rawCode);
  if (!isCodeShape(code)) return null;
  const { rows } = await db.query<GroupRow>(
    `SELECT id, team_code, name, country, ${STATE_SQL} AS state, event_id, starts_at, ends_at, content_version, closed_at, updated_at, practice, code_gen
     FROM groups WHERE team_code = $1 AND state <> 'deleted' AND deleted_at IS NULL`,
    [code],
  );
  return rows[0] ?? null;
}

export async function getGroup(db: Db, id: string) {
  if (!isUuid(id)) return null;
  const { rows } = await db.query<GroupRow & { worksheet: Worksheet; field_versions: FieldVersions }>(
    `SELECT id, team_code, name, country, ${STATE_SQL} AS state, event_id, starts_at, ends_at, content_version, closed_at, updated_at, practice, code_gen, worksheet, field_versions
     FROM groups WHERE id = $1 AND state <> 'deleted' AND deleted_at IS NULL`,
    [id],
  );
  return rows[0] ?? null;
}

/** Validates every op before touching the database; unknown paths and over-length text are rejected (§9.2). */
export function validateOps(ops: PatchOp[]): { path: string; error: OpError }[] {
  return ops.flatMap((op) => {
    const error = validateValue(op.path, op.value);
    return error ? [{ path: op.path, error }] : [];
  });
}

/**
 * Applies a patch with field-level merge (FR-R3): each path is versioned on its own,
 * so edits to different fields never collide. On the same field the last write wins,
 * and a stale baseVersion is reported back as a conflict.
 */
export async function applyPatch(
  db: Db,
  groupId: string,
  ops: PatchOp[],
  meta: { clientId?: string; displayName?: string | null },
): Promise<{ applied: AppliedOp[]; worksheetVersion: string }> {
  const invalid = validateOps(ops);
  if (invalid.length) throw new GroupError('invalid', 'Some changes are not valid.', invalid);

  return db.tx(async (q) => {
    const { rows } = await q.query<{ state: GroupState; worksheet: Worksheet; field_versions: FieldVersions }>(
      `SELECT ${STATE_SQL} AS state, worksheet, field_versions FROM groups WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [groupId],
    );
    const g = rows[0];
    if (!g || g.state === 'deleted') throw new GroupError('not_found', 'Group not found.');
    // Write permission is checked against the current state on every patch (§11).
    if (g.state !== 'open') throw new GroupError('closed', 'This group is not open for editing.');

    const ws = { ...g.worksheet };
    const fv = { ...g.field_versions };
    const at = new Date().toISOString();
    const applied: AppliedOp[] = [];

    for (const op of ops) {
      const current = fv[op.path]?.v ?? 0;
      const conflict = op.baseVersion < current;
      const old = Object.hasOwn(ws, op.path) ? ws[op.path] : null;
      if (old === op.value) {
        applied.push({ path: op.path, version: current, conflict });
        continue;
      }
      if (op.value === null) delete ws[op.path];
      else ws[op.path] = op.value;
      const version = current + 1;
      fv[op.path] = { v: version, at, by: meta.displayName ?? null };
      applied.push({ path: op.path, version, conflict });
      await q.query(
        `INSERT INTO edit_log (group_id, path, old_value, new_value, display_name, client_id, at)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7)`,
        [groupId, op.path, JSON.stringify(old), JSON.stringify(op.value), meta.displayName ?? null, meta.clientId ?? null, at],
      );
    }

    await q.query(
      `UPDATE groups SET worksheet = $2::jsonb, field_versions = $3::jsonb, updated_at = $4,
         country = COALESCE($5, country)
       WHERE id = $1`,
      [groupId, JSON.stringify(ws), JSON.stringify(fv), at, teamLabel(ws) || null],
    );
    return { applied, worksheetVersion: at };
  });
}

export async function audit(q: Queryable, actor: string, action: string, targetId: string | null, detail: unknown) {
  await q.query(
    'INSERT INTO audit (actor, action, target_type, target_id, detail) VALUES ($1, $2, $3, $4, $5::jsonb)',
    [actor, action, 'group', targetId, JSON.stringify(detail ?? null)],
  );
}

export interface Submission { at: Date; by: string | null; share: boolean }

/** The team's latest submission, if any. */
export async function lastSubmission(q: Queryable, groupId: string): Promise<Submission | null> {
  const { rows } = await q.query<{ submitted_at: Date; submitted_by: string | null; share: boolean }>(
    'SELECT submitted_at, submitted_by, share FROM submissions WHERE group_id = $1 ORDER BY submitted_at DESC LIMIT 1',
    [groupId],
  );
  return rows[0] ? { at: rows[0].submitted_at, by: rows[0].submitted_by, share: rows[0].share } : null;
}

/**
 * Submit (Summary step): saves a dated copy of the answers and the team's sharing choice.
 * Ticking "I consent to share" sets the group's consent to identified; not ticking, to private.
 * The team can keep editing and submit again; the latest submission counts.
 */
export async function submitGroup(db: Db, groupId: string, share: boolean, by: string | null): Promise<Submission> {
  return db.tx(async (q) => {
    const { rows } = await q.query<{ worksheet: Worksheet; content_version: string | null }>(
      'SELECT worksheet, content_version FROM groups WHERE id = $1 FOR UPDATE', [groupId],
    );
    const ws = rows[0].worksheet;
    const at = new Date();
    await q.query(
      `INSERT INTO submissions (id, group_id, submitted_at, submitted_by, share, country_code, content_version, worksheet)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [randomUUID(), groupId, at, by, share, representedCountry(ws), rows[0].content_version, JSON.stringify(ws)],
    );
    await q.query(
      'UPDATE groups SET submitted_at = $2, consent = $3, consent_at = $2 WHERE id = $1',
      [groupId, at, share ? 'identified' : 'private'],
    );
    await audit(q, by ?? 'team', 'group.submit', groupId, { share });
    return { at, by, share };
  });
}
