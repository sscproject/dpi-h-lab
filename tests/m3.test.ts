// M3: staff passwords, events, dashboard, exports, time controls, owner link, linking.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../server/app';
import type { Config } from '../server/config';
import { seedContent } from '../server/content-store';
import { pgliteDb, type Db } from '../server/db';
import { csvCell, csvColumns } from '../server/export-csv';
import { migrate } from '../server/migrate';
import { matchCountry } from '../shared/countries';
import { adoptOrphanGroups } from '../server/events';
import { makeTeam } from './helpers';
import { addressKey } from '../server/routes/public';
import { loadConfig } from '../server/config';

let db: Db;
let app: Awaited<ReturnType<typeof buildApp>>;
let adminToken = '';
let facToken = '';
let fac2Token = '';

const config: Config = {
  port: 0, host: '127.0.0.1', jwtSecret: 'test-secret', contentJson: 'content/content.json',
  clientDist: 'none', rateLimitPerMinute: 1000, publicUrl: 'https://lab.test', sweepMs: 0, idleDays: 14, codeReadDays: 90, submitGapMs: 1500,
};

type Res = { statusCode: number; json: () => any; body: string; headers: Record<string, unknown> };
const call = (method: string, url: string, token?: string, payload?: unknown): Promise<Res> =>
  app.inject({ method: method as 'GET', url: `/api/v1${url}`, headers: token ? { authorization: `Bearer ${token}` } : {}, payload: payload as object }) as Promise<Res>;

beforeAll(async () => {
  db = await pgliteDb();
  await migrate(db);
  await seedContent(db, config.contentJson);
  app = await buildApp(db, config);
});
afterAll(async () => {
  await app.close();
  await db.close();
});

describe('staff sign-in with in-app passwords', () => {
  it('creates the first admin only with the setup code from the log', async () => {
    let logged = '';
    await app.setup.refresh(db, (m) => { logged = m; });
    const code = /setup code: (\w+)/.exec(logged)![1];
    expect((await call('GET', '/auth/status')).json()).toEqual({ setupNeeded: true });

    const body = { email: 'admin@lab.test', name: 'Ada Admin', password: 'correct horse battery' };
    expect((await call('POST', '/auth/setup', undefined, { ...body, setupCode: 'WRONG123' })).statusCode).toBe(403);
    expect((await call('POST', '/auth/setup', undefined, { ...body, setupCode: code, password: 'short' })).statusCode).toBe(400);
    const ok = await call('POST', '/auth/setup', undefined, { ...body, setupCode: code });
    expect(ok.statusCode).toBe(200);
    adminToken = ok.json().token;
    expect(ok.json().user).toMatchObject({ email: 'admin@lab.test', role: 'super_admin', mustChangePassword: false });

    expect((await call('GET', '/auth/status')).json()).toEqual({ setupNeeded: false });
    expect((await call('POST', '/auth/setup', undefined, { ...body, setupCode: code })).statusCode).toBe(403);
  });

  it('stores only a password hash', async () => {
    const { rows } = await db.query<{ password_hash: string }>("SELECT password_hash FROM users WHERE email = 'admin@lab.test'");
    expect(rows[0].password_hash).toMatch(/^scrypt\$/);
    expect(rows[0].password_hash).not.toContain('correct horse');
  });

  it('lets an admin add facilitators who can then sign in', async () => {
    for (const [email, name] of [['fac@lab.test', 'Fay'], ['fac2@lab.test', 'Finn']]) {
      const r = await call('POST', '/admin/users', adminToken, { email, name, role: 'facilitator', password: 'starting-pass-1' });
      expect(r.statusCode).toBe(201);
    }
    expect((await call('POST', '/auth/login', undefined, { email: 'fac@lab.test', password: 'nope-nope-nope' })).statusCode).toBe(401);
    const first = await call('POST', '/auth/login', undefined, { email: 'FAC@lab.test', password: 'starting-pass-1' });
    facToken = first.json().token;
    expect(first.json().user.mustChangePassword).toBe(true);
    // The starting password was set by an admin: nothing else works until they choose their own.
    expect((await call('GET', '/events', facToken)).json().error).toBe('password_change');
    expect((await call('POST', '/auth/password', facToken, { current: 'starting-pass-1', password: 'starting-pass-1' })).statusCode).toBe(400);
    const changed = await call('POST', '/auth/password', facToken, { current: 'starting-pass-1', password: 'starting-pass-2' });
    expect(changed.json().user.mustChangePassword).toBe(false);
    // The sign-in from before the change stops working; the change returns a fresh one.
    expect((await call('GET', '/events', facToken)).statusCode).toBe(401);
    facToken = changed.json().token;
    expect((await call('GET', '/events', facToken)).statusCode).toBe(200);
    fac2Token = (await call('POST', '/auth/login', undefined, { email: 'fac2@lab.test', password: 'starting-pass-1' })).json().token;
    fac2Token = (await call('POST', '/auth/password', fac2Token, { current: 'starting-pass-1', password: 'starting-pass-2' })).json().token;
    expect(facToken).toBeTruthy();
    expect((await call('GET', '/admin/users', facToken)).statusCode).toBe(403);
  });

  it('keeps at least one active admin, and blocks deactivated accounts', async () => {
    const users = (await call('GET', '/admin/users', adminToken)).json().users as { id: string; email: string }[];
    const admin = users.find((u) => u.email === 'admin@lab.test')!;
    // Nobody turns off or demotes themselves; the last Super Admin always stays.
    expect((await call('PATCH', `/admin/users/${admin.id}`, adminToken, { status: 'inactive' })).statusCode).toBe(403);
    const fac2 = users.find((u) => u.email === 'fac2@lab.test')!;
    await call('PATCH', `/admin/users/${fac2.id}`, adminToken, { status: 'inactive' });
    expect((await call('POST', '/auth/login', undefined, { email: 'fac2@lab.test', password: 'starting-pass-2' })).statusCode).toBe(401);
    // A sign-in made before the account was turned off stops working at once (OWASP A01).
    expect((await call('GET', '/events', fac2Token)).statusCode).toBe(401);
    await call('PATCH', `/admin/users/${fac2.id}`, adminToken, { status: 'active' });
    expect((await call('GET', '/events', fac2Token)).statusCode).toBe(200);
  });

  it('answers a missing account and a wrong password the same way', async () => {
    const wrong = await call('POST', '/auth/login', undefined, { email: 'fac2@lab.test', password: 'not-the-password' });
    const missing = await call('POST', '/auth/login', undefined, { email: 'nobody@lab.test', password: 'not-the-password' });
    expect([wrong.statusCode, missing.statusCode]).toEqual([401, 401]);
    expect(wrong.json().message).toBe(missing.json().message);
  });
});

describe('client IP for rate limits (OWASP A07)', () => {
  it('ignores a forged X-Forwarded-For unless a proxy is configured', async () => {
    let seen = '';
    const probe = await buildApp(db, { ...config, sweepMs: 0 });
    probe.addHook('onRequest', async (req) => { seen = req.ip; });
    await probe.inject({ method: 'GET', url: '/api/v1/auth/status', headers: { 'x-forwarded-for': '10.1.2.3' }, remoteAddress: '127.0.0.9' });
    expect(seen).toBe('127.0.0.9');
    const behind = await buildApp(db, { ...config, sweepMs: 0, trustProxy: 1 });
    behind.addHook('onRequest', async (req) => { seen = req.ip; });
    // One trusted proxy: the address it saw is used, and a faked one further left is not.
    await behind.inject({ method: 'GET', url: '/api/v1/auth/status', headers: { 'x-forwarded-for': '6.6.6.6, 10.1.2.3' }, remoteAddress: '127.0.0.9' });
    expect(seen).toBe('10.1.2.3');
    await Promise.all([probe.close(), behind.close()]);
  });
});

describe('CSV injection (OWASP)', () => {
  it('stops cells that start like a formula from running in Excel', () => {
    for (const s of ['=1+1', '+1', '-1', '@SUM(A1)', '\t=1', '\r=1']) expect(csvCell(s).startsWith(`"'`)).toBe(true);
    expect(csvCell('Fiji')).toBe('Fiji');
  });
});

const COUNTRIES = ['Fiji', 'Tonga', 'Tuvalu', 'Kiribati', 'Samoa', 'PNG', 'Philippines', 'Mongolia', 'Indonesia', 'Malaysia', 'India', 'Maldives'];

/** A multi-country workshop: one team per country (PNG is Papua New Guinea's code). */
async function newEvent(token: string, extra: object = {}) {
  const teams = COUNTRIES.map((c) => ({ countryCode: matchCountry(c) }));
  const r = await call('POST', '/events', token, { name: 'Sydney Bootcamp – Day 2', kind: 'workshop', scope: 'multi', teams, ...extra });
  expect(r.statusCode).toBe(201);
  return r.json();
}

async function joinCode(code: string, name?: string) {
  return (await call('POST', '/join', undefined, { teamCode: code, displayName: name })).json();
}

describe('facilitated event (acceptance test 5)', () => {
  it('creates 12 named groups with codes, countries pre-filled', async () => {
    const v = await newEvent(facToken);
    expect(v.event.code).toMatch(/^E-[0-9A-Z]{6}$/);
    expect(v.event.state).toBe('open');
    expect(v.groups).toHaveLength(12);
    // Names that are countries (or their codes, like PNG) pre-fill the country a team represents.
    expect(v.groups.map((g: any) => g.country)).toEqual(COUNTRIES.map((c) => (c === 'PNG' ? 'Papua New Guinea' : c)));
    expect(v.groups.map((g: any) => g.countryCode).slice(0, 3)).toEqual(['FJI', 'TON', 'TUV']);
    expect(new Set(v.groups.map((g: any) => g.teamCode)).size).toBe(12);
    expect(v.groups[0].joinUrl).toBe(`https://lab.test/join/${v.groups[0].teamCode}`);
  });

  it('shows events only to their facilitator (and admins)', async () => {
    const v = await newEvent(facToken, { name: 'Private' });
    expect((await call('GET', `/events/${v.event.id}`, fac2Token)).statusCode).toBe(404);
    expect((await call('GET', `/events/${v.event.id}`, adminToken)).statusCode).toBe(200);
    expect((await call('GET', '/events', fac2Token)).json().events.some((e: any) => e.id === v.event.id)).toBe(false);
  });

  it('dashboard shows progress, priorities and regional candidates', async () => {
    const v = await newEvent(facToken);
    const [fiji, tonga] = v.groups;
    for (const [g, pri, reg] of [[fiji, 'CR', 'TS'], [tonga, 'HFR', 'TS']] as const) {
      const j = await joinCode(g.teamCode);
      await call('PATCH', `/groups/${g.id}/worksheet`, j.groupToken, { ops: [
        { path: 'pw.priority', value: pri, baseVersion: 0 }, { path: 'rg.component', value: reg, baseVersion: 0 },
        { path: 'uc.option', value: 'IPS', baseVersion: 0 },
      ] });
    }
    const after = (await call('GET', `/events/${v.event.id}`, facToken)).json();
    const cards = Object.fromEntries(after.groups.map((g: any) => [g.country, g]));
    expect(cards.Fiji).toMatchObject({ priority: 'CR', regional: 'TS' });
    expect(cards.Fiji.progressPct).toBeGreaterThan(cards.Samoa.progressPct);
    expect(after.groups.filter((g: any) => g.regional === 'TS')).toHaveLength(2);
  });

  it('exports CSV with the SPEC §9.4 columns, UTF-8 with BOM', async () => {
    const v = await newEvent(facToken);
    const j = await joinCode(v.groups[0].teamCode);
    await call('PATCH', `/groups/${v.groups[0].id}/worksheet`, j.groupToken, { ops: [
      { path: 'rd.M1.01', value: 'done', baseVersion: 0 }, { path: 'pw.why', value: 'Referrals, "IPS" first', baseVersion: 0 },
      { path: 'pw.support.TA', value: true, baseVersion: 0 }, { path: 'pw.support.FUND', value: true, baseVersion: 0 },
    ] });
    const r = await call('GET', `/events/${v.event.id}/export.csv`, facToken);
    expect(r.statusCode).toBe(200);
    expect(r.body.charCodeAt(0)).toBe(0xfeff);
    const lines = r.body.slice(1).trim().split('\r\n');
    expect(lines[0].split(',')).toEqual(csvColumns());
    expect(lines).toHaveLength(13);
    for (const c of ['event_code', 'readiness_M1.01', 'need_CR', 'status_HIE', 'system_GEO', 'apps_9', 'regional_support_from', 'progress_pct']) expect(lines[0]).toContain(c);
    expect(lines[1]).toContain('"Referrals, ""IPS"" first"');
    expect(lines[1]).toContain(',TA;FUND,');
    const json = JSON.parse((await call('GET', `/events/${v.event.id}/export.json`, facToken)).body);
    expect(json.groups[0].worksheet['rd.M1.01']).toBe('done');
    const log = (await call('GET', `/events/${v.event.id}/edit-log.csv`, facToken)).body;
    expect(log).toContain('pw.support.TA');
  });

  it('adds, renames and removes teams', async () => {
    const v = await newEvent(facToken, { teams: [{ name: 'Table A' }, { name: 'Table B' }] });
    expect(v.groups.map((g: any) => g.name)).toEqual(['Table A', 'Table B']);
    const added = (await call('POST', `/events/${v.event.id}/groups`, facToken, { teams: [{ countryCode: 'NRU' }] })).json();
    expect(added.groups.map((g: any) => g.country)).toContain('Nauru');
    const renamed = (await call('PATCH', `/events/${v.event.id}/groups/${v.groups[0].id}`, facToken, { name: 'Table C' })).json();
    expect(renamed.groups[0].name).toBe('Table C');
    const removed = (await call('POST', `/events/${v.event.id}/groups/${v.groups[1].id}/remove`, facToken)).json();
    expect(removed.groups).toHaveLength(2);
    expect((await call('POST', '/join', undefined, { teamCode: v.groups[1].teamCode })).statusCode).toBe(404);
  });

  it('gives a read-only view token that cannot write', async () => {
    const v = await newEvent(facToken);
    const view = (await call('POST', `/events/${v.event.id}/groups/${v.groups[0].id}/view`, facToken)).json();
    expect((await call('GET', `/groups/${v.groups[0].id}/worksheet`, view.token)).json().readOnly).toBe(true);
    expect((await call('PATCH', `/groups/${v.groups[0].id}/worksheet`, view.token, { ops: [{ path: 'members', value: 'x', baseVersion: 0 }] })).statusCode).toBe(403);
  });
});

describe('time controls (acceptance test 6)', () => {
  const edit = async (gid: string, token: string) =>
    (await call('PATCH', `/groups/${gid}/worksheet`, token, { ops: [{ path: 'members', value: String(Math.random()), baseVersion: 0 }] })).statusCode;

  it('closes at the end time, then reopens when extended', async () => {
    const v = await newEvent(facToken, { endsAt: new Date(Date.now() + 5 * 60_000).toISOString() });
    const g = v.groups[0];
    expect(g.endsAt).toBe(v.event.endsAt);
    const j = await joinCode(g.teamCode);
    expect(await edit(g.id, j.groupToken)).toBe(200);

    // Simulate the end time passing, then the scheduled sweep.
    await db.query("UPDATE events SET ends_at = now() - interval '1 second' WHERE id = $1", [v.event.id]);
    await db.query("UPDATE groups SET ends_at = now() - interval '1 second' WHERE event_id = $1", [v.event.id]);
    await app.sweepNow();
    const closed = (await call('GET', `/events/${v.event.id}`, facToken)).json();
    expect(closed.event.state).toBe('closed');
    expect(closed.groups.every((x: any) => x.state === 'closed')).toBe(true);
    expect(await edit(g.id, j.groupToken)).toBe(409);
    expect((await joinCode(g.teamCode)).readOnly).toBe(true);

    const extended = (await call('POST', `/events/${v.event.id}/extend`, facToken, { minutes: 10 })).json();
    expect(extended.event.state).toBe('open');
    expect(new Date(extended.event.endsAt).getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);
    expect(extended.groups[0].endsAt).toBe(extended.event.endsAt);
    expect(await edit(g.id, j.groupToken)).toBe(200);
  });

  it('reopening an event reopens only the groups it closed', async () => {
    const v = await newEvent(facToken);
    await call('POST', `/events/${v.event.id}/groups/${v.groups[0].id}/close`, facToken);
    await call('POST', `/events/${v.event.id}/close`, facToken);
    const r = (await call('POST', `/events/${v.event.id}/reopen`, facToken)).json();
    const states = Object.fromEntries(r.groups.map((g: any) => [g.country, g.state]));
    expect(states.Fiji).toBe('closed');
    expect(states.Tonga).toBe('open');
  });

  it('keeps codes closed until a draft event starts', async () => {
    const v = await newEvent(facToken, { startsAt: new Date(Date.now() + 60 * 60_000).toISOString() });
    expect(v.event.state).toBe('draft');
    const r = await call('POST', '/join', undefined, { teamCode: v.groups[0].teamCode });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe('not_open');
    await call('POST', `/events/${v.event.id}/start`, facToken);
    expect((await call('POST', '/join', undefined, { teamCode: v.groups[0].teamCode })).statusCode).toBe(200);
  });
});

describe('sessions, teams and the two codes', () => {
  it('a single-team session has exactly one team; each team needs a country or a name', async () => {
    const one = { name: 'Tonga online', kind: 'open', scope: 'single' };
    expect((await call('POST', '/events', facToken, { ...one, teams: [{ countryCode: 'TON' }, { countryCode: 'FJI' }] })).json().message)
      .toBe('A single-team session has exactly one team.');
    expect((await call('POST', '/events', facToken, { ...one, teams: [{ name: '' }] })).json().message).toBe('Each team needs a country or a team name.');
    const v = (await call('POST', '/events', facToken, { ...one, teams: [{ countryCode: 'TON' }] })).json();
    expect(v.event).toMatchObject({ kind: 'open', scope: 'single' });
    expect((await call('POST', `/events/${v.event.id}/groups`, facToken, { teams: [{ countryCode: 'FJI' }] })).statusCode).toBe(400);
  });

  it('teams are a country, a country with a team name, or any team name', async () => {
    const v = await newEvent(facToken, { teams: [{ countryCode: 'WSM', name: 'Immunisation team' }, { name: 'Regional experts – data exchange' }] });
    expect(v.groups.map((g: any) => [g.name, g.country, g.countryCode])).toEqual([
      ['Immunisation team', 'Samoa', 'WSM'],
      ['Regional experts – data exchange', 'Regional experts – data exchange', null],
    ]);
    // The facilitator changes a team; the team can't change its own name or country.
    const changed = (await call('PATCH', `/events/${v.event.id}/groups/${v.groups[1].id}`, facToken, { countryCode: 'NRU' })).json();
    expect(changed.groups[1]).toMatchObject({ country: 'Nauru', countryCode: 'NRU' });
    const j = await joinCode(v.groups[1].teamCode);
    expect((await call('GET', `/groups/${v.groups[1].id}/worksheet`, j.groupToken)).json().worksheet).toMatchObject({ 'country.rep': true, 'country.code': 'NRU' });
    for (const path of ['country', 'country.rep', 'country.code']) {
      const r = await call('PATCH', `/groups/${v.groups[1].id}/worksheet`, j.groupToken, { ops: [{ path, value: path === 'country.rep' ? false : 'FJI', baseVersion: 0 }] });
      expect(r.statusCode, path).toBe(403);
    }
    // Only facilitators add teams.
    const added = (await call('POST', `/events/${v.event.id}/groups`, facToken, { teams: [{ countryCode: 'NIU' }] })).json();
    expect(added.groups.map((g: any) => g.country)).toContain('Niue');
  });

  it('a workshop code lists its teams to pick from; a team code goes straight in', async () => {
    const v = await newEvent(facToken, { teams: [{ countryCode: 'FJI' }, { name: 'Regional experts' }] });
    const look = (await call('POST', '/lookup', undefined, { code: v.event.code.toLowerCase().replace('-', ' ') })).json();
    expect(look.kind).toBe('workshop');
    expect(look.workshop.name).toBe(v.event.name);
    expect(look.teams.map((t: any) => t.label)).toEqual(['Fiji', 'Regional experts']);
    expect(look.teams[0]).not.toHaveProperty('teamCode');
    // Pick a team and join with several names on one line.
    const joined = await call('POST', '/join', undefined, { teamCode: v.event.code, groupId: look.teams[1].id, displayName: 'Ana, Ben, Mere' });
    expect(joined.statusCode).toBe(200);
    expect(joined.json().group.id).toBe(v.groups[1].id);
    // A team from another workshop can't be joined with this workshop's code.
    const other = await newEvent(facToken);
    expect((await call('POST', '/join', undefined, { teamCode: v.event.code, groupId: other.groups[0].id })).statusCode).toBe(404);
    expect((await call('POST', '/join', undefined, { teamCode: v.event.code })).statusCode).toBe(404);
    // Team codes.
    expect((await call('POST', '/lookup', undefined, { code: v.groups[0].teamCode })).json()).toEqual({ kind: 'team', team: { label: 'Fiji', practice: false } });
    expect((await call('POST', '/lookup', undefined, { code: 'ZZZ-ZZZ' })).statusCode).toBe(404);
    expect((await call('POST', '/lookup', undefined, { code: 'E-ZZZZZZ' })).statusCode).toBe(404);
  });

  it('hides team names from team-code readers once the team has closed', async () => {
    const v = await newEvent(facToken, { teams: [{ countryCode: 'VUT' }] });
    const g = v.groups[0];
    const member = (await joinCode(g.teamCode)).groupToken as string;
    const patch = await call('PATCH', `/groups/${g.id}/worksheet`, member, {
      ops: [{ path: 'members', value: 'Ana Silva (MoH)', baseVersion: 0 }, { path: 'buddies', value: 'Ben Lee (SPC)', baseVersion: 0 }],
    });
    expect(patch.statusCode).toBe(200);
    let ws = (await call('GET', `/groups/${g.id}/worksheet`, member)).json();
    expect(ws.worksheet.members).toBe('Ana Silva (MoH)');
    expect(ws.hiddenPaths).toEqual([]);

    await call('POST', `/events/${v.event.id}/groups/${g.id}/close`, facToken);
    const reader = (await joinCode(g.teamCode)).groupToken as string;
    ws = (await call('GET', `/groups/${g.id}/worksheet`, reader)).json();
    expect(ws.worksheet.members).toBeUndefined();
    expect(ws.worksheet.buddies).toBeUndefined();
    expect(ws.worksheet['country.code']).toBe('VUT');
    expect(ws.hiddenPaths).toEqual(['members', 'buddies']);
    expect(ws.versions.members).toBeUndefined();
    const xlsx = await call('GET', `/groups/${g.id}/export.xlsx`, reader);
    expect(xlsx.statusCode).toBe(200);
    expect(xlsx.body).not.toContain('Ana Silva');
    await call('POST', `/events/${v.event.id}/groups/${g.id}/reopen`, facToken);
    expect((await call('GET', `/groups/${g.id}/worksheet`, reader)).json().worksheet.members).toBe('Ana Silva (MoH)');
  });

  it('practice groups: shareable by code for 24 hours, then deleted', async () => {
    const r = await call('POST', '/groups', undefined, { practice: true });
    expect(r.statusCode).toBe(201);
    const p = r.json();
    expect(p.practice).toBe(true);
    expect(p.joinUrl).toBe(`https://lab.test/join/${p.teamCode}`);
    expect(new Date(p.expiresAt).getTime() - Date.now()).toBeGreaterThan(23.9 * 3_600_000);
    const ws = (await call('GET', `/groups/${p.groupId}/worksheet`, p.groupToken)).json();
    expect(ws.group.practice).toBe(true);
    expect((await call('PATCH', `/groups/${p.groupId}/worksheet`, p.groupToken, { ops: [{ path: 'members', value: 'Me', baseVersion: 0 }] })).statusCode).toBe(200);
    expect((await call('POST', '/lookup', undefined, { code: p.teamCode })).json()).toEqual({ kind: 'team', team: { label: null, practice: true } });
    const friend = await call('POST', '/join', undefined, { teamCode: p.teamCode, displayName: 'Friend' });
    expect(friend.statusCode).toBe(200);
    expect(friend.json().group.practice).toBe(true);
    // Once a day old the code stops working, even before the sweep deletes it.
    await db.query("UPDATE groups SET starts_at = now() - interval '25 hours' WHERE id = $1", [p.groupId]);
    expect((await call('POST', '/join', undefined, { teamCode: p.teamCode })).statusCode).toBe(404);
    // A day later it is gone, edit log and all; other teams are untouched.
    const real = await makeTeam(db, 'Kept');
    await db.query("UPDATE groups SET created_at = now() - interval '25 hours' WHERE id = ANY($1::uuid[])", [[p.groupId, real.groupId]]);
    await app.sweepNow();
    expect((await db.query('SELECT 1 FROM groups WHERE id = $1', [p.groupId])).rows).toHaveLength(0);
    expect((await db.query('SELECT 1 FROM edit_log WHERE group_id = $1', [p.groupId])).rows).toHaveLength(0);
    expect((await db.query('SELECT 1 FROM groups WHERE id = $1', [real.groupId])).rows).toHaveLength(1);
  });

  it('moves earlier groups into one open session run by the Super Admin, with no country', async () => {
    const a = await makeTeam(db, 'Fiji');
    await db.query(`UPDATE groups SET worksheet = '{"country":"Fiji","country.rep":true,"country.code":"FJI"}'::jsonb WHERE id = $1`, [a.groupId]);
    const b = await makeTeam(db, 'Asked to join');
    const v = await newEvent(facToken);
    await db.query("UPDATE groups SET event_id = $2, link_status = 'pending' WHERE id = $1", [b.groupId, v.event.id]);
    expect(await adoptOrphanGroups(db)).toBeGreaterThanOrEqual(2);
    expect(await adoptOrphanGroups(db)).toBe(0);
    const { rows } = await db.query<{ event_id: string; ws: Record<string, unknown> }>('SELECT event_id, worksheet AS ws FROM groups WHERE id = $1', [a.groupId]);
    const ev = (await db.query<{ name: string; kind: string; owner: string }>(
      'SELECT e.name, e.kind, u.role AS owner FROM events e JOIN users u ON u.id = e.facilitator_id WHERE e.id = $1', [rows[0].event_id])).rows[0];
    expect(ev).toEqual({ name: 'Earlier groups', kind: 'open', owner: 'super_admin' });
    expect(rows[0].ws).toEqual({ country: 'Fiji' });
    expect((await db.query<{ e: string }>('SELECT event_id AS e FROM groups WHERE id = $1', [b.groupId])).rows[0].e).toBe(rows[0].event_id);
    // Their team codes still work.
    expect((await call('POST', '/join', undefined, { teamCode: a.teamCode })).statusCode).toBe(200);
  });
});

describe('sessions nobody ends (SPEC §4.4)', () => {
  it('closes a do-it-yourself group after 14 days without activity, keeping its answers', async () => {
    const g = await makeTeam(db, 'Niue');
    const j = await joinCode(g.teamCode);
    await call('PATCH', `/groups/${g.groupId}/worksheet`, j.groupToken, { ops: [{ path: 'members', value: 'Ana', baseVersion: 0 }, { path: 'uc.text', value: 'Referrals', baseVersion: 0 }] });
    const before = (await call('GET', `/groups/${g.groupId}/worksheet`, j.groupToken)).json();
    expect(new Date(before.idleCloseAt).getTime()).toBeGreaterThan(Date.now() + 13 * 86_400_000);

    await db.query("UPDATE groups SET updated_at = now() - interval '15 days' WHERE id = $1", [g.groupId]);
    await app.sweepNow();
    const after = (await call('GET', `/groups/${g.groupId}/worksheet`, j.groupToken)).json();
    expect(after.group.state).toBe('closed');
    // Answers are kept; team names are withheld from team-code readers once closed.
    expect(after.worksheet['uc.text']).toBe('Referrals');
    expect(after.hiddenPaths).toEqual(['members']);
    const { rows } = await db.query<{ m: string }>("SELECT worksheet->>'members' AS m FROM groups WHERE id = $1", [g.groupId]);
    expect(rows[0].m).toBe('Ana');
  });

  it('closes an event with no end time after 14 days without activity', async () => {
    const v = await newEvent(facToken, { teams: [{ countryCode: 'PLW' }] });
    await db.query("UPDATE events SET updated_at = now() - interval '15 days' WHERE id = $1", [v.event.id]);
    await db.query("UPDATE groups SET updated_at = now() - interval '15 days' WHERE event_id = $1", [v.event.id]);
    await app.sweepNow();
    expect((await call('GET', `/events/${v.event.id}`, facToken)).json().event.state).toBe('closed');
  });

  it('stops opening a group with its team code 90 days after it closed', async () => {
    const g = await makeTeam(db, 'Nauru');
    await db.query("UPDATE groups SET state = 'closed', closed_at = now() - interval '91 days' WHERE id = $1", [g.groupId]);
    const r = await call('POST', '/join', undefined, { teamCode: g.teamCode });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe('archived');
  });

  it('renews a sign-in while the group is open, not after it closes', async () => {
    const g = await makeTeam(db, 'Cook Islands');
    const j = await joinCode(g.teamCode, 'Ana');
    const renewed = await call('POST', `/groups/${g.groupId}/token`, j.groupToken);
    expect(renewed.statusCode).toBe(200);
    expect((await call('GET', `/groups/${g.groupId}/worksheet`, renewed.json().groupToken)).statusCode).toBe(200);
    await db.query("UPDATE groups SET state = 'closed', closed_at = now() WHERE id = $1", [g.groupId]);
    expect((await call('POST', `/groups/${g.groupId}/token`, j.groupToken)).statusCode).toBe(409);
  });
});

describe('roles and co-facilitators', () => {
  let adminRoleToken = '';
  const signInFresh = async (email: string, start: string) => {
    const t = (await call('POST', '/auth/login', undefined, { email, password: start })).json().token as string;
    return (await call('POST', '/auth/password', t, { current: start, password: `${start}-own` })).json().token as string;
  };

  it('only the Super Admin adds or changes admins; admins manage facilitators', async () => {
    expect((await call('POST', '/admin/users', adminToken, { email: 'ad@lab.test', name: 'Ari', role: 'admin', password: 'starting-pass-9' })).statusCode).toBe(201);
    adminRoleToken = await signInFresh('ad@lab.test', 'starting-pass-9');
    expect((await call('POST', '/admin/users', adminRoleToken, { email: 'ad2@lab.test', name: 'X', role: 'admin', password: 'starting-pass-9' })).statusCode).toBe(403);
    const f = await call('POST', '/admin/users', adminRoleToken, { email: 'fac3@lab.test', name: 'Flo', role: 'facilitator', password: 'starting-pass-9' });
    expect(f.statusCode).toBe(201);
    expect(f.json().user.mustChangePassword).toBe(true);
    const users = (await call('GET', '/admin/users', adminRoleToken)).json().users as { id: string; email: string; role: string }[];
    const sup = users.find((u) => u.role === 'super_admin')!;
    expect((await call('PATCH', `/admin/users/${sup.id}`, adminRoleToken, { status: 'inactive' })).statusCode).toBe(403);
    const fac3 = users.find((u) => u.email === 'fac3@lab.test')!;
    expect((await call('PATCH', `/admin/users/${fac3.id}`, adminRoleToken, { role: 'admin' })).statusCode).toBe(403);
    // An admin's password reset is temporary.
    await call('PATCH', `/admin/users/${fac3.id}`, adminRoleToken, { password: 'reset-pass-123' });
    const back = await call('POST', '/auth/login', undefined, { email: 'fac3@lab.test', password: 'reset-pass-123' });
    expect(back.json().user.mustChangePassword).toBe(true);
  });

  it('co-facilitators run the workshop too; admins see every workshop', async () => {
    const v = await newEvent(facToken, { name: 'Shared' });
    expect((await call('GET', `/events/${v.event.id}`, fac2Token)).statusCode).toBe(404);
    expect((await call('POST', `/events/${v.event.id}/facilitators`, facToken, { email: 'nobody@lab.test' })).statusCode).toBe(404);
    const added = await call('POST', `/events/${v.event.id}/facilitators`, facToken, { email: 'fac2@lab.test' });
    expect(added.json().coFacilitators.map((p: any) => p.email)).toEqual(['fac2@lab.test']);
    expect((await call('GET', `/events/${v.event.id}`, fac2Token)).statusCode).toBe(200);
    expect((await call('GET', '/events', fac2Token)).json().events.some((e: any) => e.id === v.event.id)).toBe(true);
    // Leaving the workshop takes it away again.
    const fac2Id = added.json().coFacilitators[0].id;
    expect((await call('DELETE', `/events/${v.event.id}/facilitators/${fac2Id}`, fac2Token)).json()).toEqual({ left: true });
    expect((await call('GET', `/events/${v.event.id}`, fac2Token)).statusCode).toBe(404);
    const mine = (await call('GET', '/events', adminRoleToken)).json().events.length;
    const all = (await call('GET', '/events?all=1', adminRoleToken)).json().events.length;
    expect(all).toBeGreaterThan(mine);
    // Admins hand a workshop to someone else; facilitators can't.
    expect((await call('PATCH', `/events/${v.event.id}`, facToken, { facilitatorId: fac2Id })).statusCode).toBe(403);
    const moved = await call('PATCH', `/events/${v.event.id}`, adminRoleToken, { facilitatorId: fac2Id });
    expect(moved.json().facilitator.email).toBe('fac2@lab.test');
  });

  it('lists every team for admins and opens any of them read-only', async () => {
    expect((await call('GET', '/admin/groups', facToken)).statusCode).toBe(403);
    const list = (await call('GET', '/admin/groups', adminRoleToken)).json().groups as any[];
    const samoa = list.find((g) => g.countryCode === 'WSM')!;
    expect(samoa).toMatchObject({ label: 'Samoa' });
    const view = await call('POST', `/admin/groups/${samoa.id}/view`, adminRoleToken);
    expect(view.json().token).toBeTruthy();
  });
});

describe('submit with consent (Summary step)', () => {
  it('saves a dated snapshot and the sharing choice; resubmitting replaces the choice', async () => {
    const v = await newEvent(facToken, { name: 'Submit test' });
    const j = await joinCode(v.groups[0].teamCode, 'Ana');
    const gid = j.group.id;
    expect((await call('POST', `/groups/${gid}/submit`, j.groupToken, {})).statusCode).toBe(400);
    const first = await call('POST', `/groups/${gid}/submit`, j.groupToken, { share: true });
    expect(first.json().submission).toMatchObject({ by: 'Ana', share: true });
    const ws = (await call('GET', `/groups/${gid}/worksheet`, j.groupToken)).json();
    expect(ws.submission.share).toBe(true);
    let row = (await db.query<{ consent: string; submitted_at: Date | null }>('SELECT consent, submitted_at FROM groups WHERE id = $1', [gid])).rows[0];
    expect(row.consent).toBe('identified');
    expect(row.submitted_at).toBeTruthy();
    // A second submission straight away is refused; after the gap it replaces the choice.
    expect((await call('POST', `/groups/${gid}/submit`, j.groupToken, { share: false })).statusCode).toBe(429);
    await new Promise((r) => setTimeout(r, 1600));
    await call('POST', `/groups/${gid}/submit`, j.groupToken, { share: false });
    row = (await db.query<{ consent: string; submitted_at: Date | null }>('SELECT consent, submitted_at FROM groups WHERE id = $1', [gid])).rows[0];
    expect(row.consent).toBe('private');
    const n = (await db.query<{ n: number; code: string | null }>('SELECT count(*)::int AS n, max(country_code) AS code FROM submissions WHERE group_id = $1', [gid])).rows[0];
    expect(n).toEqual({ n: 2, code: 'FJI' });
    // The facilitator's card shows it was submitted.
    const card = (await call('GET', `/events/${v.event.id}`, facToken)).json().groups[0];
    expect(card.submittedAt).toBeTruthy();
  });
});

describe('security fixes before going public', () => {
  it('a new team code ends the old code and sign-ins made with it', async () => {
    const v = await newEvent(facToken, { teams: [{ countryCode: 'FJI' }] });
    const g = v.groups[0];
    const old = await joinCode(g.teamCode, 'Ana');
    const after = (await call('POST', `/events/${v.event.id}/groups/${g.id}/newcode`, facToken)).json();
    const fresh = after.groups[0].teamCode;
    expect(fresh).not.toBe(g.teamCode);
    expect((await call('GET', `/groups/${g.id}/worksheet`, old.groupToken)).statusCode).toBe(401);
    expect((await call('POST', '/join', undefined, { teamCode: g.teamCode })).statusCode).toBe(404);
    const again = await joinCode(fresh);
    expect((await call('GET', `/groups/${g.id}/worksheet`, again.groupToken)).statusCode).toBe(200);
  });

  it('co-facilitators run a session but only the lead or an admin deletes it or manages co-facilitators', async () => {
    const v = await newEvent(facToken, { teams: [{ countryCode: 'TON' }] });
    await call('POST', `/events/${v.event.id}/facilitators`, facToken, { email: 'fac2@lab.test' });
    expect((await call('POST', `/events/${v.event.id}/delete`, fac2Token)).statusCode).toBe(403);
    expect((await call('POST', `/events/${v.event.id}/facilitators`, fac2Token, { email: 'admin@lab.test' })).statusCode).toBe(403);
    expect((await call('POST', `/events/${v.event.id}/start`, fac2Token)).statusCode).toBe(200);
  });

  it('refuses submissions once a team has closed, and presence from read-only views', async () => {
    const v = await newEvent(facToken, { teams: [{ countryCode: 'WSM' }] });
    const g = v.groups[0];
    const j = await joinCode(g.teamCode);
    await call('POST', `/events/${v.event.id}/groups/${g.id}/close`, facToken);
    expect((await call('POST', `/groups/${g.id}/submit`, j.groupToken, { share: true })).statusCode).toBe(409);
    const view = (await call('POST', `/events/${v.event.id}/groups/${g.id}/view`, facToken)).json();
    expect((await call('POST', `/groups/${g.id}/presence`, view.token, { clientId: 'x', step: 1 })).statusCode).toBe(403);
  });

  it('answers malformed ids with "not found", not a server error', async () => {
    expect((await call('GET', '/events/not-a-uuid', facToken)).statusCode).toBe(404);
    expect((await call('GET', '/groups/not-a-uuid/worksheet', facToken)).statusCode).toBe(404);
  });

  it('counts IPv6 addresses by their /64, and refuses weak production secrets', () => {
    expect(addressKey('2001:db8:1:2:aaaa::1')).toBe(addressKey('2001:db8:1:2:bbbb::9'));
    expect(addressKey('2001:db8:1:3::1')).not.toBe(addressKey('2001:db8:1:2::1'));
    expect(addressKey('::ffff:10.0.0.1')).toBe('10.0.0.1');
    expect(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'local-dev-secret-change-me' })).toThrow(/32 random/);
    expect(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(31) })).toThrow(/32 random/);
    expect(loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'Qm9y'.repeat(10) }).jwtSecret).toHaveLength(40);
  });
});
