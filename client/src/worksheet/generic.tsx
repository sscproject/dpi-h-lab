// Generic sections from the Bangkok policy-maker canvas, for any use case:
//  - "What we don't have yet": a gap strip at the end of the assessment steps
//  - Step "Who decides": the four decisions, legal basis and levers
//  - Pathway additions: blocking gaps, costs and funding, the gap referred for follow-up
// Everything is the team's own answer; the options carry neutral definitions only.

import { useId, useState } from 'react';
import {
  ASSESS_IDS, BASIS_IDS, DECISION_IDS, GAP_PATTERN_IDS, GAP_ROWS, GAP_STEPS, LEGAL_IDS, LEGAL_VALUES, LEVER_IDS,
} from '../../../shared/ids';
import { gapText } from '../../../shared/worksheet';
import { ChoiceChips, TextField, ToggleChip, type ChoiceOption } from '../components/Fields';
import { InfoButton, Term } from '../components/Info';
import { useContent } from '../content';
import { useWs } from './WorksheetContext';

type GapStep = (typeof GAP_STEPS)[number];

/** Steps whose gaps are picked from the answers above them. */
type PickStep = 'readiness' | 'governance' | 'components';
const isPickStep = (s: GapStep): s is PickStep => s === 'readiness' || s === 'governance' || s === 'components';

/** The step's ONE-gap consensus field, at the end of its gap section. */
const ONE_GAP_PATH: Partial<Record<GapStep, string>> = { readiness: 'rd.gap', governance: 'gv.unblock', components: 'cp.gap' };

/**
 * Gaps that build on the answers above, so nobody retypes them:
 *  - Readiness: items marked "Not yet"
 *  - Who decides: decisions whose basis is "None"
 *  - Components: components marked Absent, unless marked Not needed
 * Each can be picked once across the rows; "Other" opens a text box for anything else.
 */
function GapPick({ step, prefix, row, n }: { step: PickStep; prefix: string; row: string; n: number }) {
  const { item, items, t } = useContent();
  const ws = useWs();
  const id = useId();
  const own = ws.values[`${prefix}.text`];
  const stored = ws.values[`${prefix}.item`];
  // Rows written before this list existed have text only: show them as "Other".
  const value = typeof stored === 'string' ? stored : typeof own === 'string' && own ? 'OTHER' : '';
  const takenElsewhere = new Set(GAP_ROWS.filter((r) => r !== row).map((r) => ws.values[`gap.${step}.${r}.item`]));
  const found = step === 'readiness'
    ? items('readiness').filter((i) => ws.values[`rd.${i.id}`] === 'not_yet')
    : step === 'governance'
      ? items('decision').filter((i) => ws.values[`gv.${i.id}.BASIS_NONE`] === true)
      : ASSESS_IDS.filter((c) => ws.values[`cp.${c}.status`] === 'A' && ws.values[`cp.${c}.need`] !== 'no').map((c) => item(c)).filter((i): i is NonNullable<typeof i> => Boolean(i));
  const free = found.filter((i) => !takenElsewhere.has(i.id));
  // Keep a past pick visible even if its answer above has since changed.
  const options = value && value !== 'OTHER' && !free.some((i) => i.id === value) ? [...free, item(value)!].filter(Boolean) : free;
  const pickText = t(`gap.pick.${step}` as never);
  const noneText = t(`gap.pick.none.${step}` as never);
  const choose = (v: string) => {
    ws.set(`${prefix}.item`, v || null);
    if (v !== 'OTHER') ws.set(`${prefix}.text`, null);
  };
  return (
    <>
      <div className="f">
        <span className="lab"><label htmlFor={id}>{t('gap.row', { n: String(n) })}</label>{value && value !== 'OTHER' && <InfoButton id={value} />}</span>
        <select id={id} value={value} disabled={ws.readOnly} onChange={(e) => choose(e.target.value)}>
          <option value="">{free.length || value ? pickText : noneText}</option>
          {options.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
          <option value="OTHER">{t('gap.other')}</option>
        </select>
      </div>
      {value === 'OTHER' && <TextField path={`${prefix}.text`} label={t('gap.other.text')} placeholder={t('gap.text.placeholder')} />}
    </>
  );
}

/**
 * "Group Reflection: What we don't have yet", the same on every assessment step: up to three
 * gaps, each with gap, does it block us, how could we start and debt, in that order. The
 * section ends with the group's consensus: which ONE gap holds you back most.
 */
export function GapStrip({ step }: { step: GapStep }) {
  const { items, t } = useContent();
  const ws = useWs();
  const used = (r: string) => Object.keys(ws.values).some((k) => k.startsWith(`gap.${step}.${r}.`));
  const lastUsed = GAP_ROWS.reduce((n, r, i) => (used(r) ? i + 1 : n), 0);
  const [added, setAdded] = useState(1);
  const shown = Math.min(GAP_ROWS.length, Math.max(1, lastUsed, added));
  const urgency: ChoiceOption[] = items('gap_urgency').map((u) => ({ value: u.id, label: u.label }));
  const onePath = ONE_GAP_PATH[step];
  // A row's fields; removing a row moves the rows below it up and clears the last one.
  const fields = ['item', 'text', 'urgency', 'debt', ...GAP_PATTERN_IDS];
  const remove = (index: number) => {
    for (let j = index; j < GAP_ROWS.length; j++) {
      for (const f of fields) {
        const next = j + 1 < GAP_ROWS.length ? ws.values[`gap.${step}.${GAP_ROWS[j + 1]}.${f}`] : undefined;
        const path = `gap.${step}.${GAP_ROWS[j]}.${f}`;
        if (ws.values[path] !== next) ws.set(path, next ?? null);
      }
    }
    setAdded(Math.max(1, shown - 1));
  };

  return (
    <section className="gapstrip" aria-labelledby={`gap-${step}`}>
      <div className="gap-head">
        <span className="gap-mark" aria-hidden="true">!</span>
        <div>
          <h3 id={`gap-${step}`}>{t('gap.title')}</h3>
          <p className="note">{t('gap.help')}</p>
        </div>
      </div>
      {GAP_ROWS.slice(0, shown).map((r, i) => {
        const p = `gap.${step}.${r}`;
        return (
          <div className="gap-row stack" key={r} style={{ gap: 12 }}>
            {isPickStep(step)
              ? <GapPick step={step} prefix={p} row={r} n={i + 1} />
              : <TextField path={`${p}.text`} label={t('gap.row', { n: String(i + 1) })} placeholder={t('gap.text.placeholder')} />}
            <div className="f">
              <span className="lab">{t('gap.urgency')}</span>
              <ChoiceChips path={`${p}.urgency`} options={urgency} groupLabel={`${t('gap.urgency')} ${i + 1}`} withInfo />
            </div>
            <div className="f">
              <span className="lab">{t('gap.pattern')}</span>
              <div className="chips">
                {GAP_PATTERN_IDS.map((id) => <ToggleChip key={id} path={`${p}.${id}`} label={items('gap_pattern').find((x) => x.id === id)?.label ?? id} infoId={id} />)}
              </div>
            </div>
            <TextField path={`${p}.debt`} label={t('gap.debt')} help={t('gap.debt.help')} />
            {!ws.readOnly && (used(r) || shown > 1) && (
              <button type="button" className="btn link gap-remove" onClick={() => remove(i)} aria-label={t('gap.remove.label', { n: String(i + 1) })}>
                {t('gap.remove')}
              </button>
            )}
          </div>
        );
      })}
      {shown < GAP_ROWS.length && !ws.readOnly && (
        <div><button type="button" className="btn small" onClick={() => setAdded(shown + 1)}>+ {t('gap.add')}</button></div>
      )}
      {/* The group's consensus for this section. */}
      {onePath && (
        <div className="gap-one">
          <TextField path={onePath} infoId={onePath} label={t('gap.one')} help={t('gap.one.help')} multiline />
        </div>
      )}
    </section>
  );
}

/** Step "Who decides" (Bangkok Sheet 4, part 2): name, don't decide. */
export function GovernanceStep() {
  const { item, items, t } = useContent();
  const ws = useWs();
  const legalOpts: ChoiceOption[] = LEGAL_VALUES.map((v) => ({ value: v, label: t(`legal.${v}`), className: v === 'yes' ? 'done' : v === 'partly' ? 'in_progress' : 'not_yet' }));
  return (
    <>
      <div className="decisions">
        {DECISION_IDS.map((id) => {
          const d = item(id);
          const unassigned = ws.values[`gv.${id}.unassigned`] === true;
          return (
            <section key={id} className={`decision${unassigned ? ' unassigned' : ''}`} aria-label={d?.label ?? id}>
              <h3 className="row" style={{ gap: 2 }}><Term id={id} /></h3>
              {d?.short_def && <p className="what">{d.short_def}</p>}
              <TextField path={`gv.${id}.holder`} label={t('gv.holder')} placeholder={t('gv.holder.placeholder')} />
              <div className="f">
                <span className="lab">{t('gv.basis')}</span>
                <div className="chips">
                  {BASIS_IDS.map((b) => <ToggleChip key={b} path={`gv.${id}.${b}`} label={items('basis').find((x) => x.id === b)?.label ?? b} infoId={b} />)}
                </div>
              </div>
              <div><ToggleChip path={`gv.${id}.unassigned`} label={t('gv.unassigned')} /></div>
            </section>
          );
        })}
      </div>

      <div className="grid2">
        <section className="stack" style={{ gap: 10 }} aria-labelledby="gv-legal">
          <h3 id="gv-legal">{t('gv.legal')}</h3>
          {LEGAL_IDS.map((id) => (
            <div className="ritem" key={id}>
              <span className="t"><Term id={id} /></span>
              <ChoiceChips path={`gv.legal.${id}`} options={legalOpts} groupLabel={item(id)?.label ?? id} />
            </div>
          ))}
        </section>
        <section className="stack" style={{ gap: 10 }} aria-labelledby="gv-levers">
          <h3 id="gv-levers">{t('gv.levers')}</h3>
          <div className="chips">
            {LEVER_IDS.map((id) => <ToggleChip key={id} path={`gv.lever.${id}`} label={item(id)?.label ?? id} infoId={id} />)}
          </div>
        </section>
      </div>
      <GapStrip step="governance" />
    </>
  );
}

/** The team's own "Blocks us now" gaps, gathered from every step, to choose a priority from. */
export function BlockingGaps() {
  const { item, t } = useContent();
  const { values } = useWs();
  const list = GAP_STEPS.flatMap((s) => GAP_ROWS
    .filter((r) => values[`gap.${s}.${r}.urgency`] === 'GAP_NOW')
    .map((r) => ({ key: `${s}.${r}`, step: s, text: gapText(values, s, r, (id) => item(id)?.label) }))
    .filter((g) => g.text));
  return (
    <div className="blocking">
      <p className="lab">{t('pw.blocking')}</p>
      {list.length
        ? <ul>{list.map((g) => <li key={g.key}>{g.text} <span className="muted">· {t(`step.short.${g.step}`)}</span></li>)}</ul>
        : <p className="note">{t('pw.blocking.none')}</p>}
    </div>
  );
}

/** Costs and funding (Bangkok Sheet 6, part 3). */
export function CostFunding() {
  const { items, t } = useContent();
  const ws = useWs();
  const ticked = items('cost').filter((c) => ws.values[`pw.cost.${c.id}`] === true);
  return (
    <>
      <div className="f">
        <span className="lab">{t('f.pw.cost')}</span>
        <div className="chips">{items('cost').map((c) => <ToggleChip key={c.id} path={`pw.cost.${c.id}`} label={c.label} infoId={c.id} />)}</div>
      </div>
      {ticked.length > 0 && (
        <div className="f">
          <span className="lab">{t('f.pw.costMain')}</span>
          <ChoiceChips path="pw.costMain" options={ticked.map((c) => ({ value: c.id, label: c.label }))} groupLabel={t('f.pw.costMain')} />
        </div>
      )}
      <div className="f">
        <span className="lab">{t('f.pw.fund')}</span>
        <div className="chips">{items('funding').map((f) => <ToggleChip key={f.id} path={`pw.fund.${f.id}`} label={f.label} infoId={f.id} />)}</div>
      </div>
      {ws.values['pw.fund.FUND_OTHER'] === true && <TextField path="pw.fundOther" label={t('f.pw.fundOther')} />}
    </>
  );
}

/** The one gap referred for follow-up (Bangkok Sheet 6, part 5). */
export function ReferGap() {
  const { items, t } = useContent();
  const ws = useWs();
  return (
    <>
      <TextField path="pw.refer" infoId="pw.refer" label={t('f.pw.refer')} multiline />
      <div className="f">
        <span className="lab">{t('f.pw.referTo')}</span>
        <div className="chips">{items('partner').map((p) => <ToggleChip key={p.id} path={`pw.referTo.${p.id}`} label={p.label} infoId={p.id} />)}</div>
      </div>
      {ws.values['pw.referTo.P_OTHER'] === true && <TextField path="pw.referOther" label={t('f.pw.referOther')} />}
    </>
  );
}
