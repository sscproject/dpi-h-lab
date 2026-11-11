// One group's answers as an Excel workbook: a summary sheet, one sheet per printed
// worksheet (laid out like Sheets 1–3), and a flat "All answers" sheet. All labels come
// from the group's content version.

import ExcelJS from 'exceljs';
import type { Content } from '../shared/content.js';
import {
  APP_IDS, ARCH_LAYERS, BASIS_IDS, COST_IDS, DECISION_IDS, FUNDING_IDS, GAP_PATTERN_IDS, GAP_ROWS, GAP_STEPS,
  INTEROP_IDS, LEGAL_IDS, LEVER_IDS, PARTNER_IDS, READINESS_IDS, STANDARD_IDS, SUPPORT_IDS,
} from '../shared/ids.js';
import { buildSummary } from '../shared/summary.js';
import { gapText, setValues, type Worksheet } from '../shared/worksheet.js';
import { countryName, representedCountry } from '../shared/countries.js';

/** Application categories keep their systems in mp.apps.<id>; everything else in mp.sys.<id>. */
const sysPath = (id: string) => ((APP_IDS as readonly string[]).includes(id) ? `mp.apps.${id}` : `mp.sys.${id}`);

export async function groupWorkbook(ws: Worksheet, content: Content, meta: { teamCode: string; exportedAt: Date }): Promise<Buffer> {
  const ui = (k: string) => content.ui_text[k] ?? k;
  const item = (id: string) => content.items.find((i) => i.id === id);
  const label = (id: string) => item(id)?.label ?? id;
  const str = (p: string) => (typeof ws[p] === 'string' ? (ws[p] as string) : '');
  const yes = (p: string) => (ws[p] === true ? '✓' : '');
  const choice = (p: string) => (str(p) ? label(str(p)) : '');
  // Several values (implementation scope), labelled and joined.
  const choices = (p: string) => setValues(ws[p]).map(label).join(', ');
  const status = (id: string) => { const s = str(`cp.${id}.status`); return s ? `${s} – ${label(s)}` : ''; };
  const ticked = (prefix: string, ids: readonly string[]) => ids.filter((i) => ws[`${prefix}.${i}`] === true).map(label).join('; ');

  const wb = new ExcelJS.Workbook();
  wb.creator = ui('app.name');
  wb.created = meta.exportedAt;

  const sheet = (name: string, widths: number[]) => {
    const s = wb.addWorksheet(name);
    s.columns = widths.map((width) => ({ width }));
    return s;
  };
  const heading = (s: ExcelJS.Worksheet, text: string) => {
    if (s.rowCount) s.addRow([]);
    const r = s.addRow([text]);
    r.font = { bold: true, size: 13 };
  };
  const tableHeader = (s: ExcelJS.Worksheet, cols: string[]) => {
    const r = s.addRow(cols);
    r.font = { bold: true };
    r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F0F2' } };
  };
  const pair = (s: ExcelJS.Worksheet, k: string, v: string) => {
    const r = s.addRow([k, v]);
    r.getCell(1).font = { bold: true };
    r.getCell(2).alignment = { wrapText: true, vertical: 'top' };
  };

  // Summary
  const summary = buildSummary(ws, content);
  const s0 = sheet(ui('step.short.summary'), [30, 100]);
  s0.addRow([summary.title]).font = { bold: true, size: 15 };
  pair(s0, ui('join.code.label'), meta.teamCode);
  pair(s0, ui('xl.content'), content.version);
  pair(s0, ui('xl.exported'), meta.exportedAt.toISOString());
  heading(s0, ui('sum.readout'));
  s0.addRow([summary.readoutText]).getCell(1).alignment = { wrapText: true };
  s0.mergeCells(s0.rowCount, 1, s0.rowCount, 2);
  s0.getRow(s0.rowCount).height = 90;
  heading(s0, ui('sum.facts'));
  for (const f of summary.facts) pair(s0, f.label, f.value);

  // Sheet 1: team, use case, readiness, components
  const s1 = sheet(ui('xl.sheet1'), [36, 60, 12, 16, 14, 50]);
  heading(s1, ui('step.short.team'));
  const rep = representedCountry(ws);
  pair(s1, ui('f.country.code'), rep ? countryName(rep) : '');
  pair(s1, ui('f.country'), str('country'));
  pair(s1, ui('f.members'), str('members'));
  pair(s1, ui('f.buddies'), str('buddies'));
  heading(s1, ui('step.short.use_case'));
  const opt = str('uc.option');
  pair(s1, ui('pw.recap.option'), opt ? `${item(opt)?.display_no ?? ''} · ${label(opt)}` : '');
  if (opt === 'OTH') pair(s1, ui('f.uc.otherTitle'), str('uc.otherTitle'));
  pair(s1, ui('f.uc.text'), str('uc.text'));
  heading(s1, ui('step.short.readiness'));
  tableHeader(s1, ['', '', ui('rd.done') + ' / ' + ui('rd.in_progress') + ' / ' + ui('rd.not_yet')]);
  for (const id of READINESS_IDS) {
    const v = str(`rd.${id}`);
    s1.addRow([item(id)?.layer ?? '', label(id), v ? ui(`rd.${v}`) : '']);
  }
  pair(s1, ui('gap.one'), str('rd.gap'));
  heading(s1, ui('step.short.components'));
  tableHeader(s1, [ui('cp.col.component'), ui('cp.col.what'), ui('cp.col.need'), ui('cp.col.status'), ui('cp.col.scope')]);
  // Every architecture layer, in the order the Components step shows them.
  for (const layer of ARCH_LAYERS) {
    s1.addRow([ui(`cp.layer.${layer.key}`)]).font = { bold: true };
    for (const g of layer.groups) for (const id of g.ids) {
      const need = str(`cp.${id}.need`);
      s1.addRow([`${item(id)?.core_star ? '★ ' : ''}${label(id)}`, item(id)?.short_def ?? '', need ? ui(`cp.need.${need}`) : '', status(id), choices(`cp.${id}.scope`)]);
    }
  }
  pair(s1, ui('gap.one'), str('cp.gap'));

  // Sheet 2: the map
  const s2 = sheet(ui('xl.sheet2'), [44, 36, 16, 12, 18, 50]);
  // The same layers as the Mapping step: everything marked Needed, plus anything with systems or notes.
  heading(s2, ui('step.short.map'));
  tableHeader(s2, [ui('cp.col.component'), ui('mp.sys.label'), ui('cp.col.status'), ui('mp.needed'), ui('mp.star'), ui('mp.note')]);
  for (const layer of ARCH_LAYERS) {
    if (layer.key === 'interop') continue; // its own section below, always shown
    const ids = layer.groups.flatMap((g) => g.ids).filter((id) => str(`cp.${id}.need`) === 'yes' || str(sysPath(id)) || str(`cp.${id}.note`));
    if (!ids.length) continue;
    s2.addRow([ui(`cp.layer.${layer.key}`)]).font = { bold: true };
    for (const id of ids) {
      s2.addRow([label(id), str(sysPath(id)), status(id), str(`cp.${id}.need`) === 'yes' ? '✓' : '', yes(`mp.star.${id}`), str(`cp.${id}.note`)]);
    }
  }
  // Interoperability: always shown, as on the Mapping step.
  s2.addRow([ui('mp.layer.interop')]).font = { bold: true };
  for (const id of INTEROP_IDS) {
    s2.addRow([label(id), str(`mp.sys.${id}`), status(id), str(`cp.${id}.need`) === 'yes' ? '✓' : '', yes(`mp.star.${id}`), str(`cp.${id}.note`)]);
  }
  pair(s2, ui('mp.std'), [ticked('mp.std', STANDARD_IDS), str('mp.stdOther')].filter(Boolean).join('; '));
  pair(s2, ui('mp.dis'), str('mp.dis'));

  // Sheet 3: the pathway
  const s3 = sheet(ui('xl.sheet3'), [30, 100]);
  heading(s3, `4 · ${ui('pw.h.priority')}`);
  pair(s3, ui('f.pw.priority'), choice('pw.priority'));
  pair(s3, ui('f.pw.why'), str('pw.why'));
  pair(s3, ui('f.pw.gap'), str('pw.gap'));
  heading(s3, `5 · ${ui('pw.h.action')}`);
  pair(s3, ui('f.pw.action'), str('pw.action'));
  pair(s3, ui('f.pw.owner'), str('pw.owner'));
  pair(s3, ui('f.pw.depends'), str('pw.depends'));
  pair(s3, ui('f.support'), ticked('pw.support', SUPPORT_IDS));
  pair(s3, ui('f.pw.from'), str('pw.from'));
  heading(s3, ui('pw.h.regional'));
  pair(s3, ui('f.rg.component'), choice('rg.component'));
  const lead = str('rg.lead');
  pair(s3, ui('f.rg.lead'), lead === 'OTHER' ? `${label('OTHER')}: ${str('rg.leadOther')}` : choice('rg.lead'));
  pair(s3, ui('f.rg.why'), str('rg.why'));
  pair(s3, ui('f.rg.step'), str('rg.step'));
  pair(s3, ui('f.support'), ticked('rg.support', SUPPORT_IDS));
  pair(s3, ui('f.rg.from'), str('rg.from'));
  heading(s3, ui('pw.h.cost'));
  pair(s3, ui('f.pw.cost'), ticked('pw.cost', COST_IDS));
  pair(s3, ui('f.pw.costMain'), choice('pw.costMain'));
  pair(s3, ui('f.pw.fund'), [ticked('pw.fund', FUNDING_IDS), str('pw.fundOther')].filter(Boolean).join(': '));
  heading(s3, ui('pw.h.refer'));
  pair(s3, ui('f.pw.refer'), str('pw.refer'));
  pair(s3, ui('f.pw.referTo'), [ticked('pw.referTo', PARTNER_IDS), str('pw.referOther')].filter(Boolean).join(': '));

  // Who decides, and every "What we don't have yet" gap.
  const sg = sheet(ui('step.short.governance'), [34, 30, 26, 14, 40]);
  heading(sg, ui('step.short.governance'));
  tableHeader(sg, ['', ui('gv.holder'), ui('gv.basis'), ui('gv.unassigned')]);
  for (const d of DECISION_IDS) sg.addRow([label(d), str(`gv.${d}.holder`), ticked(`gv.${d}`, BASIS_IDS), yes(`gv.${d}.unassigned`)]);
  heading(sg, ui('gv.legal'));
  for (const l of LEGAL_IDS) pair(sg, label(l), str(`gv.legal.${l}`) ? ui(`legal.${str(`gv.legal.${l}`)}`) : '');
  pair(sg, ui('gv.levers'), ticked('gv.lever', LEVER_IDS));
  pair(sg, ui('gap.one'), str('gv.unblock'));
  heading(sg, ui('gap.title'));
  tableHeader(sg, ['', ui('gap.text'), ui('gap.urgency'), ui('gap.pattern'), ui('gap.debt')]);
  for (const s of GAP_STEPS) for (const r of GAP_ROWS) {
    const p = `gap.${s}.${r}`;
    const what = gapText(ws, s, r, label);
    if (!what) continue;
    sg.addRow([ui(`step.short.${s}`), what, choice(`${p}.urgency`), ticked(p, GAP_PATTERN_IDS), str(`${p}.debt`)]);
  }

  // Every stored answer, one per row, by field path (for analysis or re-import).
  const s4 = sheet(ui('xl.all'), [28, 80]);
  tableHeader(s4, ['field', 'value']);
  for (const [p, v] of Object.entries(ws).sort(([a], [b]) => a.localeCompare(b))) s4.addRow([p, typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : v]);

  for (const s of [s1, s2, s3, sg]) s.eachRow((r) => r.eachCell((c) => { c.alignment = { wrapText: true, vertical: 'top' }; }));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
