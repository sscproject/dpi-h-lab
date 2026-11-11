// Content from the workbook (SPEC §8): every label, definition and prompt comes through here.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Content, ContentItem, ContentStep } from '../../shared/content';
import type { UiTextKey } from '../../shared/ui-keys';
import { api } from './api';

export interface ContentApi {
  content: Content;
  /** Item by ID, or undefined (with a one-time console warning) when the workbook has no entry (FR-I2). */
  item(id: string): ContentItem | undefined;
  /** Items of a category in workbook sort order. */
  items(category: string): ContentItem[];
  step(key: string): ContentStep | undefined;
  t(key: UiTextKey, vars?: Record<string, string>): string;
  /** Optional wording (e.g. map block tags from the printed sheet): empty when the workbook has none. */
  opt(key: string): string;
}

const warned = new Set<string>();
function warnOnce(msg: string) {
  if (warned.has(msg)) return;
  warned.add(msg);
  console.warn(msg);
}

export function makeContentApi(content: Content): ContentApi {
  const byId = new Map(content.items.map((i) => [i.id, i]));
  return {
    content,
    item(id) {
      const it = byId.get(id);
      if (!it) warnOnce(`[content] No entry for "${id}" in content ${content.version}; its ⓘ is hidden.`);
      return it;
    },
    items: (category) => content.items.filter((i) => i.category === category).sort((a, b) => a.sort - b.sort),
    step: (key) => content.steps.find((s) => s.key === key),
    t(key, vars) {
      let s = content.ui_text[key];
      if (s === undefined) {
        warnOnce(`[content] UI_Text "${key}" is missing.`);
        s = key;
      }
      return vars ? s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`) : s;
    },
    opt: (key) => content.ui_text[key] ?? '',
  };
}

const Ctx = createContext<ContentApi | null>(null);

export function useContent(): ContentApi {
  const c = useContext(Ctx);
  if (!c) throw new Error('useContent outside ContentProvider');
  return c;
}

/** Loads a specific content version (a group's recorded version) or the active one. */
export function ContentProvider({ version, children }: { version?: string | null; children: ReactNode }) {
  const [content, setContent] = useState<Content | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    // Keep trying on a flaky connection or while the server restarts; say so after a few tries.
    const load = async () => {
      try {
        const active = (await api<{ version: string }>('/content/active')).version;
        // In development the workbook is rebuilt under the same version number, so never reuse a cached copy.
        const get = (v: string) => api<Content>(`/content/${encodeURIComponent(v)}`, { cache: import.meta.env.DEV ? 'no-cache' : undefined });
        let c = await get(version ?? active);
        // A group keeps the definitions it started with (FR-A5), but interface text added in a
        // later app release comes from the active version so new screens are never unlabelled.
        if (version && version !== active) {
          const latest = await get(active);
          // The footer (credit, copyright, licence) is always the latest wording.
          const footer = Object.fromEntries(Object.entries(latest.ui_text).filter(([k]) => k.startsWith('footer.')));
          c = { ...c, ui_text: { ...latest.ui_text, ...c.ui_text, ...footer } };
        }
        if (!cancelled) setContent(c);
      } catch {
        if (cancelled) return;
        attempt++;
        if (attempt >= 3) setFailed(true);
        setTimeout(() => { if (!cancelled) void load(); }, Math.min(1000 * attempt, 5000));
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [version]);

  const value = useMemo(() => (content ? makeContentApi(content) : null), [content]);
  // Content is not loaded yet, so this one message cannot come from the workbook.
  if (!value && failed) return <p className="wrap err" role="alert" aria-busy="true">Can't reach the server. Retrying…</p>;
  if (!value) return <p className="wrap muted" aria-busy="true">Loading…</p>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Renders the Markdown subset the workbook allows: **bold** and *italics*. Everything else is plain text. */
export function Md({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') && p.length > 4 ? <strong key={i}>{p.slice(2, -2)}</strong>
        : p.startsWith('*') && p.endsWith('*') && p.length > 2 ? <em key={i}>{p.slice(1, -1)}</em>
        : p,
      )}
    </>
  );
}
