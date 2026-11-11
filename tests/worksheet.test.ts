import { describe, expect, it } from 'vitest';
import { formatTeamCode, isCodeShape, makeCode, normalizeCode } from '../shared/codes';
import { ASSESS_IDS, COMPONENT_IDS, READINESS_IDS } from '../shared/ids';
import { csvColumns } from '../server/export-csv';
import { fieldSpec, gapText, progressPct, setValues, stepComplete, validateValue, type Worksheet } from '../shared/worksheet';
import { COUNTRIES, representedCountry, teamLabel } from '../shared/countries';

describe('field schema (SPEC §7)', () => {
  it('knows every step 0–3 path', () => {
    for (const p of ['country', 'members', 'buddies', 'uc.option', 'uc.otherTitle', 'uc.text', 'rd.gap', 'rd.M1.01', 'rd.M1.24',
      'cp.CR.need', 'cp.SR.scope', 'cp.LIMR.note', 'cp.HIE.status', 'en.EN6']) {
      expect(fieldSpec(p), p).not.toBeNull();
    }
  });

  it('rejects unknown paths and IDs', () => {
    for (const p of ['nope', 'rd.M1.99', 'cp.XX.need', 'cp.CONS.need', 'en.EN7', 'mp.std.HL7', 'cp.CR.need.x', '__proto__']) {
      expect(validateValue(p, 'x'), p).toBe('unknown_path');
    }
  });

  it('validates values by type, option list and length', () => {
    expect(validateValue('uc.option', 'G7')).toBeNull();
    expect(validateValue('uc.option', 'G5')).toBe('bad_value');
    expect(validateValue('rd.M1.01', 'in_progress')).toBeNull();
    expect(validateValue('cp.CR.status', 'X')).toBe('bad_value');
    expect(validateValue('en.EN1', 'yes')).toBe('bad_type');
    expect(validateValue('country', 'x'.repeat(80))).toBeNull();
    expect(validateValue('country', 'x'.repeat(81))).toBe('too_long');
    // Unicode names count by character, not UTF-16 unit.
    expect(validateValue('country', '🇫🇯'.repeat(40))).toBeNull();
    expect(validateValue('uc.text', null)).toBeNull();
  });
});

describe('completion and progress', () => {
  it('applies the step rules', () => {
    const ws: Worksheet = { country: 'Fiji', 'uc.option': 'IPS' };
    expect(stepComplete('team', ws)).toBe(true);
    expect(stepComplete('use_case', ws)).toBe(false);
    ws['uc.text'] = 'A referral';
    expect(stepComplete('use_case', ws)).toBe(true);
    READINESS_IDS.forEach((id) => (ws[`rd.${id}`] = 'done'));
    expect(stepComplete('readiness', ws)).toBe(true);
    COMPONENT_IDS.slice(1).forEach((id) => (ws[`cp.${id}.need`] = 'no'));
    expect(stepComplete('components', ws)).toBe(false);
    ws['cp.CR.need'] = 'yes';
    expect(stepComplete('components', ws)).toBe(true);
  });

  it('computes progress from the §7.7 checks', () => {
    expect(progressPct({})).toBe(0);
    // One of the checks: country, option, text, each readiness item, the need block, and 4 pathway fields.
    expect(progressPct({ country: 'Fiji' })).toBe(Math.round(100 / (READINESS_IDS.length + 8)));
    const full: Worksheet = { country: 'x', 'uc.option': 'IPS', 'uc.text': 'x', 'pw.priority': 'CR', 'pw.action': 'x', 'pw.owner': 'x', 'rg.component': 'TS' };
    READINESS_IDS.forEach((id) => (full[`rd.${id}`] = 'not_yet'));
    COMPONENT_IDS.forEach((id) => (full[`cp.${id}.need`] = 'yes'));
    expect(progressPct(full)).toBe(100);
  });
});

describe('codes (SPEC §9.1)', () => {
  it('normalises input', () => {
    expect(normalizeCode(' abc-123 ')).toBe('ABC123');
    expect(normalizeCode('ab c 1 2 3')).toBe('ABC123');
    expect(normalizeCode('0Il')).toBe('011');
    expect(formatTeamCode('abc123')).toBe('ABC-123');
  });
  it('generates 6-character Crockford codes', () => {
    for (let i = 0; i < 200; i++) {
      const c = makeCode((n) => crypto.getRandomValues(new Uint8Array(n)));
      expect(isCodeShape(c)).toBe(true);
      expect(c).not.toMatch(/[ILOU]/);
    }
  });
});

describe('generic additions (gap strip, who decides, costs)', () => {
  it('knows the new paths and rejects unknown ones', () => {
    for (const p of ['gap.readiness.1.text', 'gap.map.3.debt', 'gap.governance.2.NARROW', 'gv.DEC_ARCH.holder', 'gv.DEC_TRUST.BASIS_TWG',
      'gv.DEC_CDS.unassigned', 'gv.lever.LEV_PROC', 'gv.unblock', 'pw.cost.COST_RUN', 'pw.fund.FUND_WB', 'pw.referTo.P_WHO']) {
      expect(fieldSpec(p), p).not.toBeNull();
    }
    for (const p of ['gap.team.1.text', 'gap.readiness.4.text', 'gap.map.1.WIDE', 'gv.DEC_X.holder', 'gv.legal.LEG_X', 'pw.cost.X']) {
      expect(validateValue(p, 'x'), p).toBe('unknown_path');
    }
    expect(validateValue('gap.components.1.urgency', 'GAP_NOW')).toBeNull();
    expect(validateValue('gap.components.1.urgency', 'soon')).toBe('bad_value');
    expect(validateValue('gv.legal.LEG_DATA', 'partly')).toBeNull();
    expect(validateValue('pw.costMain', 'COST_INTEG')).toBeNull();
  });

  it('completes "Who decides" when every decision has a holder or is unassigned', () => {
    const ws: Worksheet = { 'gv.DEC_ARCH.holder': 'Ministry of Health', 'gv.DEC_STD.holder': 'TWG', 'gv.DEC_CDS.unassigned': true };
    expect(stepComplete('governance', ws)).toBe(false);
    ws['gv.DEC_TRUST.unassigned'] = true;
    expect(stepComplete('governance', ws)).toBe(true);
  });

  it('accepts answers for every architecture layer on the Components step', () => {
    for (const id of ASSESS_IDS) {
      expect(validateValue(`cp.${id}.need`, 'yes')).toBeNull();
      expect(validateValue(`cp.${id}.status`, 'P')).toBeNull();
      expect(validateValue(`cp.${id}.scope`, 'regional')).toBeNull();
      expect(validateValue(`cp.${id}.note`, 'We disagreed')).toBeNull();
    }
    // Mapping: systems and "could be shared regionally" for every item, and other standards.
    expect(validateValue('mp.sys.TECH_CLOUD', 'National cloud')).toBeNull();
    expect(validateValue('mp.star.AIE', true)).toBeNull();
    expect(validateValue('mp.stdOther', 'HL7 v2, ISO 13606')).toBeNull();
    expect(validateValue('mp.std.FHIR', false)).toBeNull();
    // Every layer item appears once, and the CSV has no duplicate column names.
    expect(new Set(ASSESS_IDS).size).toBe(ASSESS_IDS.length);
    const cols = csvColumns();
    expect(new Set(cols).size).toBe(cols.length);
  });

  it('picks readiness gaps from the readiness items, or Other with text', () => {
    expect(validateValue('gap.readiness.1.item', 'M1.12')).toBeNull();
    expect(validateValue('gap.readiness.2.item', 'OTHER')).toBeNull();
    expect(validateValue('gap.readiness.1.item', 'CR')).toBe('bad_value');
    // Who decides picks from its decisions and legal questions; other steps keep free text.
    expect(validateValue('gap.governance.1.item', 'DEC_TRUST')).toBeNull();
    expect(validateValue('gap.governance.2.item', 'LEG_MINORS')).toBeNull();
    expect(validateValue('gap.governance.1.item', 'M1.01')).toBe('bad_value');
    // Components picks from any Components-step item; its consensus answer is its own field.
    expect(validateValue('gap.components.1.item', 'TECH_CLOUD')).toBeNull();
    expect(validateValue('gap.components.1.item', 'M1.01')).toBe('bad_value');
    expect(validateValue('cp.gap', 'No client registry')).toBeNull();
    expect(fieldSpec('gap.map.1.item')).toBeNull();

    const label = (id: string) => ({ 'M1.12': 'Access / licensing for clinical terminology (e.g. SNOMED)' })[id];
    const ws: Worksheet = {
      'gap.readiness.1.item': 'M1.12',
      'gap.readiness.2.item': 'OTHER', 'gap.readiness.2.text': 'No data-sharing agreement',
      'gap.readiness.3.text': 'Written before the list existed',
    };
    expect(gapText(ws, 'readiness', '1', label)).toBe('Access / licensing for clinical terminology (e.g. SNOMED)');
    expect(gapText(ws, 'readiness', '2', label)).toBe('No data-sharing agreement');
    expect(gapText(ws, 'readiness', '3', label)).toBe('Written before the list existed');
  });
});

describe('step timers', () => {
  it('accepts a start time per step and per Pathway section only', () => {
    expect(validateValue('timer.readiness', new Date().toISOString())).toBeNull();
    expect(validateValue('timer.pathway.priority', new Date().toISOString())).toBeNull();
    expect(validateValue('timer.pathway.nope', 'x')).toBe('unknown_path');
    expect(validateValue('timer.lunch', 'x')).toBe('unknown_path');
    expect(validateValue('timer.map', null)).toBeNull();
  });
});

describe('implementation scope (several at once)', () => {
  it('accepts one or several scopes, once each', () => {
    expect(validateValue('cp.CR.scope', 'national')).toBeNull();
    expect(validateValue('cp.CR.scope', 'national,regional')).toBeNull();
    expect(validateValue('cp.CR.scope', 'subnational,national,regional')).toBeNull();
    expect(validateValue('cp.CR.scope', 'national,national')).toBe('bad_value');
    expect(validateValue('cp.CR.scope', 'national,global')).toBe('bad_value');
    expect(validateValue('cp.CR.scope', '')).toBe('bad_value');
    expect(validateValue('cp.CR.scope', true)).toBe('bad_type');
  });
  it('reads stored scopes back as a list', () => {
    expect(setValues('national,regional')).toEqual(['national', 'regional']);
    expect(setValues(undefined)).toEqual([]);
  });
});

describe('country a team represents', () => {
  it('accepts the tick and ISO codes only', () => {
    expect(validateValue('country.rep', true)).toBeNull();
    expect(validateValue('country.rep', 'yes')).toBe('bad_type');
    expect(validateValue('country.code', 'FJI')).toBeNull();
    expect(validateValue('country.code', 'Fiji')).toBe('bad_value');
  });
  it('names the group by its country only when ticked', () => {
    expect(teamLabel({ country: 'MoH DHU', 'country.rep': true, 'country.code': 'FJI' })).toBe('Fiji');
    expect(teamLabel({ country: 'MoH DHU', 'country.code': 'FJI' })).toBe('MoH DHU');
    expect(representedCountry({ 'country.rep': true })).toBeNull();
    expect(COUNTRIES.length).toBe(new Set(COUNTRIES.map(([c]) => c)).size);
  });
  it('needs the country once ticked to complete the Team step', () => {
    expect(stepComplete('team', { country: 'Training team' })).toBe(true);
    expect(stepComplete('team', { country: 'MoH', 'country.rep': true })).toBe(false);
    expect(stepComplete('team', { 'country.rep': true, 'country.code': 'TON' })).toBe(true);
  });
});
