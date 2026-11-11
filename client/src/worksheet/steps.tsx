// Worksheet steps 0–3 (SPEC §7.1–7.4); steps 4–6 are in map.tsx, pathway.tsx and summary.tsx.
// Every option list, label and definition comes from the content workbook.

import { Fragment, useState, type ReactNode } from 'react';
import { countryName, representedCountry } from '../../../shared/countries';
import { ARCH_LAYERS, READINESS_IDS, READINESS_VALUES, type ArchLayer, type StepKey } from '../../../shared/ids';
import { ChoiceChips, MultiChoiceChips, TextField, type ChoiceOption } from '../components/Fields';
import { InfoButton, Term } from '../components/Info';
import { Md, useContent } from '../content';
import { GapStrip } from './generic';
import { StepTimer } from './StepTimer';
import { useWs } from './WorksheetContext';

/** The sheets' yellow DISCUSS prompt (FR-S2). */
export function Discuss({ text }: { text: string }) {
  const { t } = useContent();
  return (
    <div className="discuss">
      <span className="lbl">{t('discuss.label')}</span>
      <p><Md text={text} /></p>
    </div>
  );
}

export function StepHeader({ stepKey, index }: { stepKey: StepKey; index: number }) {
  const { step, t } = useContent();
  const s = step(stepKey);
  return (
    <>
      <div className="head">
        <div className="stack" style={{ gap: 4 }}>
          <p className="eyebrow">{index}. {t(`step.short.${stepKey}`)}</p>
          <h2 id="step-title" tabIndex={-1}>{s?.title}</h2>
          {s?.subtitle && <p className="muted"><Md text={s.subtitle} /></p>}
        </div>
        {s?.suggested_time && <StepTimer stepKey={stepKey} label={s.suggested_time} />}
      </div>
      {s?.discuss_prompt && <Discuss text={s.discuss_prompt} />}
    </>
  );
}

/** The team as the facilitator set it up: the country it represents and/or its name. Read-only here. */
function TeamIdentity() {
  const { t } = useContent();
  const { values } = useWs();
  const code = representedCountry(values);
  const name = typeof values.country === 'string' ? values.country.trim() : '';
  if (!code && !name) return null;
  return (
    <div className="team-identity">
      <div className="team-identity-row">
        {code && <div><span className="lab">{t('team.country')}</span><b>{countryName(code)}</b></div>}
        {name && <div><span className="lab">{t(code ? 'team.name' : 'team.team')}</span><b>{name}</b></div>}
      </div>
      <p className="note">{t('team.setby')}</p>
    </div>
  );
}

export function TeamStep() {
  const { t } = useContent();
  const { hiddenPaths } = useWs();
  return (
    <>
      {hiddenPaths.length > 0 && <p className="banner" role="status">{t('team.hidden')}</p>}
      <TeamIdentity />
      <TextField path="members" infoId="members" label={t('f.members')} help={t('f.members.help')} multiline />
      <TextField path="buddies" infoId="buddies" label={t('f.buddies')} help={t('f.buddies.help')} />
      <p className="banner">{t('pii.warning')}</p>
    </>
  );
}

export function UseCaseStep() {
  const { items, t } = useContent();
  const ws = useWs();
  const selected = ws.values['uc.option'];
  return (
    <>
      <div className="stack" style={{ gap: 8 }}>
        <span className="lab" style={{ fontWeight: 700, fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 4 }}>
          <span id="uc-option-label">{t('f.uc.option')}</span>
          <InfoButton id="uc.option" />
        </span>
        <div className="goals" role="group" aria-labelledby="uc-option-label">
          {items('goal').map((g) => {
            const on = selected === g.id;
            return (
              <div key={g.id} className={`goal${on ? ' on' : ''}`}>
                <button
                  type="button"
                  className="pick"
                  aria-pressed={on}
                  disabled={ws.readOnly}
                  onClick={() => ws.set('uc.option', on ? null : g.id)}
                >
                  <span className="n">{g.display_no}</span>
                  <h3>{g.label}</h3>
                  <span className="d"><Md text={g.short_def} /></span>
                </button>
                <InfoButton id={g.id} />
              </div>
            );
          })}
        </div>
      </div>
      {selected === 'OTH' && <TextField path="uc.otherTitle" infoId="uc.otherTitle" label={t('f.uc.otherTitle')} />}
      <TextField path="uc.text" infoId="uc.text" label={t('f.uc.text')} help={t('f.uc.text.help')} placeholder={t('f.uc.text.placeholder')} multiline />
    </>
  );
}

export function ReadinessStep() {
  const { item, t } = useContent();
  // Sections and rows in the defined order (six sections of three).
  const all = READINESS_IDS.map((id) => item(id)).filter((i): i is NonNullable<typeof i> => Boolean(i));
  // Sections are the readiness items' `layer` values, in that order.
  const domains = [...new Set(all.map((i) => i.layer))];
  const options: ChoiceOption[] = READINESS_VALUES.map((v) => ({ value: v, label: t(`rd.${v}`), className: v }));
  return (
    <>
      <div className="rgrid">
        {domains.map((d) => (
          <section className="rcard" key={d} aria-label={d}>
            <p className="eyebrow">{d}</p>
            {all.filter((i) => i.layer === d).map((i) => (
              <div className="ritem" key={i.id}>
                <span className="t"><Term id={i.id} /></span>
                <ChoiceChips path={`rd.${i.id}`} options={options} groupLabel={i.label} />
              </div>
            ))}
          </section>
        ))}
      </div>
      <GapStrip step="readiness" />
    </>
  );
}

export function StatusLegend({ category }: { category: 'status' | 'scope' }) {
  const { items } = useContent();
  return (
    <p className="legend">
      {items(category).map((s) => (
        <span key={s.id}>
          {category === 'status' && <i className="sw" style={{ background: `var(--${{ E: 'ok', P: 'warn', A: 'bad' }[s.id as 'E']})` }} aria-hidden="true" />}
          <b>{category === 'status' ? `${s.id} ` : ''}</b>{s.label}
          <InfoButton id={s.id} />
        </span>
      ))}
    </p>
  );
}

export function ComponentsStep() {
  const { item, items, t } = useContent();
  const ws = useWs();
  const [openLayer, setOpenLayer] = useState(0);
  const statusOpts: ChoiceOption[] = items('status').map((s) => ({ value: s.id, label: s.id, srLabel: s.label, className: `st-${s.id}` }));
  const scopeOpts: ChoiceOption[] = items('scope').map((s) => ({ value: s.id, label: s.label }));
  const needOpts: ChoiceOption[] = [
    { value: 'yes', label: t('cp.need.yes') },
    { value: 'no', label: t('cp.need.no') },
  ];

  const row = (id: string) => {
    const c = item(id);
    const name = c?.label ?? id;
    // Each answer column has its own class (and tint), so the chips read as columns, not one row of buttons.
    const cell = (col: string, label: string, control: ReactNode) => (
      <div className={`cell ${col}`}>
        <span className="cell-label" aria-hidden="true">{label}</span>
        {control}
      </div>
    );
    return (
      <div className="crow" key={id} role="group" aria-label={name}>
        <div className="cname-cell">
          <div className="cname">
            <Term id={id} />
            {c?.core_star && <span className="star" aria-hidden="true"> ★</span>}
          </div>
          {/* Sheet 1's "What it does" column. */}
          {c?.short_def && <p className="what"><span className="sr-only">{t('cp.col.what')}: </span><Md text={c.short_def} /></p>}
        </div>
        {cell('c-need', t('cp.col.need'), <ChoiceChips path={`cp.${id}.need`} options={needOpts} groupLabel={`${t('cp.col.need')} ${name}`} />)}
        {cell('c-status', t('cp.col.status'), <ChoiceChips path={`cp.${id}.status`} options={statusOpts} groupLabel={`${t('cp.col.status')}: ${name}`} />)}
        {cell('c-scope', t('cp.col.scope'), <MultiChoiceChips path={`cp.${id}.scope`} options={scopeOpts} groupLabel={`${t('cp.col.scope')}: ${name}`} />)}
      </div>
    );
  };

  // Layers expand and collapse, one open at a time, so teams work through one block of rows.
  const layer = (l: ArchLayer, index: number) => {
    const isOpen = openLayer === index;
    const ids = l.groups.flatMap((g) => g.ids);
    const answered = ids.filter((id) => typeof ws.values[`cp.${id}.need`] === 'string').length;
    return (
      <Fragment key={l.key}>
        <button type="button" className="clayer" style={{ ['--c' as string]: `var(--${l.color})` }} aria-expanded={isOpen}
          onClick={() => setOpenLayer(isOpen ? -1 : index)}>
          <span>{t(`cp.layer.${l.key}`)}</span>
          <span className="clayer-count">{t('cp.layer.count', { done: String(answered), total: String(ids.length) })}</span>
          <span className="clayer-chev" aria-hidden="true">{isOpen ? '▴' : '▾'}</span>
        </button>
        {isOpen && l.groups.map((g) => (
          <Fragment key={g.group ?? 'all'}>
            {g.group && <div className="cgroup">{t(`cp.group.${g.group}` as never)}</div>}
            {g.ids.map(row)}
          </Fragment>
        ))}
      </Fragment>
    );
  };

  return (
    <>
      <div className="ctable">
        <div className="crow headrow" aria-hidden="true">
          <span className="c-name">{t('cp.col.component')} · {t('cp.col.what')}</span>
          <span className="c-need">{t('cp.col.need')}</span>
          <span className="c-status">{t('cp.col.status')}</span>
          <span className="c-scope">{t('cp.col.scope')}</span>
        </div>
        {ARCH_LAYERS.map(layer)}
      </div>
      <p className="note">{t('cp.core')}</p>
      <StatusLegend category="status" />
      <StatusLegend category="scope" />
      <GapStrip step="components" />
    </>
  );
}

