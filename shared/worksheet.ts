// Worksheet field schema (SPEC §7), patch validation, step completion and progress (§7.7).
// The worksheet is stored flat: { "<path>": value }, e.g. { "cp.CR.need": "yes" }.

import {
  APP_IDS, ASSESS_IDS, BASIS_IDS, BLOCK_IDS, COMPONENT_IDS, COST_IDS, DECISION_IDS, FUNDING_IDS, GAP_PATTERN_IDS, GAP_ROWS, GAP_STEPS,
  GAP_URGENCY_IDS, GOAL_IDS, LEAD_IDS, LEGAL_IDS, LEGAL_VALUES, LEVER_IDS, NEED_VALUES, PARTNER_IDS, READINESS_IDS,
  READINESS_VALUES, SCOPE_IDS, SHEET_ENABLER_IDS, STANDARD_IDS, STATUS_IDS, STEP_KEYS, SUPPORT_IDS,
  type StepKey,
} from './ids.js';
import { COUNTRY_CODES } from './countries.js';

export type FieldValue = string | boolean;
export type Worksheet = Record<string, FieldValue>;
export type FieldVersions = Record<string, { v: number; at: string; by?: string | null }>;

export type FieldSpec =
  | { kind: 'text'; max: number }
  | { kind: 'enum'; values: readonly string[] }
  /** Several of `values`, stored as one comma-separated string (e.g. "national,regional"). */
  | { kind: 'set'; values: readonly string[] }
  | { kind: 'bool' };

const text = (max: number): FieldSpec => ({ kind: 'text', max });
const oneOf = (values: readonly string[]): FieldSpec => ({ kind: 'enum', values });
const bool: FieldSpec = { kind: 'bool' };

/** National priority and regional candidate: any Components-step item, or an older map block. */
const PRIORITY_IDS = [...new Set<string>([...BLOCK_IDS, ...ASSESS_IDS])];

const FIXED: Record<string, FieldSpec> = {
  // Team name (labelled "Country / Team" before content 1.50).
  country: text(80),
  // "We are representing a country" and which one (ISO 3166-1 alpha-3).
  'country.rep': bool,
  'country.code': oneOf(COUNTRY_CODES),
  members: text(1000),
  buddies: text(500),
  'uc.option': oneOf(GOAL_IDS),
  'uc.otherTitle': text(120),
  'uc.text': text(500),
  'rd.gap': text(300),
  'mp.dis': text(1000),
  'pw.priority': oneOf(PRIORITY_IDS),
  'pw.why': text(500),
  'pw.gap': text(300),
  'pw.action': text(500),
  'pw.owner': text(200),
  'pw.depends': text(300),
  'pw.from': text(300),
  'rg.component': oneOf(PRIORITY_IDS),
  'rg.lead': oneOf(LEAD_IDS),
  'rg.leadOther': text(120),
  'rg.why': text(500),
  'rg.step': text(300),
  'rg.from': text(300),
  // Who decides
  'gv.unblock': text(300),
  // Components: the ONE gap that holds the team back most (end of its gap section).
  'cp.gap': text(300),
  // Pathway: costs, funding, follow-up
  'pw.costMain': oneOf(COST_IDS),
  'pw.fundOther': text(120),
  'pw.refer': text(300),
  // Mapping: standards in use that are not in the list.
  'mp.stdOther': text(200),
  'pw.referOther': text(120),
};

const has = (list: readonly string[], id: string) => list.includes(id);

/** Pathway sections with their own timers. */
export const PATHWAY_SECTIONS = ['priority', 'action', 'cost', 'regional', 'refer'] as const;

/** Returns the spec for a worksheet path, or null if the path is unknown. */
export function fieldSpec(path: string): FieldSpec | null {
  if (Object.hasOwn(FIXED, path)) return FIXED[path];
  const parts = path.split('.');
  // Readiness IDs contain a dot (M1.01), so match prefixes explicitly.
  if (path.startsWith('rd.')) {
    const id = path.slice(3);
    return has(READINESS_IDS, id) ? oneOf(READINESS_VALUES) : null;
  }
  // timer.<step>: when the group started that step's shared countdown (ISO time), or cleared.
  if (parts[0] === 'timer' && parts.length === 2) return has(STEP_KEYS, parts[1]) ? text(40) : null;
  // timer.pathway.<section>: the Pathway step's sections each have their own time.
  if (parts[0] === 'timer' && parts.length === 3) return parts[1] === 'pathway' && has(PATHWAY_SECTIONS, parts[2]) ? text(40) : null;
  // gap.<step>.<row>.<field>: "What we don't have yet" rows.
  if (parts[0] === 'gap') {
    const [, step, row, f, ...more] = parts;
    if (more.length || !has(GAP_STEPS, step) || !has(GAP_ROWS, row)) return null;
    if (f === 'text') return text(200);
    // Readiness gaps are picked from the items the team marked "Not yet" (or OTHER, with text).
    if (f === 'item') {
      if (step === 'readiness') return oneOf([...READINESS_IDS, 'OTHER']);
      if (step === 'governance') return oneOf([...DECISION_IDS, ...LEGAL_IDS, 'OTHER']);
      if (step === 'components') return oneOf([...ASSESS_IDS, 'OTHER']);
      return null;
    }
    if (f === 'debt') return text(300);
    if (f === 'urgency') return oneOf(GAP_URGENCY_IDS);
    return has(GAP_PATTERN_IDS, f) ? bool : null;
  }
  const [a, b, c, ...rest] = parts;
  if (rest.length) return null;
  if (a === 'gv' && c) {
    if (b === 'legal') return has(LEGAL_IDS, c) ? oneOf(LEGAL_VALUES) : null;
    if (b === 'lever') return has(LEVER_IDS, c) ? bool : null;
    if (!has(DECISION_IDS, b)) return null;
    if (c === 'holder') return text(200);
    if (c === 'unassigned') return bool;
    return has(BASIS_IDS, c) ? bool : null;
  }
  if (a === 'pw' && c && b === 'cost') return has(COST_IDS, c) ? bool : null;
  if (a === 'pw' && c && b === 'fund') return has(FUNDING_IDS, c) ? bool : null;
  if (a === 'pw' && c && b === 'referTo') return has(PARTNER_IDS, c) ? bool : null;
  if (a === 'cp' && c) {
    // Status and notes exist for the 20 map blocks (shared between Steps 3 and 4) and for
    // everything in the Components step's architecture layers.
    const assessed = has(ASSESS_IDS, b);
    if (c === 'status') return has(BLOCK_IDS, b) || assessed ? oneOf(STATUS_IDS) : null;
    if (c === 'note') return has(BLOCK_IDS, b) || assessed ? text(300) : null;
    if (!has(COMPONENT_IDS, b) && !assessed) return null;
    if (c === 'need') return oneOf(NEED_VALUES);
    // Implementation scope can be several at once (e.g. national and regional).
    if (c === 'scope') return { kind: 'set', values: SCOPE_IDS };
    return null;
  }
  if (c !== undefined) {
    // Systems fields hold several systems, one per line (raised from SPEC's 120 at the product lead's request).
    if (a === 'mp' && b === 'apps') return has(APP_IDS, c) ? text(300) : null;
    if (a === 'mp' && b === 'sys') return has(BLOCK_IDS, c) || has(ASSESS_IDS, c) ? text(300) : null;
    if (a === 'mp' && b === 'star') return has(BLOCK_IDS, c) || has(ASSESS_IDS, c) ? bool : null;
    if (a === 'mp' && b === 'std') return has(STANDARD_IDS, c) ? bool : null;
    if ((a === 'pw' || a === 'rg') && b === 'support') return has(SUPPORT_IDS, c) ? bool : null;
    return null;
  }
  if (a === 'en' && b) return has(SHEET_ENABLER_IDS, b) ? bool : null;
  return null;
}

/**
 * A gap row's wording: the readiness item picked from the "Not yet" list, or the team's
 * own text (other steps, OTHER, and rows written before the list existed).
 */
export function gapText(ws: Worksheet, step: string, row: string, label: (id: string) => string | undefined): string {
  const p = `gap.${step}.${row}`;
  const item = ws[`${p}.item`];
  if (typeof item === 'string' && item !== 'OTHER') return label(item) || item;
  const own = ws[`${p}.text`];
  return typeof own === 'string' ? own.trim() : '';
}

/** Character count by code point, so Unicode names count fairly. */
export const charLength = (s: string) => [...s].length;

export type OpError = 'unknown_path' | 'bad_type' | 'bad_value' | 'too_long';

/** Validates one value for a path. `null` clears the field and is always allowed for known paths. */
export function validateValue(path: string, value: unknown): OpError | null {
  const spec = fieldSpec(path);
  if (!spec) return 'unknown_path';
  if (value === null) return null;
  switch (spec.kind) {
    case 'text':
      if (typeof value !== 'string') return 'bad_type';
      return charLength(value) > spec.max ? 'too_long' : null;
    case 'enum':
      if (typeof value !== 'string') return 'bad_type';
      return spec.values.includes(value) ? null : 'bad_value';
    case 'set': {
      if (typeof value !== 'string') return 'bad_type';
      const parts = value.split(',');
      if (!parts.length || new Set(parts).size !== parts.length) return 'bad_value';
      return parts.every((p) => spec.values.includes(p)) ? null : 'bad_value';
    }
    case 'bool':
      return typeof value === 'boolean' ? null : 'bad_type';
  }
}

/** The values of a comma-separated multiple-choice field, e.g. implementation scope. */
export function setValues(value: FieldValue | undefined): string[] {
  return typeof value === 'string' && value ? value.split(',') : [];
}

const filled = (v: FieldValue | undefined) =>
  typeof v === 'string' ? v.trim() !== '' : v !== undefined && v !== false;

/** A team representing a country has chosen it; any other team has a team name. */
const teamNamed = (ws: Worksheet) =>
  ws['country.rep'] === true ? filled(ws['country.code']) : filled(ws.country);

/** Step completion rules (SPEC §7). Summary has no completion rule. */
export function stepComplete(step: StepKey, ws: Worksheet): boolean {
  switch (step) {
    case 'team':
      return teamNamed(ws);
    case 'use_case':
      return filled(ws['uc.option']) && filled(ws['uc.text']);
    case 'readiness':
      return READINESS_IDS.every((id) => filled(ws[`rd.${id}`]));
    case 'components':
      return COMPONENT_IDS.every((id) => filled(ws[`cp.${id}.need`]));
    case 'map':
      return BLOCK_IDS.some((id) => filled(ws[`cp.${id}.status`]));
    case 'governance':
      // Each decision has a named holder, or is marked unassigned (itself a finding).
      return DECISION_IDS.every((id) => filled(ws[`gv.${id}.holder`]) || ws[`gv.${id}.unassigned`] === true);
    case 'pathway':
      return filled(ws['pw.priority']) && filled(ws['pw.action']) && filled(ws['rg.component']);
    case 'summary':
      return false;
  }
}

/**
 * Progress % for dashboards (SPEC §7.7). The spec lists country, uc.option, uc.text,
 * the 12 readiness items, the 12 cp.*.need values "counted as one block of 12", and
 * pw.priority, pw.action, pw.owner, rg.component. Read literally that is 3 + 12 + 1 + 4 = 20
 * checks (the spec says 22); the need block counts as one check, complete when all 12 are set.
 */
export function progressPct(ws: Worksheet): number {
  const checks = [
    teamNamed(ws),
    filled(ws['uc.option']),
    filled(ws['uc.text']),
    ...READINESS_IDS.map((id) => filled(ws[`rd.${id}`])),
    COMPONENT_IDS.every((id) => filled(ws[`cp.${id}.need`])),
    filled(ws['pw.priority']),
    filled(ws['pw.action']),
    filled(ws['pw.owner']),
    filled(ws['rg.component']),
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}
