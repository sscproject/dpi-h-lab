// Converts the content workbook to content.json and validates it (SPEC §8).
// Usage: npm run content:build [-- <workbook.xlsx> <out.json>]

import { writeFileSync } from 'node:fs';
import { readWorkbook } from '../server/content-workbook.js';
import { validateContent } from '../shared/content.js';

const input = process.argv[2] ?? 'content/DPI-H_Pathway_Lab_Content_v1.xlsx';
const output = process.argv[3] ?? 'content/content.json';

const content = await readWorkbook(input);
const errors = validateContent(content);
if (errors.length) {
  console.error(`Content workbook is not valid (${errors.length} problem${errors.length === 1 ? '' : 's'}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
writeFileSync(output, JSON.stringify(content, null, 1) + '\n', 'utf8');
console.log(`Wrote ${output}: version ${content.version}, ${content.items.length} items, ${content.steps.length} steps, ${content.glossary.length} glossary terms, ${Object.keys(content.ui_text).length} UI texts.`);
