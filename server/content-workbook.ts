// Reads the content workbook (.xlsx) into the Content shape. Shared by the build
// script and, later, the admin upload (FR-A5).

import ExcelJS from 'exceljs';
import type { Content, ContentItem, ContentStep, GlossaryTerm } from '../shared/content.js';

type Cell = ExcelJS.CellValue;

function cellText(v: Cell): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return String(v.text);
    if ('result' in v) return cellText(v.result as Cell);
    if (v instanceof Date) return v.toISOString();
  }
  return String(v).trim();
}

function readTable(wb: ExcelJS.Workbook, name: string): Record<string, string>[] {
  const ws = wb.getWorksheet(name);
  if (!ws) throw new Error(`The workbook has no "${name}" sheet.`);
  const header = (ws.getRow(1).values as Cell[]).map(cellText);
  const rows: Record<string, string>[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const values = row.values as Cell[];
    const rec: Record<string, string> = {};
    header.forEach((h, i) => { if (h) rec[h] = cellText(values[i]); });
    if (Object.values(rec).some((x) => x !== '')) rows.push(rec);
  });
  return rows;
}

/** Version comes from the README sheet line "Version 1.0 · …". */
function readVersion(wb: ExcelJS.Workbook): string {
  const ws = wb.getWorksheet('README');
  let version = '';
  ws?.eachRow((row) => {
    const m = /\bVersion\s+([0-9][\w.-]*)/i.exec(cellText(row.getCell(1).value));
    if (m && !version) version = m[1];
  });
  return version;
}

const num = (s: string) => (s === '' ? null : Number(s));

export async function readWorkbook(source: string | Buffer): Promise<Content> {
  const wb = new ExcelJS.Workbook();
  if (typeof source === 'string') await wb.xlsx.readFile(source);
  else await wb.xlsx.load(source as unknown as ArrayBuffer);

  const items: ContentItem[] = readTable(wb, 'Items').map((r) => ({
    id: r.id,
    category: r.category,
    display_no: num(r.display_no),
    label: r.label,
    short_def: r.short_def,
    long_def: r.long_def,
    examples: r.examples,
    layer: r.layer,
    core_star: r.core_star,
    source: r.source,
    sort: num(r.sort) ?? 0,
  }));
  const steps: ContentStep[] = readTable(wb, 'Steps').map((r) => ({
    step_no: Number(r.step_no),
    key: r.key,
    title: r.title,
    subtitle: r.subtitle,
    discuss_prompt: r.discuss_prompt,
    suggested_time: r.suggested_time,
  }));
  const glossary: GlossaryTerm[] = readTable(wb, 'Glossary').map((r) => ({
    term: r.term,
    definition: r.definition,
    source: r.source,
  }));
  const ui_text: Record<string, string> = {};
  for (const r of readTable(wb, 'UI_Text')) if (r.key) ui_text[r.key] = r.text;

  return { version: readVersion(wb), items, steps, glossary, ui_text };
}
