import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateContent, type Content } from '../shared/content';
import { readWorkbook } from '../server/content-workbook';

const json = (): Content => JSON.parse(readFileSync('content/content.json', 'utf8'));

describe('content workbook (SPEC §8)', () => {
  it('bundled content.json is valid', () => {
    expect(validateContent(json())).toEqual([]);
  });

  it('content.json is in sync with the workbook', async () => {
    const fromXlsx = await readWorkbook('content/DPI-H_Pathway_Lab_Content_v1.xlsx');
    expect(fromXlsx).toEqual(json());
  });

  it('reports duplicate IDs clearly', () => {
    const c = json();
    c.items.push({ ...c.items[0] });
    expect(validateContent(c)).toContainEqual(expect.stringContaining('duplicate id "IPS"'));
  });

  it('reports missing required IDs, long labels and HTML', () => {
    const c = json();
    c.items = c.items.filter((i) => i.id !== 'HFR');
    c.items[0].label = 'x'.repeat(81);
    c.items[1].short_def = 'Use <b>this</b>';
    const errors = validateContent(c);
    expect(errors).toContainEqual(expect.stringContaining('"HFR"'));
    expect(errors).toContainEqual(expect.stringContaining('longer than 80'));
    expect(errors).toContainEqual(expect.stringContaining('HTML is not allowed'));
  });
});
