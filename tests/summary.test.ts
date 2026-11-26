import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Content } from '../shared/content';
import { buildSummary, summaryMarkdown, summaryText } from '../shared/summary';
import { collapse, loadQueue, saveQueue, type QueueStorage } from '../client/src/worksheet/queue';

const content: Content = JSON.parse(readFileSync('content/content.json', 'utf8'));

describe('summary (FR-SU1, SU2)', () => {
  it('marks every missing value as […]', () => {
    const s = buildSummary({}, content);
    expect(s.readout.filter((p) => p.missing)).toHaveLength(11);
    expect(s.readoutText).toContain('We are […].');
    // Everything is empty, and the list of what is still to complete says so.
    expect(s.facts.filter((f) => f.label !== 'Still to complete').every((f) => f.value === '—')).toBe(true);
    expect(s.facts.find((f) => f.label === 'Still to complete')?.value).toBe('National priority; 12-month action; Who owns the action; Who decides (4 left)');
  });

  it('fills the readout in template order from the worksheet', () => {
    const s = buildSummary({
      country: 'Fiji', 'uc.option': 'IPS', 'pw.priority': 'CR', 'pw.why': 'referrals fail', 'pw.action': 'agree the health ID',
      'pw.owner': 'HIS unit', 'pw.support.TA': true, 'pw.support.FUND': true, 'pw.from': 'World Bank',
      'rg.component': 'TS', 'rg.lead': 'OTHER', 'rg.leadOther': 'PIHOA', 'rg.why': 'shared codes',
    }, content);
    expect(s.readoutText).toBe(
      'We are Fiji. We focused on International Patient Summary. Our national priority is Client Registry, because referrals fail. ' +
      'In the next 12 months we will agree the health ID, led by HIS unit, and we need Technical assistance, Funding from World Bank. ' +
      'Regionally, we think Terminology Service should be done together, led by PIHOA, because shared codes.',
    );
    expect(s.title).toBe('DPI-H pathway: Fiji');
  });

  it('uses the team\'s own title for "Other"', () => {
    expect(buildSummary({ 'uc.option': 'OTH', 'uc.otherTitle': 'NCD follow-up' }, content).readoutText).toContain('We focused on NCD follow-up.');
  });

  it('lists key facts', () => {
    const s = buildSummary({
      'rd.M1.01': 'done', 'rd.M1.02': 'in_progress', 'rd.M1.03': 'not_yet', 'rd.gap': 'No TWG',
      // Business services before the shared data layer on purpose: the summary follows the Components step's order.
      'cp.HMIS.need': 'yes', 'cp.HMIS.status': 'E', 'cp.CR.need': 'yes', 'cp.CR.status': 'P', 'cp.TS.need': 'yes', 'cp.HFR.need': 'no', 'cp.HFR.status': 'A',
      'pw.gap': 'no owner', 'pw.depends': 'national ID', 'rg.step': 'meet in March', 'mp.dis': 'whether the MPI exists',
      'gap.readiness.1.text': 'No costed plan', 'gap.readiness.1.urgency': 'GAP_NOW', 'gap.components.2.text': 'No terminology team', 'gap.components.2.urgency': 'GAP_NOW',
      'gap.governance.1.text': 'Later', 'gap.governance.1.urgency': 'GAP_WAIT',
      'gv.DEC_ARCH.holder': 'MoH', 'gv.DEC_ARCH.BASIS_LAW': true, 'gv.DEC_STD.BASIS_NA': true, 'gv.DEC_CDS.unassigned': true,
      'pw.priority': 'CR', 'pw.action': 'agree the health ID',
    }, content);
    const f = Object.fromEntries(s.facts.map((x) => [x.label, x.value]));
    expect(f['Readiness']).toBe('Done 1 · In progress 1 · Not yet 1');
    expect(f['Components needed']).toBe('3 needed · 2 with a status (Exists / Partial / Absent)');
    expect(s.facts.map((x) => x.label).indexOf('Shared data layer: core registries and records'))
      .toBeLessThan(s.facts.map((x) => x.label).indexOf('DPI-H reusable components (business services)'));
    expect(f['Shared data layer: core registries and records']).toBe('Client Registry (P); Terminology Service');
    expect(f['DPI-H reusable components (business services)']).toBe('Health Management Information System (E)');
    expect(f['Status of needed components']).toBe('E 1 · P 1 · A 0');
    expect(f['Gaps that block us now']).toBe('No costed plan; No terminology team');
    // "Not assessed", and the old "Unassigned" switch shown as None.
    const cds = content.items.find((i) => i.id === 'DEC_CDS')?.label;
    expect(f['Decisions with no basis or not assessed']).toBe(`Standards mandate (Not assessed); ${cds} (None)`);
    expect(f['Still to complete']).toBe('Who owns the action; Exists / Partial / Absent for needed components (1 left); Who decides (1 left)');
    expect(f['Where we disagreed']).toBe('whether the MPI exists');
    // The old "biggest gap" lines are gone.
    expect(summaryText(s)).not.toContain('Biggest gap');
    expect(summaryMarkdown(s)).toContain('- **Depends on:** national ID');
  });
});

describe('offline queue (FR-R4)', () => {
  const mem = (): QueueStorage & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
  };

  it('keeps edits across reloads and clears when confirmed', () => {
    const s = mem();
    saveQueue('g1', [['country', 'Fiji'], ['members', 'Ana']], s);
    expect(loadQueue('g1', s)).toEqual([['country', 'Fiji'], ['members', 'Ana']]);
    saveQueue('g1', [], s);
    expect(s.data.size).toBe(0);
  });

  it('collapses to the latest value per field', () => {
    expect([...collapse([['a', '1'], ['b', true], ['a', null]])]).toEqual([['b', true], ['a', null]]);
  });

  it('survives corrupt storage', () => {
    const s = mem();
    s.setItem('dpih.queue.g1', '{not json');
    expect(loadQueue('g1', s)).toEqual([]);
  });
});
