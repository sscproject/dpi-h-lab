// Live sync over the real HTTP server: one member's saved edit reaches the others (FR-R2),
// presence lists who is connected and on which step (FR-J4).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../server/app';
import type { Config } from '../server/config';
import { seedContent } from '../server/content-store';
import { pgliteDb, type Db } from '../server/db';
import { migrate } from '../server/migrate';
import { makeTeam } from './helpers';

let db: Db;
let app: Awaited<ReturnType<typeof buildApp>>;
let base = '';

beforeAll(async () => {
  db = await pgliteDb();
  await migrate(db);
  const config: Config = { port: 0, host: '127.0.0.1', jwtSecret: 'test', contentJson: 'content/content.json', clientDist: 'none', rateLimitPerMinute: 1000, sweepMs: 0, idleDays: 14, codeReadDays: 90 };
  await seedContent(db, config.contentJson);
  app = await buildApp(db, config);
  base = await app.listen({ port: 0, host: '127.0.0.1' });
});
afterAll(async () => {
  await app.close();
  await db.close();
});

const json = async (path: string, init: RequestInit = {}) => {
  const res = await fetch(base + '/api/v1' + path, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
  return res.status === 204 ? null : res.json();
};

/** Opens an event stream and collects events until closed. */
function listen(groupId: string, token: string, clientId: string, step = 0) {
  const events: { event: string; data: any }[] = [];
  const ctrl = new AbortController();
  const ready = (async () => {
    const res = await fetch(`${base}/api/v1/groups/${groupId}/stream?clientId=${clientId}&step=${step}`, { headers: { authorization: `Bearer ${token}` }, signal: ctrl.signal });
    expect(res.status).toBe(200);
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const frame = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const ev = /^event: (.*)$/m.exec(frame)?.[1];
            const data = /^data: (.*)$/m.exec(frame)?.[1];
            if (ev && data) events.push({ event: ev, data: JSON.parse(data) });
          }
        }
      } catch { /* aborted */ }
    })();
  })();
  const waitFor = async (pred: (e: { event: string; data: any }) => boolean, ms = 2000) => {
    const start = Date.now();
    while (Date.now() - start < ms) {
      const hit = events.find(pred);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`No matching event within ${ms} ms: ${JSON.stringify(events.map((e) => e.event))}`);
  };
  return { events, ready, waitFor, close: () => ctrl.abort() };
}

describe('live sync', () => {
  it('pushes a saved edit to other members within 2 seconds, with the author', async () => {
    const g = await makeTeam(db, 'Samoa');
    const a = await json('/join', { method: 'POST', body: JSON.stringify({ teamCode: g.teamCode, displayName: 'Ana' }) });
    const b = await json('/join', { method: 'POST', body: JSON.stringify({ teamCode: g.teamCode }) });
    const c = await json('/join', { method: 'POST', body: JSON.stringify({ teamCode: g.teamCode }) });

    const sa = listen(g.groupId, a.groupToken, 'client-a');
    const sb = listen(g.groupId, b.groupToken, 'client-b', 2);
    const sc = listen(g.groupId, c.groupToken, 'client-c');
    await Promise.all([sa.ready, sb.ready, sc.ready]);
    expect((await sb.waitFor((e) => e.event === 'state')).data.state).toBe('open');

    const t0 = Date.now();
    await json(`/groups/${g.groupId}/worksheet`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${a.groupToken}` },
      body: JSON.stringify({ clientId: 'client-a', ops: [{ path: 'pw.why', value: 'Referrals fail', baseVersion: 0 }] }),
    });
    for (const s of [sb, sc]) {
      const ev = await s.waitFor((e) => e.event === 'patch');
      expect(ev.data.ops).toEqual([{ path: 'pw.why', value: 'Referrals fail', version: 1 }]);
      expect(ev.data.by.name).toBe('Ana');
      expect(ev.data.clientId).toBe('client-a');
    }
    expect(Date.now() - t0).toBeLessThan(2000);
    [sa, sb, sc].forEach((s) => s.close());
  });

  it('lists who is connected and which step they are on', async () => {
    const g = await makeTeam(db, 'Tonga');
    const a = await json('/join', { method: 'POST', body: JSON.stringify({ teamCode: g.teamCode, displayName: 'Mele' }) });
    const b = await json('/join', { method: 'POST', body: JSON.stringify({ teamCode: g.teamCode }) });
    const sa = listen(g.groupId, a.groupToken, 'pa', 1);
    await sa.ready;
    const sb = listen(g.groupId, b.groupToken, 'pb', 3);
    await sb.ready;
    const both = await sa.waitFor((e) => e.event === 'presence' && e.data.length === 2);
    expect(both.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ clientId: 'pa', name: 'Mele', step: 1 }),
      expect.objectContaining({ clientId: 'pb', name: null, step: 3, guestNo: 2 }),
    ]));

    await json(`/groups/${g.groupId}/presence`, { method: 'POST', headers: { authorization: `Bearer ${b.groupToken}` }, body: JSON.stringify({ clientId: 'pb', step: 5 }) });
    await sa.waitFor((e) => e.event === 'presence' && e.data.some((p: any) => p.clientId === 'pb' && p.step === 5));

    sb.close();
    await sa.waitFor((e) => e.event === 'presence' && e.data.length === 1);
    sa.close();
  });

  it('pushes group progress to the facilitator dashboard live (FR-F3)', async () => {
    let logged = '';
    await app.setup.refresh(db, (m) => { logged = m; });
    const code = /setup code: (\w+)/.exec(logged)![1];
    const staff = await json('/auth/setup', { method: 'POST', body: JSON.stringify({ setupCode: code, email: 'a@lab.test', name: 'A', password: 'long-enough-pw' }) });
    const ev = await json('/events', { method: 'POST', headers: { authorization: `Bearer ${staff.token}` }, body: JSON.stringify({ name: 'Live', kind: 'workshop', scope: 'multi', teams: [{ countryCode: 'FJI' }] }) });
    const g = ev.groups[0];
    const ctrl = new AbortController();
    const res = await fetch(`${base}/api/v1/events/${ev.event.id}/stream`, { headers: { authorization: `Bearer ${staff.token}` }, signal: ctrl.signal });
    expect(res.status).toBe(200);
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    const member = await json('/join', { method: 'POST', body: JSON.stringify({ teamCode: g.teamCode }) });
    await json(`/groups/${g.id}/worksheet`, {
      method: 'PATCH', headers: { authorization: `Bearer ${member.groupToken}` },
      body: JSON.stringify({ ops: [{ path: 'rg.component', value: 'TS', baseVersion: 0 }, { path: 'uc.option', value: 'IPS', baseVersion: 0 }] }),
    });
    let buf = '';
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && !/event: group\ndata: .*"regional":"TS"/.test(buf)) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
    }
    ctrl.abort();
    expect(buf).toMatch(/event: group\ndata: .*"regional":"TS"/);
  });

  it('rejects a stream without a valid token', async () => {
    const g = await makeTeam(db, 'PNG');
    const res = await fetch(`${base}/api/v1/groups/${g.groupId}/stream?clientId=x`, { headers: { authorization: 'Bearer nope' } });
    expect(res.status).toBe(401);
  });

  it('exports every answer to Excel', async () => {
    const g = await makeTeam(db, 'Fiji');
    const a = await json('/join', { method: 'POST', body: JSON.stringify({ teamCode: g.teamCode }) });
    await json(`/groups/${g.groupId}/worksheet`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${a.groupToken}` },
      body: JSON.stringify({ ops: [
        { path: 'uc.option', value: 'IPS', baseVersion: 0 }, { path: 'rd.M1.07', value: 'done', baseVersion: 0 },
        { path: 'cp.CR.need', value: 'yes', baseVersion: 0 }, { path: 'cp.CR.status', value: 'P', baseVersion: 0 },
        { path: 'mp.sys.HMIS', value: 'DHIS2', baseVersion: 0 }, { path: 'pw.support.TA', value: true, baseVersion: 0 },
      ] }),
    });
    const res = await fetch(`${base}/api/v1/groups/${g.groupId}/export.xlsx`, { headers: { authorization: `Bearer ${a.groupToken}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain("filename*=UTF-8''DPI-H%20pathway%20-%20Fiji.xlsx");
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Summary', 'Sheet 1', 'Sheet 2 Map', 'Sheet 3 Pathway', 'Who decides', 'All answers']);
    const cells = (name: string) => wb.getWorksheet(name)!.getSheetValues().flat().map(String);
    expect(cells('Sheet 1')).toEqual(expect.arrayContaining(['★ Client Registry', 'Yes', 'P – Partial', 'Done']));
    expect(cells('Sheet 2 Map')).toContain('DHIS2');
    expect(cells('Sheet 3 Pathway')).toContain('Technical assistance');
    expect(cells('All answers')).toEqual(expect.arrayContaining(['country', 'Fiji', 'pw.support.TA', 'TRUE']));
  });

  it('serves the summary in the group\'s content version', async () => {
    const g = await makeTeam(db, 'Kiribati');
    const a = await json('/join', { method: 'POST', body: JSON.stringify({ teamCode: g.teamCode }) });
    const s = await json(`/groups/${g.groupId}/summary`, { headers: { authorization: `Bearer ${a.groupToken}` } });
    expect(s.readoutText).toMatch(/^We are Kiribati\. We focused on \[…\]/);
    expect(s.markdown).toContain('# DPI-H pathway: Kiribati');
  });
});
