// Step 5: Our DPI-H pathway (SPEC §7.6), laid out like Sheet 3: the top box recaps the team
// and use case, then 4 national priority, 5 the 12-month action, and ★ the regional candidate,
// each with its own time and DISCUSS prompt.

import { useId, type ReactNode } from 'react';
import { ARCH_LAYERS, BLOCK_IDS } from '../../../shared/ids';
import { setValues } from '../../../shared/worksheet';
import { ChoiceChips, TextField, ToggleChip, type ChoiceOption } from '../components/Fields';
import { SharedIcon } from '../components/Icons';
import { InfoButton } from '../components/Info';
import { useContent } from '../content';
import { BlockingGaps, CostFunding, ReferGap } from './generic';
import { Discuss } from './steps';
import { useWs } from './WorksheetContext';
import { teamLabel } from '../../../shared/countries';

/**
 * Single choice from the Components step's layers, in the same order.
 *  - National priority: what the team marked Needed for its use case.
 *  - Regional candidate (`regional`): what the team marked Regional scope in Components or
 *    "could be shared regionally" in Mapping; with none, a note says so instead of a list.
 * A past choice stays listed even if its answer has since changed.
 */
function ComponentSelect({ path, label, regional }: { path: string; label: string; regional?: boolean }) {
  const { item, t } = useContent();
  const ws = useWs();
  const id = useId();
  const value = typeof ws.values[path] === 'string' ? (ws.values[path] as string) : '';
  const eligible = (b: string) => (regional
    ? setValues(ws.values[`cp.${b}.scope`]).includes('regional') || ws.values[`mp.star.${b}`] === true
    : ws.values[`cp.${b}.need`] === 'yes');
  const shown = (b: string) => eligible(b) || b === value;
  const groups = ARCH_LAYERS
    .map((l) => [t(`cp.layer.${l.key}`), l.groups.flatMap((g) => g.ids).filter(shown)] as const)
    .filter(([, ids]) => ids.length);
  // Map blocks outside the layers (the consent service) can still be starred in Mapping.
  const extra = BLOCK_IDS.filter((b) => !ARCH_LAYERS.some((l) => l.groups.some((g) => g.ids.includes(b))) && shown(b));
  if (regional && !groups.length && !extra.length) {
    return (
      <div className="f">
        <span className="lab">{label}</span>
        <p className="note">{t('select.component.noregional')}</p>
      </div>
    );
  }
  return (
    <div className="f">
      <span className="lab"><label htmlFor={id}>{label}</label>{value && <InfoButton id={value} />}</span>
      <select id={id} value={value} disabled={ws.readOnly} onChange={(e) => ws.set(path, e.target.value || null)}>
        <option value="">{groups.length || extra.length ? t('select.component') : t('select.component.none')}</option>
        {groups.map(([g, ids]) => (
          <optgroup key={g} label={g}>
            {ids.map((b) => <option key={b} value={b}>{item(b)?.label ?? b}</option>)}
          </optgroup>
        ))}
        {extra.map((b) => <option key={b} value={b}>{item(b)?.label ?? b}</option>)}
      </select>
    </div>
  );
}

function SupportChips({ prefix }: { prefix: 'pw' | 'rg' }) {
  const { items, t } = useContent();
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="lab" style={{ fontWeight: 700, fontSize: 13.5 }}>{t('f.support')}</span>
      <div className="chips">
        {items('support').map((s) => <ToggleChip key={s.id} path={`${prefix}.support.${s.id}`} label={s.label} infoId={s.id} />)}
      </div>
    </div>
  );
}

// Sections have no timers of their own: the page has one timer for the whole Pathway step.
function Section({ num, title, discuss, className, children }: { num: ReactNode; title: string; discuss: string; className?: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className={`pw-sec stack ${className ?? ''}`} aria-labelledby={id}>
      <div className="head">
        <h3 id={id} className="numbered"><span className="num" aria-hidden="true">{num}</span>{title}</h3>
      </div>
      {discuss && <Discuss text={discuss} />}
      {children}
    </section>
  );
}

function Recap() {
  const { item, t } = useContent();
  const { values } = useWs();
  const missing = t('sum.missing');
  const str = (k: string) => (typeof values[k] === 'string' && (values[k] as string).trim()) || '';
  const option = str('uc.option');
  const optionText = option ? `${item(option)?.display_no ?? ''} · ${option === 'OTH' ? str('uc.otherTitle') || item('OTH')?.label : item(option)?.label}` : '';
  const row = (label: string, v: string) => (
    <div><dt>{label}</dt><dd className={v ? '' : 'muted'}>{v || missing}</dd></div>
  );
  return (
    <dl className="recap">
      {row(t('pw.recap.team'), teamLabel(values))}
      {row(t('pw.recap.option'), optionText)}
      {row(t('f.members'), str('members'))}
      {row(t('f.buddies'), str('buddies'))}
      <div className="wide">{row(t('f.uc.text'), str('uc.text'))}</div>
    </dl>
  );
}

export function PathwayStep() {
  const { items, t } = useContent();
  const ws = useWs();
  const leadOpts: ChoiceOption[] = items('lead').map((l) => ({ value: l.id, label: l.label }));
  return (
    <>
      <Recap />
      {/* 1, 2, 3 and then Regional, one under another, so the flow reads top to bottom. */}
      <div className="pw-top stack">
        <Section num="1" title={t('pw.h.priority')} discuss={t('pw.discuss.priority')}>
          <BlockingGaps />
          <ComponentSelect path="pw.priority" label={t('f.pw.priority')} />
          <TextField path="pw.why" infoId="pw.why" label={t('f.pw.why')} multiline />
          <TextField path="pw.gap" infoId="pw.gap" label={t('f.pw.gap')} />
        </Section>
        <Section num="2" title={t('pw.h.action')} discuss={t('pw.discuss.action')}>
          <TextField path="pw.action" infoId="pw.action" label={t('f.pw.action')} multiline />
          <TextField path="pw.owner" infoId="pw.owner" label={t('f.pw.owner')} help={t('f.pw.owner.help')} />
          <TextField path="pw.depends" infoId="pw.depends" label={t('f.pw.depends')} />
          <SupportChips prefix="pw" />
          <TextField path="pw.from" infoId="pw.from" label={t('f.pw.from')} />
        </Section>
      </div>
      <Section num="3" title={t('pw.h.cost')} discuss={t('pw.discuss.cost')}>
        <CostFunding />
      </Section>
      <Section num={<SharedIcon />} title={t('pw.h.regional')} discuss={t('pw.discuss.regional')} className="pw-regional">
        <div className="grid2">
          <ComponentSelect path="rg.component" label={t('f.rg.component')} regional />
          <div className="stack" style={{ gap: 6 }}>
            <span className="lab" style={{ fontWeight: 700, fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 4 }}>
              {t('f.rg.lead')}
            </span>
            <ChoiceChips path="rg.lead" options={leadOpts} groupLabel={t('f.rg.lead')} withInfo />
            {ws.values['rg.lead'] === 'OTHER' && <TextField path="rg.leadOther" label={t('f.rg.leadOther')} />}
          </div>
        </div>
        <div className="grid2">
          <TextField path="rg.why" infoId="rg.why" label={t('f.rg.why')} multiline />
          <TextField path="rg.step" infoId="rg.step" label={t('f.rg.step')} multiline />
        </div>
        <SupportChips prefix="rg" />
        <TextField path="rg.from" infoId="rg.from" label={t('f.rg.from')} />
      </Section>
      <Section num="4" title={t('pw.h.refer')} discuss="">
        <ReferGap />
      </Section>
    </>
  );
}
