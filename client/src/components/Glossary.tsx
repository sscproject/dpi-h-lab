// Searchable glossary drawer (FR-I3): every Items entry grouped by category, plus general terms.

import { useEffect, useMemo, useRef, useState } from 'react';
import { REQUIRED_ITEM_IDS } from '../../../shared/ids';
import type { UiTextKey } from '../../../shared/ui-keys';
import { Md, useContent } from '../content';
import { ItemDefinition } from './Info';

const CATEGORIES = Object.keys(REQUIRED_ITEM_IDS);

export function GlossaryDrawer({ onClose }: { onClose: () => void }) {
  const { content, items, t } = useContent();
  const [q, setQ] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const drawer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null;
    search.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      // Keep Tab inside the drawer while it is open.
      if (e.key === 'Tab' && drawer.current) {
        const f = drawer.current.querySelectorAll<HTMLElement>('button, input');
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      returnTo?.focus();
    };
  }, [onClose]);

  const needle = q.trim().toLowerCase();
  const match = (...s: string[]) => !needle || s.some((x) => x.toLowerCase().includes(needle));

  const groups = useMemo(
    () =>
      CATEGORIES.map((cat) => ({
        cat,
        list: items(cat).filter((i) => match(i.label, i.short_def, i.long_def, i.examples)),
      })).filter((g) => g.list.length),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [needle, content],
  );
  const terms = content.glossary.filter((g) => match(g.term, g.definition));

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div ref={drawer} className="drawer" role="dialog" aria-modal="true" aria-labelledby="glossary-title">
        <div className="dh">
          <h2 id="glossary-title" style={{ flex: 1 }}>{t('glossary.title')}</h2>
          <button type="button" className="btn small" onClick={onClose}>{t('info.close')}</button>
        </div>
        <div className="dh">
          <label className="sr-only" htmlFor="glossary-search">{t('glossary.search')}</label>
          <input id="glossary-search" ref={search} type="search" placeholder={t('glossary.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="db" aria-live="polite">
          {!groups.length && !terms.length && <p className="muted">{t('glossary.empty')}</p>}
          {terms.length > 0 && (
            <section className="gcat">
              <h3>{t('glossary.terms')}</h3>
              {terms.map((g) => (
                <div className="gitem" key={g.term}>
                  <h4>{g.term}</h4>
                  <p><Md text={g.definition} /></p>
                  {g.source && <p className="note">{g.source}</p>}
                </div>
              ))}
            </section>
          )}
          {groups.map(({ cat, list }) => (
            <section className="gcat" key={cat}>
              <h3>{t(`cat.${cat}` as UiTextKey)}</h3>
              {list.map((i) => (
                <div className="gitem" key={i.id}>
                  <h4>{i.display_no != null && <span className="mono muted">{i.display_no} </span>}{i.label}</h4>
                  <ItemDefinition id={i.id} />
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
