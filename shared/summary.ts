// 60-second readout and key facts (FR-SU1, FR-SU2), built from the worksheet and the
// content version the group uses. Shared by the summary step and GET /summary.

import type { Content } from './content.js';
import {
  COMPONENT_IDS, DECISION_IDS, FUNDING_IDS, GAP_ROWS, GAP_STEPS, PARTNER_IDS, READINESS_IDS, STATUS_IDS, SUPPORT_IDS,
} from './ids.js';
import { gapText, type Worksheet } from './worksheet.js';
import { teamLabel } from './countries.js';

export interface ReadoutPart {
  text: string;
  /** True for a value from the worksheet, false for template wording; null-valued slots are missing. */
  value: boolean;
  missing?: boolean;
}

export interface Summary {
  title: string;
  readout: ReadoutPart[];
  readoutText: string;
  facts: { label: string; value: string }[];
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export function buildSummary(ws: Worksheet, content: Content): Summary {
  const ui = (k: string, vars?: Record<string, string>) => {
    const s = content.ui_text[k] ?? k;
    return vars ? s.replace(/\{(\w+)\}/g, (_, x) => vars[x] ?? '') : s;
  };
  const label = (id: string) => content.items.find((i) => i.id === id)?.label ?? '';
  const missing = ui('sum.missing');
  const none = ui('sum.none');

  const ucOption = str(ws['uc.option']);
  const useCase = ucOption === 'OTH' ? str(ws['uc.otherTitle']) || label('OTH') : ucOption ? label(ucOption) : '';
  const supportList = (prefix: 'pw' | 'rg') =>
    SUPPORT_IDS.filter((s) => ws[`${prefix}.support.${s}`] === true).map(label).join(', ');
  const lead = str(ws['rg.lead']);
  const leadText = lead === 'OTHER' ? str(ws['rg.leadOther']) || label('OTHER') : lead ? label(lead) : '';
  const priority = str(ws['pw.priority']);
  const regional = str(ws['rg.component']);

  // The template's [bracketed] slots are filled in order, so CSIRO can reword it in the workbook.
  const values = [
    teamLabel(ws), useCase, priority && label(priority), str(ws['pw.why']), str(ws['pw.action']),
    str(ws['pw.owner']), supportList('pw'), str(ws['pw.from']), regional && label(regional), leadText, str(ws['rg.why']),
  ];
  const template = ui('readout.template');
  const pieces = template.split(/\[[^\]]+\]/);
  const readout: ReadoutPart[] = [];
  pieces.forEach((piece, i) => {
    if (piece) readout.push({ text: piece, value: false });
    if (i < pieces.length - 1) {
      const v = values[i] ?? '';
      readout.push(v ? { text: v, value: true } : { text: missing, value: true, missing: true });
    }
  });

  const counts = { done: 0, in_progress: 0, not_yet: 0 };
  for (const id of READINESS_IDS) {
    const v = ws[`rd.${id}`];
    if (v === 'done' || v === 'in_progress' || v === 'not_yet') counts[v]++;
  }
  const needed = COMPONENT_IDS.filter((id) => ws[`cp.${id}.need`] === 'yes');
  const statusCounts = Object.fromEntries(STATUS_IDS.map((s) => [s, 0])) as Record<string, number>;
  for (const id of needed) {
    const s = str(ws[`cp.${id}.status`]);
    if (s in statusCounts) statusCounts[s]++;
  }
  const answered = counts.done + counts.in_progress + counts.not_yet;

  const facts = [
    { label: ui('sum.readiness'), value: answered ? `${ui('rd.done')} ${counts.done} · ${ui('rd.in_progress')} ${counts.in_progress} · ${ui('rd.not_yet')} ${counts.not_yet}` : '' },
    { label: ui('sum.gap'), value: str(ws['rd.gap']) },
    { label: ui('sum.needed'), value: needed.map((id) => { const s = str(ws[`cp.${id}.status`]); return s ? `${label(id)} (${s})` : label(id); }).join('; ') },
    { label: ui('sum.statusCounts'), value: needed.length ? STATUS_IDS.map((s) => `${s} ${statusCounts[s]}`).join(' · ') : '' },
    { label: ui('sum.risk'), value: str(ws['pw.gap']) },
    { label: ui('sum.depends'), value: str(ws['pw.depends']) },
    { label: ui('sum.firstStep'), value: str(ws['rg.step']) },
    { label: ui('sum.disagreements'), value: str(ws['mp.dis']) },
    {
      label: ui('sum.blocking'),
      value: GAP_STEPS.flatMap((s) => GAP_ROWS.filter((r) => ws[`gap.${s}.${r}.urgency`] === 'GAP_NOW').map((r) => gapText(ws, s, r, label)))
        .filter(Boolean).join('; '),
    },
    { label: ui('sum.unassigned'), value: DECISION_IDS.filter((d) => ws[`gv.${d}.unassigned`] === true).map(label).join('; ') },
    {
      label: ui('sum.funding'),
      value: [...FUNDING_IDS.filter((f) => f !== 'FUND_OTHER' && ws[`pw.fund.${f}`] === true).map(label), ws['pw.fund.FUND_OTHER'] === true ? str(ws['pw.fundOther']) || label('FUND_OTHER') : '']
        .filter(Boolean).join(', '),
    },
    {
      label: ui('sum.refer'),
      value: [str(ws['pw.refer']), [...PARTNER_IDS.filter((p) => p !== 'P_OTHER' && ws[`pw.referTo.${p}`] === true).map(label), ws['pw.referTo.P_OTHER'] === true ? str(ws['pw.referOther']) || label('P_OTHER') : '']
        .filter(Boolean).join(', ')].filter(Boolean).join(' → '),
    },
  ].map((f) => ({ ...f, value: f.value || none }));

  return {
    title: ui('sum.title', { country: teamLabel(ws) || missing }),
    readout,
    readoutText: readout.map((p) => p.text).join(''),
    facts,
  };
}

export function summaryText(s: Summary): string {
  return [s.title, '', s.readoutText, '', ...s.facts.map((f) => `${f.label}: ${f.value}`)].join('\n');
}

export function summaryMarkdown(s: Summary): string {
  return [`# ${s.title}`, '', `> ${s.readoutText}`, '', ...s.facts.map((f) => `- **${f.label}:** ${f.value}`), ''].join('\n');
}
