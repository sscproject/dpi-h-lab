// Content workbook types and validation (SPEC §8).

import { REQUIRED_ITEM_IDS, STEP_KEYS } from './ids.js';
import { UI_TEXT_KEYS } from './ui-keys.js';

export interface ContentItem {
  id: string;
  category: string;
  display_no: number | null;
  label: string;
  short_def: string;
  long_def: string;
  examples: string;
  layer: string;
  core_star: string;
  source: string;
  sort: number;
}

export interface ContentStep {
  step_no: number;
  key: string;
  title: string;
  subtitle: string;
  discuss_prompt: string;
  suggested_time: string;
}

export interface GlossaryTerm {
  term: string;
  definition: string;
  source: string;
}

export interface Content {
  version: string;
  items: ContentItem[];
  steps: ContentStep[];
  glossary: GlossaryTerm[];
  ui_text: Record<string, string>;
}

const HTML_TAG = /<\/?[a-z][^>]*>/i;

/** Returns a list of human-readable problems; empty means valid. */
export function validateContent(c: Content): string[] {
  const errors: string[] = [];
  if (!c.version || !String(c.version).trim()) errors.push('README: no version found.');

  const seen = new Map<string, number>();
  c.items.forEach((item, i) => {
    const row = i + 2; // header is row 1
    if (!item.id) errors.push(`Items row ${row}: id is empty.`);
    else if (seen.has(item.id)) errors.push(`Items row ${row}: duplicate id "${item.id}" (first used on row ${seen.get(item.id)}).`);
    else seen.set(item.id, row);
    if (!item.label) errors.push(`Items row ${row} (${item.id}): label is empty.`);
    if ([...item.label].length > 80) errors.push(`Items row ${row} (${item.id}): label is longer than 80 characters.`);
    if ([...item.short_def].length > 300) errors.push(`Items row ${row} (${item.id}): short_def is longer than 300 characters.`);
  });

  for (const [category, ids] of Object.entries(REQUIRED_ITEM_IDS)) {
    for (const id of ids) {
      const item = c.items.find((x) => x.id === id);
      if (!item) errors.push(`Items: required id "${id}" (${category}) is missing.`);
      else if (item.category !== category) errors.push(`Items: id "${id}" should have category "${category}", not "${item.category}".`);
    }
  }

  for (const key of STEP_KEYS) {
    if (!c.steps.some((s) => s.key === key)) errors.push(`Steps: step "${key}" is missing.`);
  }
  for (const key of UI_TEXT_KEYS) {
    if (!c.ui_text[key]) errors.push(`UI_Text: key "${key}" is missing.`);
  }

  const cells: [string, string][] = [
    ...c.items.flatMap((it) => Object.entries(it).map(([k, v]) => [`Items ${it.id}.${k}`, String(v ?? '')] as [string, string])),
    ...c.steps.flatMap((s) => Object.entries(s).map(([k, v]) => [`Steps ${s.key}.${k}`, String(v ?? '')] as [string, string])),
    ...c.glossary.flatMap((g) => Object.entries(g).map(([k, v]) => [`Glossary ${g.term}.${k}`, String(v ?? '')] as [string, string])),
    ...Object.entries(c.ui_text).map(([k, v]) => [`UI_Text ${k}`, v] as [string, string]),
  ];
  for (const [where, value] of cells) {
    if (HTML_TAG.test(value)) errors.push(`${where}: HTML is not allowed (use Markdown bold or italics).`);
  }
  return errors;
}
