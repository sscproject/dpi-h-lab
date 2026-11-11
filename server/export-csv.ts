// Event exports (FR-F6): CSV one row per group with the SPEC §9.4 columns, JSON with full
// worksheets, and the edit log. CSV is UTF-8 with a byte-order mark so Excel opens it correctly.
// Coded answers are exported as their stable IDs (e.g. "E", "done", "CR"), which suit analysis.

import { formatTeamCode } from '../shared/codes.js';
import type { Content } from '../shared/content.js';
import {
  APP_IDS, ASSESS_IDS, BASIS_IDS, BLOCK_IDS, COMPONENT_IDS, COST_IDS, DECISION_IDS, FUNDING_IDS, GAP_PATTERN_IDS, GAP_ROWS, GAP_STEPS,
  LEGAL_IDS, LEVER_IDS, PARTNER_IDS, READINESS_IDS, SHEET_ENABLER_IDS, STANDARD_IDS, SUPPORT_IDS,
} from '../shared/ids.js';
import { gapText, progressPct, type Worksheet } from '../shared/worksheet.js';
import type { Queryable } from './db.js';
import { formatEventCode, type EventRow, type GroupAdminRow } from './events.js';
import { countryName, representedCountry } from '../shared/countries.js';

const BOM = '﻿';

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  // Text starting with = + - @ tab or return could run as a formula in Excel (OWASP CSV injection).
  const formula = /^[=+\-@\t\r]/.test(s);
  return /[",\r\n]/.test(s) || formula ? `"${(formula ? "'" : '') + s.replace(/"/g, '""')}"` : s;
}

export const toCsv = (rows: unknown[][]) => BOM + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

/** Components-step items not already in the 12-component columns (status and notes of map blocks are reused). */
const LAYER_EXTRA_IDS = ASSESS_IDS.filter((id) => !(COMPONENT_IDS as readonly string[]).includes(id));
// Map blocks (DPI-F, HIE) already have status_ and note_ columns above.
const isBlock = (id: string) => (BLOCK_IDS as readonly string[]).includes(id);
// Application categories keep their systems in the apps_n columns.
const isApp = (id: string) => (APP_IDS as readonly string[]).includes(id);
/** Everything that can be marked "could be shared regionally" on the Mapping step. */
const STAR_IDS = [...new Set([...BLOCK_IDS, ...ASSESS_IDS])];

export function csvColumns(): string[] {
  return [
    'event_code', 'event_name', 'team_code', 'group_name', 'country_code', 'country_name', 'team_name', 'state',
    'use_case_option', 'use_case_option_label', 'use_case_text',
    ...READINESS_IDS.map((id) => `readiness_${id}`), 'readiness_done_count', 'biggest_gap',
    ...COMPONENT_IDS.map((id) => `need_${id}`),
    ...BLOCK_IDS.map((id) => `status_${id}`),
    ...COMPONENT_IDS.map((id) => `scope_${id}`),
    ...BLOCK_IDS.map((id) => `note_${id}`),
    'enablers',
    ...BLOCK_IDS.map((id) => `system_${id}`), 'regional_star', 'standards', ...APP_IDS.map((_, i) => `apps_${i + 1}`), 'disagreements',
    'national_priority', 'why', 'gap_risk', 'action', 'owner', 'depends_on', 'support', 'support_from',
    'regional_candidate', 'regional_lead', 'regional_why', 'regional_first_step', 'regional_support', 'regional_support_from',
    // Generic additions (beyond SPEC §9.4): gaps, who decides, costs and follow-up.
    ...GAP_STEPS.flatMap((s) => GAP_ROWS.flatMap((r) => [`gap_${s}_${r}`, `gap_${s}_${r}_urgency`, `gap_${s}_${r}_pattern`, `gap_${s}_${r}_debt`])),
    ...DECISION_IDS.flatMap((d) => [`decision_${d}_holder`, `decision_${d}_basis`, `decision_${d}_unassigned`]),
    ...LEGAL_IDS.map((l) => `legal_${l}`), 'levers', 'one_change',
    'cost_drivers', 'cost_main', 'funding', 'funding_other', 'referred_gap', 'referred_to', 'referred_other',
    'consent', 'content_version', 'created_at', 'closed_at', 'progress_pct', 'standards_other', 'components_one_gap',
    // The other architecture layers on the Components step (beyond the 12 components above).
    ...LAYER_EXTRA_IDS.flatMap((id) => (isBlock(id) ? [`need_${id}`, `scope_${id}`]
      : [`need_${id}`, `status_${id}`, `scope_${id}`, `note_${id}`, ...(isApp(id) ? [] : [`system_${id}`])])),
  ];
}

export function csvRow(ev: EventRow | null, g: GroupAdminRow, content: Content | null): unknown[] {
  const ws: Worksheet = g.worksheet;
  const v = (k: string) => ws[k] ?? '';
  const ticked = (prefix: string, ids: readonly string[]) => ids.filter((id) => ws[`${prefix}.${id}`] === true).join(';');
  const option = typeof ws['uc.option'] === 'string' ? (ws['uc.option'] as string) : '';
  const lead = v('rg.lead');
  return [
    ev ? formatEventCode(ev.code) : '', ev?.name ?? '', formatTeamCode(g.team_code), g.name ?? '', representedCountry(ws) ?? '', representedCountry(ws) ? countryName(representedCountry(ws)!) : '', v('country'), g.state,
    option, option ? content?.items.find((i) => i.id === option)?.label ?? '' : '', v('uc.text'),
    ...READINESS_IDS.map((id) => v(`rd.${id}`)), READINESS_IDS.filter((id) => ws[`rd.${id}`] === 'done').length, v('rd.gap'),
    ...COMPONENT_IDS.map((id) => v(`cp.${id}.need`)),
    ...BLOCK_IDS.map((id) => v(`cp.${id}.status`)),
    ...COMPONENT_IDS.map((id) => v(`cp.${id}.scope`)),
    ...BLOCK_IDS.map((id) => v(`cp.${id}.note`)),
    ticked('en', SHEET_ENABLER_IDS),
    ...BLOCK_IDS.map((id) => v(`mp.sys.${id}`)), ticked('mp.star', STAR_IDS), ticked('mp.std', STANDARD_IDS),
    ...APP_IDS.map((id) => v(`mp.apps.${id}`)), v('mp.dis'),
    v('pw.priority'), v('pw.why'), v('pw.gap'), v('pw.action'), v('pw.owner'), v('pw.depends'), ticked('pw.support', SUPPORT_IDS), v('pw.from'),
    v('rg.component'), lead === 'OTHER' && ws['rg.leadOther'] ? `OTHER: ${ws['rg.leadOther']}` : lead, v('rg.why'), v('rg.step'),
    ticked('rg.support', SUPPORT_IDS), v('rg.from'),
    ...GAP_STEPS.flatMap((s) => GAP_ROWS.flatMap((r) => {
      const p = `gap.${s}.${r}`;
      // Readiness gaps picked from the list export the item's name, so the column reads the same either way.
      return [gapText(ws, s, r, (id) => content?.items.find((i) => i.id === id)?.label), v(`${p}.urgency`), ticked(p, GAP_PATTERN_IDS), v(`${p}.debt`)];
    })),
    ...DECISION_IDS.flatMap((d) => [v(`gv.${d}.holder`), ticked(`gv.${d}`, BASIS_IDS), ws[`gv.${d}.unassigned`] === true ? 'yes' : '']),
    ...LEGAL_IDS.map((l) => v(`gv.legal.${l}`)), ticked('gv.lever', LEVER_IDS), v('gv.unblock'),
    ticked('pw.cost', COST_IDS), v('pw.costMain'), ticked('pw.fund', FUNDING_IDS), v('pw.fundOther'),
    v('pw.refer'), ticked('pw.referTo', PARTNER_IDS), v('pw.referOther'),
    g.consent ?? '', g.content_version ?? '', g.created_at, g.closed_at, progressPct(ws), v('mp.stdOther'), v('cp.gap'),
    ...LAYER_EXTRA_IDS.flatMap((id) => (isBlock(id) ? [v(`cp.${id}.need`), v(`cp.${id}.scope`)]
      : [v(`cp.${id}.need`), v(`cp.${id}.status`), v(`cp.${id}.scope`), v(`cp.${id}.note`), ...(isApp(id) ? [] : [v(`mp.sys.${id}`)])])),
  ];
}

export async function editLogCsv(q: Queryable, groups: GroupAdminRow[]): Promise<string> {
  const rows: unknown[][] = [['team_code', 'group_name', 'at', 'path', 'old_value', 'new_value', 'display_name', 'client_id']];
  const byId = new Map(groups.map((g) => [g.id, g]));
  if (groups.length) {
    const { rows: log } = await q.query<{ group_id: string; at: Date; path: string; old_value: unknown; new_value: unknown; display_name: string | null; client_id: string | null }>(
      'SELECT group_id, at, path, old_value, new_value, display_name, client_id FROM edit_log WHERE group_id = ANY($1::uuid[]) ORDER BY at, id',
      [groups.map((g) => g.id)],
    );
    for (const r of log) {
      const g = byId.get(r.group_id)!;
      const show = (x: unknown) => (x === null ? '' : typeof x === 'string' ? x : JSON.stringify(x));
      rows.push([formatTeamCode(g.team_code), g.name ?? '', r.at, r.path, show(r.old_value), show(r.new_value), r.display_name ?? '', r.client_id ?? '']);
    }
  }
  return toCsv(rows);
}
