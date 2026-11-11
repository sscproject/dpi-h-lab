// API tests against a real (in-memory PGlite) PostgreSQL: start, join, read, patch, merge, close.

import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../server/app';
import type { Config } from '../server/config';
import { seedContent } from '../server/content-store';
import { pgliteDb, type Db } from '../server/db';
import { migrate } from '../server/migrate';
import { makeTeam } from './helpers';

let db: Db;
let app: Awaited<ReturnType<typeof buildApp>>;

const config: Config = {
  port: 0, host: '127.0.0.1', jwtSecret: 'test-secret', contentJson: 'content/content.json',
  clientDist: 'does-not-exist', rateLimitPerMinute: 1000, publicUrl: 'https://lab.test', sweepMs: 0, idleDays: 14, codeReadDays: 90,
};

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

const start = (name = 'Fiji') => makeTeam(db, name);

async function join(teamCode: string, displayName?: string) {
  const res = await app.inject({ method: 'POST', url: '/api/v1/join', payload: { teamCode, displayName } });
  return res;
}

const patch = (id: string, token: string, ops: unknown[]) =>
  app.inject({ method: 'PATCH', url: `/api/v1/groups/${id}/worksheet`, headers: { authorization: `Bearer ${token}` }, payload: { ops, clientId: 'c1' } });

const read = async (id: string, token: string) =>
  (await app.inject({ method: 'GET', url: `/api/v1/groups/${id}/worksheet`, headers: { authorization: `Bearer ${token}` } })).json();

describe('joining a team', () => {
  it('starts only practice groups from the home page; facilitators set up every other team', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/v1/groups', payload: { name: 'Fiji' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/v1/owner/session', payload: {} })).statusCode).toBe(404);
  });

  it('joins case-insensitively, ignoring spaces and dashes, and pre-fills country', async () => {
    const g = await start('Tonga');
    const res = await join(` ${g.teamCode.toLowerCase().replace('-', ' ')} `, 'Mele');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.group.id).toBe(g.groupId);
    expect(body.readOnly).toBe(false);
    const ws = await read(g.groupId, body.groupToken);
    expect(ws.worksheet).toEqual({ country: 'Tonga' });
    expect(ws.group.contentVersion).toBe(JSON.parse(readFileSync('content/content.json', 'utf8')).version);
  });

  it('gives one message for unknown codes', async () => {
    const res = await join('ZZZ-ZZZ');
    expect(res.statusCode).toBe(404);
    expect(res.json().message).toBe("We can't find that code. Check it with your group or facilitator.");
  });

  it('rejects a token for another group', async () => {
    const a = await start('A');
    const b = await start('B');
    const tokenA = (await join(a.teamCode)).json().groupToken;
    const res = await app.inject({ method: 'GET', url: `/api/v1/groups/${b.groupId}/worksheet`, headers: { authorization: `Bearer ${tokenA}` } });
    expect(res.statusCode).toBe(403);
  });
});

describe('worksheet patches', () => {
  it('saves fields, versions them and logs each change', async () => {
    const g = await start();
    const token = (await join(g.teamCode, 'Ana')).json().groupToken;
    const res = await patch(g.groupId, token, [
      { path: 'uc.option', value: 'IPS', baseVersion: 0 },
      { path: 'rd.M1.01', value: 'done', baseVersion: 0 },
      { path: 'cp.CR.need', value: 'yes', baseVersion: 0 },
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.json().applied).toEqual([
      { path: 'uc.option', version: 1, conflict: false },
      { path: 'rd.M1.01', version: 1, conflict: false },
      { path: 'cp.CR.need', version: 1, conflict: false },
    ]);
    const ws = await read(g.groupId, token);
    expect(ws.worksheet).toMatchObject({ 'uc.option': 'IPS', 'rd.M1.01': 'done', 'cp.CR.need': 'yes' });
    expect(ws.versions).toMatchObject({ 'uc.option': 1 });
    const log = await db.query<{ path: string; display_name: string; new_value: unknown }>('SELECT path, display_name, new_value FROM edit_log WHERE group_id = $1 ORDER BY id', [g.groupId]);
    expect(log.rows).toEqual([
      { path: 'uc.option', display_name: 'Ana', new_value: 'IPS' },
      { path: 'rd.M1.01', display_name: 'Ana', new_value: 'done' },
      { path: 'cp.CR.need', display_name: 'Ana', new_value: 'yes' },
    ]);
  });

  it('merges different fields from two members (FR-R3)', async () => {
    const g = await start();
    const a = (await join(g.teamCode, 'A')).json().groupToken;
    const b = (await join(g.teamCode, 'B')).json().groupToken;
    await Promise.all([
      patch(g.groupId, a, [{ path: 'members', value: 'Ana, Ben', baseVersion: 0 }]),
      patch(g.groupId, b, [{ path: 'buddies', value: 'HL7', baseVersion: 0 }]),
    ]);
    expect((await read(g.groupId, a)).worksheet).toMatchObject({ members: 'Ana, Ben', buddies: 'HL7' });
  });

  it('last write wins on the same field and reports the conflict', async () => {
    const g = await start();
    const a = (await join(g.teamCode, 'A')).json().groupToken;
    const b = (await join(g.teamCode, 'B')).json().groupToken;
    await patch(g.groupId, a, [{ path: 'uc.text', value: 'first', baseVersion: 0 }]);
    const res = await patch(g.groupId, b, [{ path: 'uc.text', value: 'second', baseVersion: 0 }]);
    expect(res.json().applied[0]).toEqual({ path: 'uc.text', version: 2, conflict: true });
    expect((await read(g.groupId, a)).worksheet['uc.text']).toBe('second');
  });

  it('clears a field with null', async () => {
    const g = await start();
    const t = (await join(g.teamCode)).json().groupToken;
    await patch(g.groupId, t, [{ path: 'cp.TS.status', value: 'P', baseVersion: 0 }]);
    await patch(g.groupId, t, [{ path: 'cp.TS.status', value: null, baseVersion: 1 }]);
    expect((await read(g.groupId, t)).worksheet).not.toHaveProperty('cp.TS.status');
  });

  it('rejects unknown paths and over-length text without saving anything', async () => {
    const g = await start();
    const t = (await join(g.teamCode)).json().groupToken;
    const res = await patch(g.groupId, t, [
      { path: 'members', value: 'ok', baseVersion: 0 },
      { path: 'hack', value: 'x', baseVersion: 0 },
      { path: 'members', value: 'x'.repeat(1001), baseVersion: 0 },
    ]);
    expect(res.statusCode).toBe(400);
    expect(res.json().detail).toEqual([
      { path: 'hack', error: 'unknown_path' },
      { path: 'members', error: 'too_long' },
    ]);
    expect((await read(g.groupId, t)).worksheet).not.toHaveProperty('members');
  });

  it('opens closed groups read-only and refuses edits immediately (FR-J2)', async () => {
    const g = await start();
    const t = (await join(g.teamCode)).json().groupToken;
    await db.query(`UPDATE groups SET state = 'closed' WHERE id = $1`, [g.groupId]);
    expect((await patch(g.groupId, t, [{ path: 'members', value: 'x', baseVersion: 0 }])).statusCode).toBe(409);
    const rejoin = (await join(g.teamCode)).json();
    expect(rejoin.readOnly).toBe(true);
    expect((await read(g.groupId, rejoin.groupToken)).worksheet).toEqual({ country: 'Fiji' });
  });

  it('treats a group past its end time as closed', async () => {
    const g = await start();
    const t = (await join(g.teamCode)).json().groupToken;
    await db.query(`UPDATE groups SET ends_at = now() - interval '1 minute' WHERE id = $1`, [g.groupId]);
    expect((await patch(g.groupId, t, [{ path: 'members', value: 'x', baseVersion: 0 }])).statusCode).toBe(409);
  });

  it('hides deleted groups like unknown codes', async () => {
    const g = await start();
    await db.query(`UPDATE groups SET state = 'deleted', deleted_at = now() WHERE id = $1`, [g.groupId]);
    const res = await join(g.teamCode);
    expect(res.statusCode).toBe(404);
    expect(res.json().message).toBe("We can't find that code. Check it with your group or facilitator.");
  });
});

describe('content', () => {
  it('serves the active version', async () => {
    const { version } = (await app.inject({ url: '/api/v1/content/active' })).json();
    const res = await app.inject({ url: `/api/v1/content/${version}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('immutable');
    expect(res.json().items).toHaveLength(JSON.parse(readFileSync('content/content.json', 'utf8')).items.length);
  });
});
