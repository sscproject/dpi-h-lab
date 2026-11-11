// The group worksheet: sticky header with save status and step rail (FR-S1), one step panel at a time.

import { useEffect, useRef, useState, type ComponentType } from 'react';
import { STEP_KEYS, type StepKey } from '../../../shared/ids';
import { stepComplete } from '../../../shared/worksheet';
import { Footer, Header } from '../components/Header';
import { Countdown, fmtDateTime, TimeWarnings } from '../components/Time';
import { useContent } from '../content';
import { store } from '../session';
import { clientId } from '../session';
import { DefinitionsPanel } from '../components/Info';
import { GovernanceStep } from './generic';
import { MapStep } from './map';
import { PathwayStep } from './pathway';
import { ComponentsStep, ReadinessStep, StepHeader, TeamStep, UseCaseStep } from './steps';
import { SummaryStep } from './summary';
import { useWs, type Person, type SaveStatus } from './WorksheetContext';
import { teamLabel } from '../../../shared/countries';
import { CopyField } from '../components/CopyField';
import { Modal } from '../components/Modal';

const PANELS: Record<StepKey, ComponentType> = {
  team: TeamStep,
  use_case: UseCaseStep,
  readiness: ReadinessStep,
  components: ComponentsStep,
  map: MapStep,
  governance: GovernanceStep,
  pathway: PathwayStep,
  summary: SummaryStep,
};

export function SaveIndicator({ status }: { status: SaveStatus }) {
  const { t } = useContent();
  const text = {
    saved: t('save.saved'),
    saving: t('save.saving'),
    offline: t('save.offline'),
    readonly: t('save.readonly'),
    error: t('save.error'),
  }[status];
  return (
    <span className="pill status-pill" role="status" aria-live="polite">
      <span className={`dot ${status}`} aria-hidden="true" />
      <span className="status-text">{text}</span>
    </span>
  );
}

/** Who is connected and which step each person is on (FR-J4). */
function People() {
  const { t } = useContent();
  const ws = useWs();
  if (!ws.people.length) return null;
  const sorted = [...ws.people].sort((a, b) => (a.clientId === clientId ? -1 : b.clientId === clientId ? 1 : a.guestNo - b.guestNo));
  return (
    <details className="people">
      <summary className="pill" aria-label={`${t('presence.title')}: ${t('presence.count', { n: String(ws.people.length) })}`}>
        <span className="dot saved" aria-hidden="true" /><span className="people-n">{ws.people.length}</span><span className="people-text">{t('presence.count', { n: String(ws.people.length) })}</span>
      </summary>
      <div className="people-list" role="list" aria-label={t('presence.title')}>
        {/* Who has this team's worksheet open right now, by the name they joined with. */}
        <div className="people-head">{t('presence.heading', { team: teamLabel(ws.values) || ws.group.name || ws.group.teamCode })}</div>
        {sorted.map((p) => (
          <div role="listitem" key={p.clientId}>
            <span className="avatar" aria-hidden="true">{initial(ws.authorName(p))}</span>
            <span className="who"><span className="online" aria-hidden="true" /><span>{ws.authorName(p)}{p.clientId === clientId && <span className="muted"> ({t('presence.you')})</span>}<span className="sr-only"> ({t('presence.online')})</span></span></span>
            <span className="muted">{p.step}. {t(`step.short.${STEP_KEYS[p.step] ?? 'team'}`)}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

const initial = (name: string) => [...name.trim()][0]?.toUpperCase() ?? '?';

function othersOnStep(people: Person[], i: number) {
  return people.filter((p) => p.step === i && p.clientId !== clientId);
}

/** Group name and team code, so everyone can see which group they are in. */
function TeamPill() {
  const { t } = useContent();
  const { group, values } = useWs();
  // The country the team represents or its team name (Team step), else the name the group was created with.
  const typed = teamLabel(values);
  const name = typed || group.name || group.country;
  // Practice groups: the label, the code, and Share (link, QR and code), like any other group.
  if (group.practice) {
    return (
      <>
        <span className="pill team-pill practice-pill" title={group.teamCode}>
          <span className="team-name">{t('practice.label')}</span>
          <span className="mono" aria-label={t('join.code.label')}>{group.teamCode}</span>
        </span>
        <PracticeShare />
      </>
    );
  }
  return (
    <span className="pill team-pill" title={name ? `${name} · ${group.teamCode}` : group.teamCode}>
      {name && <span className="team-name">{name}</span>}
      <span className="mono" aria-label={t('join.code.label')}>{group.teamCode}</span>
    </span>
  );
}

/** Share a practice group: its link (with QR) and code work until it is deleted. */
function PracticeShare() {
  const { t } = useContent();
  const { group, viewOnly } = useWs();
  const [open, setOpen] = useState(false);
  if (viewOnly) return null;
  const link = `${window.location.origin}/join/${group.teamCode}`;
  return (
    <>
      <button type="button" className="btn small" aria-haspopup="dialog" onClick={() => setOpen(true)}>{t('practice.share')}</button>
      {open && (
        <Modal title={t('practice.share.title')} onClose={() => setOpen(false)}>
          <div className="stack" style={{ gap: 14 }}>
            <p>{t('practice.share.help')}</p>
            <div className="f">
              <span className="lab">{t('start.code.label')}</span>
              <span className="bigcode">{group.teamCode}</span>
            </div>
            <CopyField id="practice-link" label={t('start.link.label')} value={link} qrTitle={t('qr.join.title')} qrFile={`join-${group.teamCode}.png`} />
            {group.expiresAt && <p className="note">{t('practice.share.until', { time: fmtDateTime(group.expiresAt) })}</p>}
          </div>
        </Modal>
      )}
    </>
  );
}

/** The team's agreed use case (step 1), kept in view above the definitions on every step. */
function UseCaseNote() {
  const { item, t } = useContent();
  const { values } = useWs();
  const text = typeof values['uc.text'] === 'string' ? values['uc.text'].trim() : '';
  const option = typeof values['uc.option'] === 'string' ? values['uc.option'] : '';
  const optionLabel = option === 'OTH'
    ? (typeof values['uc.otherTitle'] === 'string' && values['uc.otherTitle'].trim()) || item('OTH')?.label
    : item(option)?.label;
  return (
    <section className="uc-note" aria-labelledby="uc-note-title">
      <h2 id="uc-note-title" className="eyebrow">{t('def.usecase')}</h2>
      {optionLabel && <p className="uc-option">{optionLabel}</p>}
      {text ? <p className="uc-text">{text}</p> : <p className="muted">{t('def.usecase.none')}</p>}
    </section>
  );
}

export function WorksheetPage({ onLeave, leaveLabel }: { onLeave: () => void; leaveLabel?: string }) {
  const { t } = useContent();
  const ws = useWs();
  const [step, setStep] = useState(() => Math.min(store.step(ws.group.id), STEP_KEYS.length - 1));
  const panel = useRef<HTMLElement>(null);
  const rail = useRef<HTMLElement>(null);
  const first = useRef(true);

  useEffect(() => {
    store.setStep(ws.group.id, step);
    ws.setStep(step);
    // Keep the current step visible in the rail when it scrolls sideways on phones.
    rail.current?.querySelector('[aria-current="step"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
    if (first.current) { first.current = false; return; }
    window.scrollTo({ top: 0 });
    panel.current?.querySelector<HTMLElement>('#step-title')?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, ws.group.id]);

  const key = STEP_KEYS[step];
  const Panel = PANELS[key];

  const railNav = (
    <nav className="rail" aria-label={t('app.name')} ref={rail}>
      <div className="wrap rail-inner">
        {STEP_KEYS.map((k, i) => {
          const done = stepComplete(k, ws.values);
          return (
            <button key={k} type="button" className="step" aria-current={i === step ? 'step' : undefined} onClick={() => setStep(i)}>
              <b>{i}</b>
              {t(`step.short.${k}`)}
              {done && <span className="tick" aria-hidden="true">✓</span>}
              {done && <span className="sr-only">({t('step.complete')})</span>}
              {othersOnStep(ws.people, i).slice(0, 3).map((p) => (
                <span key={p.clientId} className="avatar small" title={ws.authorName(p)} aria-hidden="true">{initial(ws.authorName(p))}</span>
              ))}
            </button>
          );
        })}
      </div>
    </nav>
  );

  return (
    <>
      <Header
        onLeave={onLeave}
        leaveLabel={leaveLabel}
        below={railNav}
        onHome={ws.viewOnly ? undefined : () => setStep(0)}
        status={<><TeamPill /><Countdown endsAt={ws.readOnly ? null : ws.endsAt} /><People /><SaveIndicator status={ws.status} /></>}
      />
      <main className="wrap ws">
        {ws.viewOnly && <p className="banner" role="status" style={{ marginBottom: 16 }}>{t('view.banner')}</p>}
        {ws.group.practice && <p className="banner practice-banner" role="status" style={{ marginBottom: 16 }}>{t('practice.banner', { time: ws.group.expiresAt ? fmtDateTime(ws.group.expiresAt) : '' })}</p>}
        {ws.readOnly && !ws.viewOnly && <p className="banner closed" role="status" style={{ marginBottom: 16 }}>{t('closed.banner')}</p>}
        {!ws.readOnly && <TimeWarnings endsAt={ws.endsAt} />}
        {!ws.readOnly && ws.idleCloseAt && new Date(ws.idleCloseAt).getTime() - Date.now() < 3 * 86_400_000 && (
          <p className="banner" role="status" style={{ marginBottom: 16 }}>{t('idle.warn', { date: fmtDateTime(ws.idleCloseAt) })}</p>
        )}
        {/* Wide screens: the step beside a definitions panel, so space is used without stretching rows. */}
        <div className="ws-layout">
          <section className="panel stack ws-main" aria-labelledby="step-title" ref={panel}>
            <StepHeader stepKey={key} index={step} />
            <Panel />
            <div className="row stepnav">
              {step > 0 ? (
                <button type="button" className="btn" onClick={() => setStep(step - 1)}>← {t(`step.short.${STEP_KEYS[step - 1]}`)}</button>
              ) : <span />}
              {step < STEP_KEYS.length - 1 && (
                <button type="button" className="btn primary" onClick={() => setStep(step + 1)}>{t(`step.short.${STEP_KEYS[step + 1]}`)} →</button>
              )}
            </div>
          </section>
          <DefinitionsPanel top={<UseCaseNote />} />
        </div>
      </main>
      <Footer onLeave={onLeave} leaveLabel={leaveLabel} />
    </>
  );
}
