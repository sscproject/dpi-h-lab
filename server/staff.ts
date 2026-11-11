// Staff accounts (admins and facilitators) with passwords set in the app (decision D1:
// no Cognito or single sign-on). Passwords are stored as scrypt hashes only.

import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { isUuid, type Db, type Queryable } from './db.js';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, len: 32 };

export const PASSWORD_MIN = 10;
export type Role = 'super_admin' | 'admin' | 'facilitator';

/** Admins and the Super Admin see every workshop and team and manage facilitators. */
export const isAdmin = (role: Role) => role === 'admin' || role === 'super_admin';

export interface StaffUser {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  status: 'active' | 'inactive';
  last_login_at: Date | null;
  created_at: Date;
  /** Set when someone else chose the password (new account or reset). */
  must_change_password: boolean;
  /** Sign-ins made before this stop working (a changed or reset password). */
  password_changed_at: Date | null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, SCRYPT.len, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

// Checked against when an account doesn't exist, so a failed sign-in takes the same time
// either way and can't reveal which emails have accounts.
let decoy: Promise<string> | null = null;

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) {
    decoy ??= hashPassword(randomBytes(16).toString('hex'));
    await verifyPassword(password, await decoy);
    return false;
  }
  const [kind, n, r, p, salt, hash] = stored.split('$');
  if (kind !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64url'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return timingSafeEqual(expected, actual);
}

/** Returns a reason the password is too weak, or null. */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (/^(.)\1+$/.test(password)) return 'Use a password that is not one repeated character.';
  return null;
}

const COLS = 'id, email, name, role, status, last_login_at, created_at, must_change_password, password_changed_at';

/** Active Super Admins; there must always be at least one. */
export async function countActiveAdmins(q: Queryable): Promise<number> {
  const { rows } = await q.query<{ n: number }>("SELECT count(*)::int AS n FROM users WHERE role = 'super_admin' AND status = 'active'");
  return rows[0].n;
}

/** `temporary`: the password was chosen for them, so they must change it when they first sign in. */
export async function createUser(q: Queryable, u: { email: string; name: string; role: Role; password: string; temporary?: boolean }): Promise<StaffUser> {
  const { rows } = await q.query<StaffUser>(
    `INSERT INTO users (id, email, name, role, status, password_hash, password_changed_at, must_change_password)
     VALUES ($1, $2, $3, $4, 'active', $5, now(), $6) RETURNING ${COLS}`,
    [randomUUID(), u.email.trim().toLowerCase(), u.name.trim(), u.role, await hashPassword(u.password), u.temporary === true],
  );
  return rows[0];
}

export async function findUserForLogin(q: Queryable, email: string) {
  const { rows } = await q.query<StaffUser & { password_hash: string | null }>(
    `SELECT ${COLS}, password_hash FROM users WHERE email = $1`,
    [email.trim().toLowerCase()],
  );
  return rows[0] ?? null;
}

export async function getUser(q: Queryable, id: string): Promise<StaffUser | null> {
  if (!isUuid(id)) return null;
  const { rows } = await q.query<StaffUser>(`SELECT ${COLS} FROM users WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function listUsers(q: Queryable): Promise<StaffUser[]> {
  return (await q.query<StaffUser>(
    `SELECT ${COLS} FROM users ORDER BY CASE role WHEN 'super_admin' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, lower(coalesce(name, email))`,
  )).rows;
}

/** `temporary`: set by an admin (a reset), so it must be changed at the next sign-in. */
export async function setPassword(q: Queryable, id: string, password: string, temporary = false) {
  await q.query('UPDATE users SET password_hash = $2, password_changed_at = now(), must_change_password = $3 WHERE id = $1', [id, await hashPassword(password), temporary]);
}

export async function setRole(q: Queryable, id: string, role: Role) {
  await q.query('UPDATE users SET role = $2 WHERE id = $1', [id, role]);
}

/** How many workshops each person runs (as facilitator or co-facilitator). */
export async function workshopCounts(q: Queryable): Promise<Map<string, number>> {
  const { rows } = await q.query<{ uid: string; n: number }>(
    `SELECT uid, count(DISTINCT eid)::int AS n FROM (
       SELECT facilitator_id AS uid, id AS eid FROM events WHERE state <> 'deleted' AND facilitator_id IS NOT NULL
       UNION ALL SELECT ef.user_id, ef.event_id FROM event_facilitators ef JOIN events e ON e.id = ef.event_id WHERE e.state <> 'deleted'
     ) x GROUP BY uid`,
  );
  return new Map(rows.map((r) => [r.uid, r.n]));
}

export async function setStatus(q: Queryable, id: string, status: 'active' | 'inactive') {
  await q.query('UPDATE users SET status = $2 WHERE id = $1', [id, status]);
}

export async function touchLogin(q: Queryable, id: string) {
  await q.query('UPDATE users SET last_login_at = now() WHERE id = $1', [id]);
}

/**
 * First-run setup: while there is no active admin, the server prints a one-time setup code
 * to its log. Whoever creates the first admin account in the app must enter it, so a fresh
 * deployment cannot be claimed by a stranger who finds it first.
 */
export class SetupCode {
  private code: string | null = null;
  async refresh(db: Db, log: (msg: string) => void) {
    if ((await countActiveAdmins(db)) > 0) {
      this.code = null;
      return;
    }
    this.code ??= randomBytes(6).toString('base64url').replace(/[-_]/g, 'x').slice(0, 8).toUpperCase();
    log(`No admin account yet. Open the app, choose "Sign in" and use setup code: ${this.code}`);
  }
  get needed() { return this.code !== null; }
  check(code: string) {
    if (!this.code) return false;
    const a = Buffer.from(code.trim().toUpperCase());
    const b = Buffer.from(this.code);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  clear() { this.code = null; }
}
