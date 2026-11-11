// Mapping step (SPEC §7.5): the same architecture layers as Components, showing only what
// the team marked Needed there. Each card holds the systems used today, E / P / A, whether it
// could be shared regionally, and notes. Interoperability is cross-cutting, so it is a column
// beside the layers, as on the Sydney sheet.

import { useEffect, useState, type ReactNode } from 'react';
import { APP_IDS, ARCH_LAYERS, ASSESS_IDS, BLOCK_IDS, INTEROP_IDS, STANDARD_IDS, type ArchLayer } from '../../../shared/ids';
import { ChoiceChips, TextField, ToggleChip, type ChoiceOption } from '../components/Fields';
import { SharedIcon } from '../components/Icons';
import { InfoButton, Term } from '../components/Info';
import { Modal } from '../components/Modal';
import { useContent } from '../content';
import { StatusLegend } from './steps';
import { useWs } from './WorksheetContext';

/** First lines of a free-text systems field, for the card preview. */
function Preview({ text, empty }: { text: string; empty: string }) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return <span className="sys-empty">+ {empty}</span>;
  return <span className="sys-list">{lines.join(' · ')}</span>;
}

function ShareToggle({ id, name }: { id: string; name: string }) {
  const { t } = useContent();
  const ws = useWs();
  const on = ws.values[`mp.star.${id}`] === true;
  return (
    <button
      type="button"
      className="chip sharechip"
      aria-pressed={on}
      aria-label={`${t('mp.star')}: ${name}`}
      title={t('mp.star')}
      disabled={ws.readOnly}
      onClick={() => ws.set(`mp.star.${id}`, on ? null : true)}
    >
      <SharedIcon />
    </button>
  );
}

/** Application categories keep their systems in mp.apps.<id>; everything else in mp.sys.<id>. */
const sysPath = (id: string) => ((APP_IDS as readonly string[]).includes(id) ? `mp.apps.${id}` : `mp.sys.${id}`);

/** Details pop-up: systems (several, one per line), status, regional sharing and notes. */
function BlockDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { item, items, t } = useContent();
  const it = item(id);
  const name = it?.label ?? id;
  const statusOpts: ChoiceOption[] = items('status').map((s) => ({ value: s.id, label: `${s.id} · ${s.label}`, className: `st-${s.id}` }));
  return (
    <Modal title={<><InfoButton id={id} />{name}{it?.core_star && <span className="star" aria-hidden="true"> ★</span>}</>} onClose={onClose} closeLabel={t('mp.done')}>
      {it?.short_def && <p className="muted">{it.short_def}</p>}
      <TextField path={sysPath(id)} label={t('mp.sys.label')} help={t('mp.sys.help')} multiline />
      <div className="stack" style={{ gap: 6 }}>
        <span className="lab" style={{ fontWeight: 700, fontSize: 13.5 }}>{t('cp.col.status')}</span>
        <ChoiceChips path={`cp.${id}.status`} options={statusOpts} groupLabel={`${t('cp.col.status')}: ${name}`} />
      </div>
      <div className="row" style={{ gap: 8 }}>
        <ShareToggle id={id} name={name} />
        <span>{t('mp.star')}</span>
      </div>
      <TextField path={`cp.${id}.note`} label={t('mp.note')} multiline />
    </Modal>
  );
}

function Block({ id }: { id: string }) {
  const { item, items, t } = useContent();
  const ws = useWs();
  const [open, setOpen] = useState(false);
  const it = item(id);
  const name = it?.label ?? id;
  const status = ws.values[`cp.${id}.status`];
  const sys = ws.values[sysPath(id)];
  const systems = typeof sys === 'string' ? sys : '';
  const hasNote = typeof ws.values[`cp.${id}.note`] === 'string';
  const statusOpts: ChoiceOption[] = items('status').map((s) => ({ value: s.id, label: s.id, srLabel: s.label, className: `st-${s.id}` }));
  return (
    <div className={`blk${status ? ` st-${status}` : ''}`} role="group" aria-label={name}>
      <div className="bn">
        <span className="bname"><Term id={id} /></span>
        {it?.core_star && <span className="star" aria-hidden="true">★</span>}
      </div>
      <button type="button" className="sysbtn" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <span className="sr-only">{t('mp.sys.label')}: </span>
        <Preview text={systems} empty={t('mp.sys.empty')} />
        {hasNote && <span className="notedot" title={t('mp.note')}>✎</span>}
      </button>
      <div className="blk-foot">
        <ChoiceChips path={`cp.${id}.status`} options={statusOpts} groupLabel={`${t('cp.col.status')}: ${name}`} />
        <ShareToggle id={id} name={name} />
      </div>
      {open && <BlockDialog id={id} onClose={() => setOpen(false)} />}
    </div>
  );
}

function Layer({ id, color, title, note, children }: { id: string; color: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section className="lyr" style={{ ['--c' as string]: `var(--${color})` }} aria-labelledby={id}>
      <h3 id={id} className="lt">{title}{note && <span className="lnote">{note}</span>}</h3>
      {children}
    </section>
  );
}

export function MapStep() {
  const { item, items, t } = useContent();
  const ws = useWs();
  // Layers show only what the team marked Needed in Components, in the same order.
  // Interoperability is the core of DPI-H, so its column is always there in full.
  const needed = (id: string) => ws.values[`cp.${id}.need`] === 'yes';
  const layers = ARCH_LAYERS
    .filter((l) => l.key !== 'interop')
    .map((l) => ({ ...l, groups: l.groups.map((g) => ({ ...g, ids: g.ids.filter(needed) })).filter((g) => g.ids.length) }))
    .filter((l) => l.groups.length);
  const starred = [...new Set([...ASSESS_IDS, ...BLOCK_IDS])].filter((id) => ws.values[`mp.star.${id}`] === true);
  const otherStd = typeof ws.values['mp.stdOther'] === 'string' && ws.values['mp.stdOther'] !== '';
  const [addStd, setAddStd] = useState(false);

  // Standards the team marked Exists in Components start ticked here. Only unset ones are
  // ticked: an explicit untick (false) on this page is kept.
  const existing = STANDARD_IDS.filter((id) => ws.values[`cp.${id}.status`] === 'E' && ws.values[`mp.std.${id}`] === undefined);
  const existingKey = existing.join(',');
  useEffect(() => {
    if (ws.readOnly) return;
    for (const id of existing) ws.set(`mp.std.${id}`, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingKey, ws.readOnly]);

  const layerBlock = (l: ArchLayer) => (
    <Layer key={l.key} id={`lyr-${l.key}`} color={l.color} title={t(`cp.layer.${l.key}`)} note={l.key === 'foundation' ? t('mp.core') : undefined}>
      {l.groups.map((g) => (
        <div key={g.group ?? 'all'} className="stack" style={{ gap: 8 }}>
          {g.group && <h4 className="sublt">{t(`cp.group.${g.group}` as never)}</h4>}
          <div className="blocks">{g.ids.map((id) => <Block key={id} id={id} />)}</div>
        </div>
      ))}
    </Layer>
  );

  return (
    <>
      <p className="note">{t('mp.only')}</p>
      <div className="map-legend">
        <StatusLegend category="status" />
        <p className="legend"><span><span className="sharemark"><SharedIcon size={14} /></span> {t('mp.star')}</span><span>{t('mp.core')}</span></p>
      </div>

      <div className="map">
        <div className="map-main">
          {layers.length ? layers.map(layerBlock) : <p className="banner">{t('mp.none')}</p>}
        </div>
        <aside className="map-side">
          <Layer id="lyr-interop" color="interop" title={t('mp.layer.interop')}>
            <div className="blocks one">{INTEROP_IDS.map((id) => <Block key={id} id={id} />)}</div>
            <div className="stack" style={{ gap: 8 }}>
              <h4 className="sublt">{t('mp.std')}</h4>
              <div className="chips">
                {items('standard').map((s) => <ToggleChip key={s.id} path={`mp.std.${s.id}`} label={s.label} infoId={s.id} rememberOff />)}
                {!otherStd && !addStd && !ws.readOnly && (
                  <button type="button" className="chip" onClick={() => setAddStd(true)}>+ {t('mp.std.add')}</button>
                )}
              </div>
              {(otherStd || addStd) && <TextField path="mp.stdOther" label={t('mp.std.other')} help={t('mp.std.other.help')} />}
            </div>
          </Layer>
        </aside>
      </div>

      <div className="map-after">
        <div className="grid2">
          <TextField path="mp.dis" infoId="mp.dis" label={t('mp.dis')} multiline />
          <section className="regional-box" aria-labelledby="mp-regional">
            <h3 id="mp-regional" className="numbered"><span className="sharemark"><SharedIcon /></span>{t('mp.regional.title')}</h3>
            <p className="note">{t('mp.regional.help')}</p>
            {starred.length
              ? <div className="chips">{starred.map((id) => <span key={id} className="tagchip"><SharedIcon size={13} /> {item(id)?.label ?? id}</span>)}</div>
              : <p className="muted">{t('mp.regional.none')}</p>}
          </section>
        </div>
      </div>
    </>
  );
}
