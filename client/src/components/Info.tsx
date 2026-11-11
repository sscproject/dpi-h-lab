// Definitions (FR-I1–I5). Content is neutral and comes from the workbook by item ID; an
// unknown ID renders no button at all. On wide screens, where the worksheet shows a
// definitions panel beside it, ⓘ buttons and item names open the definition there; on
// phones and tablets they open a popover.

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { REQUIRED_ITEM_IDS } from '../../../shared/ids';
import type { UiTextKey } from '../../../shared/ui-keys';
import { Md, useContent } from '../content';

interface Open { id: string; trigger: HTMLElement }
interface InfoCtx {
  show(id: string, trigger: HTMLElement): void;
  /** Item ID, or "term:<glossary term>", shown in the definitions panel. */
  selected: string | null;
  select(key: string | null): void;
  registerPanel(on: boolean): void;
}
const Ctx = createContext<InfoCtx>({ show: () => {}, selected: null, select: () => {}, registerPanel: () => {} });

const WIDE = '(min-width: 1200px)';

function useMedia(query: string) {
  const [on, setOn] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const fn = () => setOn(m.matches);
    m.addEventListener('change', fn);
    return () => m.removeEventListener('change', fn);
  }, [query]);
  return on;
}

export function InfoProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<Open | null>(null);
  const [selected, select] = useState<string | null>(null);
  const [panels, setPanels] = useState(0);
  const wide = useMedia(WIDE);
  const panelMode = wide && panels > 0;
  const show = useCallback((id: string, trigger: HTMLElement) => {
    if (panelMode) {
      select(id);
      document.getElementById('def-panel-title')?.focus({ preventScroll: true });
    } else setOpen({ id, trigger });
  }, [panelMode]);
  const close = useCallback(() => {
    setOpen((cur) => {
      cur?.trigger.focus();
      return null;
    });
  }, []);
  const registerPanel = useCallback((on: boolean) => setPanels((n) => n + (on ? 1 : -1)), []);
  const value = useMemo(() => ({ show, selected, select, registerPanel }), [show, selected, registerPanel]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {open && !panelMode && <InfoPopover key={open.id} id={open.id} trigger={open.trigger} onClose={close} />}
    </Ctx.Provider>
  );
}

export function InfoButton({ id, label }: { id: string; label?: string }) {
  const { item, t } = useContent();
  const { show } = useContext(Ctx);
  const it = item(id);
  if (!it) return null;
  return (
    <button
      type="button"
      className="info-btn"
      aria-haspopup="dialog"
      aria-label={t('info.about', { label: label ?? it.label })}
      onClick={(e) => show(id, e.currentTarget)}
    >
      ⓘ
    </button>
  );
}

/** An item's name that opens its definition: a bigger target than the ⓘ alone. */
export function Term({ id, label }: { id: string; label?: string }) {
  const { item } = useContent();
  const { show } = useContext(Ctx);
  const it = item(id);
  if (!it) return <span>{label ?? id}</span>;
  return (
    <>
      {/* ⓘ first, so it sits in the same place on every row however long the name is. */}
      <InfoButton id={id} label={label} />
      <button type="button" className="term" onClick={(e) => show(id, e.currentTarget)}>{label ?? it.label}</button>
    </>
  );
}

/**
 * Definitions panel beside the worksheet on wide screens: the selected definition, or a
 * search across every item and glossary term. Hidden (and popovers used) on smaller screens.
 */
export function DefinitionsPanel({ top }: { top?: ReactNode }) {
  const { content, item, items, t } = useContent();
  const { selected, select, registerPanel } = useContext(Ctx);
  const wide = useMedia(WIDE);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!wide) return;
    registerPanel(true);
    return () => registerPanel(false);
  }, [wide, registerPanel]);

  const needle = q.trim().toLowerCase();
  const results = useMemo(() => {
    if (!needle) return [];
    const match = (...s: string[]) => s.some((x) => x.toLowerCase().includes(needle));
    const fromItems = Object.keys(REQUIRED_ITEM_IDS).flatMap((cat) =>
      items(cat).filter((i) => match(i.label, i.short_def)).map((i) => ({ key: i.id, label: i.label, cat: t(`cat.${cat}` as UiTextKey) })));
    const fromTerms = content.glossary.filter((g) => match(g.term, g.definition)).map((g) => ({ key: `term:${g.term}`, label: g.term, cat: t('glossary.terms') }));
    return [...fromTerms, ...fromItems].slice(0, 40);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needle, content]);

  if (!wide) return null;
  const term = selected?.startsWith('term:') ? content.glossary.find((g) => g.term === selected.slice(5)) : null;
  const it = selected && !term ? item(selected) : null;

  return (
    <aside className="def-panel" aria-labelledby="def-panel-title">
      {top}
      <h2 id="def-panel-title" tabIndex={-1} className="eyebrow">{t('def.title')}</h2>
      <label className="sr-only" htmlFor="def-search">{t('glossary.search')}</label>
      <input id="def-search" type="search" placeholder={t('glossary.search')} value={q} onChange={(e) => { setQ(e.target.value); select(null); }} />
      {(it || term) ? (
        <div className="def-card" aria-live="polite">
          <h3>{it ? <>{it.display_no != null && <span className="mono muted">{it.display_no} </span>}{it.label}</> : term!.term}</h3>
          {it ? <ItemDefinition id={it.id} /> : (
            <>
              <p><Md text={term!.definition} /></p>
              {term!.source && <p className="note">{term!.source}</p>}
            </>
          )}
          {needle && <button type="button" className="btn small" onClick={() => select(null)}>← {t('def.back')}</button>}
        </div>
      ) : needle ? (
        results.length ? (
          <ul className="def-results">
            {results.map((r) => (
              <li key={r.key}><button type="button" className="term" onClick={() => select(r.key)}>{r.label}</button> <span className="note">{r.cat}</span></li>
            ))}
          </ul>
        ) : <p className="muted">{t('glossary.empty')}</p>
      ) : <p className="muted">{t('def.empty')}</p>}
    </aside>
  );
}

function InfoPopover({ id, trigger, onClose }: { id: string; trigger: HTMLElement; onClose: () => void }) {
  const { item, t } = useContent();
  const it = item(id)!;
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const r = trigger.getBoundingClientRect();
    const el = ref.current!;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.min(Math.max(16, r.left + r.width / 2 - w / 2), window.innerWidth - w - 16);
    const below = r.bottom + 8;
    const top = below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 8) : below;
    setPos({ top, left });
  }, [trigger]);

  // Move focus in once positioned: the popover is hidden (and unfocusable) while it is measured.
  const placed = pos !== null;
  useEffect(() => { if (placed) ref.current?.focus(); }, [placed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !trigger.contains(e.target as Node)) onClose();
    };
    const onScroll = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [onClose, trigger]);

  return (
    <div
      ref={ref}
      className="popover"
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden', top: 0, left: 0 }}
    >
      <div className="ptitle">
        <h2 id={titleId}>{it.display_no != null && <span className="mono muted">{it.display_no} </span>}{it.label}</h2>
        <button type="button" className="btn small close" onClick={onClose}>{t('info.close')}</button>
      </div>
      <ItemDefinition id={id} />
    </div>
  );
}

/** Short definition, longer definition, examples and source (shared by popover and glossary). */
export function ItemDefinition({ id }: { id: string }) {
  const { item, t } = useContent();
  const it = item(id);
  if (!it) return null;
  return (
    <>
      {it.short_def && <p><Md text={it.short_def} /></p>}
      {it.long_def && <p className="muted"><Md text={it.long_def} /></p>}
      {it.examples && (
        <div className="def-section">
          <span className="eyebrow">{t('info.examples')}</span>
          <p><Md text={it.examples} /></p>
        </div>
      )}
      {it.source && (
        <div className="def-section">
          <span className="eyebrow">{t('info.source')}</span>
          <p className="note">{it.source}</p>
        </div>
      )}
    </>
  );
}
