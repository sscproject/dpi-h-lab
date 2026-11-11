// NFR-5 / NFR-6: every token exists in both themes, the two dark blocks agree, and the
// colour pairs the UI uses meet WCAG contrast (4.5:1 text, 3:1 borders and graphics).
// This guards against the v1 regression where button text went dark-on-dark.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('client/src/styles/tokens.css', 'utf8');

function block(re: RegExp): Record<string, string> {
  const m = re.exec(css);
  if (!m) throw new Error(`Block not found: ${re}`);
  return Object.fromEntries([...m[1].matchAll(/--([\w-]+):\s*([^;]+);/g)].map((x) => [x[1], x[2].trim()]));
}

const light = block(/^:root \{([^}]*)\}/m);
const darkMedia = block(/:root:not\(\[data-theme="light"\]\) \{([^}]*)\}/);
const darkAttr = block(/:root\[data-theme="dark"\] \{([^}]*)\}/);

function luminance(hex: string) {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// [foreground, background] pairs as used in app.css.
const TEXT: [string, string][] = [
  ['ink', 'bg'], ['ink', 'surface'], ['ink', 'soft'], ['ink', 'discuss-soft'], ['ink', 'apps-soft'],
  ['muted', 'surface'], ['muted', 'bg'], ['muted', 'soft'],
  ['ink', 'tint'], ['muted', 'tint'], ['link', 'tint'], ['bad', 'tint'],
  ['onbrand', 'brand'], ['brand', 'surface'], ['brand', 'soft'],
  ['link', 'surface'], ['link', 'bg'], ['link', 'soft'],
  ['on-discuss', 'discuss'], ['on-status', 'ok'], ['on-status', 'warn'], ['on-status', 'bad'],
  ['star', 'surface'], ['bad', 'surface'], ['bad', 'bg'], ['apps', 'surface'], ['apps', 'apps-soft'],
  ['ink', 'foundation-soft'], ['ink', 'dpi-soft'], ['ink', 'interop-soft'], ['ink', 'regional-soft'],
  ['muted', 'foundation-soft'], ['muted', 'dpi-soft'], ['muted', 'interop-soft'], ['muted', 'apps-soft'],
  ['on-status', 'star'], ['onbrand', 'apps'], ['brand', 'regional-soft'], ['link', 'discuss-soft'],
  ['ink', 'col-need'], ['ink', 'col-status'], ['ink', 'col-scope'], ['muted', 'col-need'], ['muted', 'col-status'], ['muted', 'col-scope'],
];
const NON_TEXT: [string, string][] = [
  ['field-line', 'surface'], ['field-line', 'bg'], ['field-line', 'col-need'], ['field-line', 'col-status'], ['field-line', 'col-scope'], ['focus', 'surface'], ['focus', 'bg'],
  ['ok', 'surface'], ['warn', 'surface'], ['bad', 'surface'],
  ['foundation', 'surface'], ['business', 'surface'], ['dpi', 'surface'], ['interop', 'surface'], ['apps', 'surface'],
];

describe('theme tokens', () => {
  it('defines every token in both themes', () => {
    expect(Object.keys(darkMedia).sort()).toEqual(Object.keys(light).sort());
  });

  it('keeps the media-query and data-theme dark blocks identical', () => {
    expect(darkAttr).toEqual(darkMedia);
  });

  for (const [name, theme] of [['light', light], ['dark', darkMedia]] as const) {
    it(`${name}: text pairs meet 4.5:1`, () => {
      for (const [fg, bg] of TEXT) {
        expect(contrast(theme[fg], theme[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    });
    it(`${name}: borders and graphics meet 3:1`, () => {
      for (const [fg, bg] of NON_TEXT) {
        expect(contrast(theme[fg], theme[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(3);
      }
    });
  }

  it('app.css uses no raw colours outside tokens', () => {
    const app = readFileSync('client/src/styles/app.css', 'utf8');
    expect(app.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi) ?? []).toEqual([]);
  });
});
