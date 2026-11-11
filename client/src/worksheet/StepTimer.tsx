// Shared step timer: runs for the step's suggested time (from the content workbook, e.g.
// "5 min"). Anyone can start it and everyone in the group sees the same countdown, because
// the start time is saved like any other answer (timer.<step>). It never locks anything.
// The admin console (M4) will let admins set these times instead of the workbook default.

import type { StepKey } from '../../../shared/ids';
import { fmtLeft, useNow } from '../components/Time';
import { useContent } from '../content';
import { useWs } from './WorksheetContext';

/** Minutes from a label such as "5 min" or "15 min"; null when it is not a duration. */
export function minutesFrom(label: string | undefined): number | null {
  const m = /(\d+)\s*min/i.exec(label ?? '');
  return m ? Number(m[1]) : null;
}

export function StepTimer({ stepKey, section, label }: { stepKey: StepKey; section?: string; label: string }) {
  const { t } = useContent();
  const ws = useWs();
  const now = useNow();
  const minutes = minutesFrom(label);
  const path = section ? `timer.${stepKey}.${section}` : `timer.${stepKey}`;
  const started = typeof ws.values[path] === 'string' ? Date.parse(ws.values[path] as string) : NaN;

  if (!minutes) return <span className="time">{label}</span>;

  if (Number.isNaN(started)) {
    return (
      <button type="button" className="time timer-start" disabled={ws.readOnly} title={t('timer.help')}
        onClick={() => ws.set(path, new Date().toISOString())}>
        ▶ {t('timer.start', { time: label })}
      </button>
    );
  }

  const total = minutes * 60_000;
  const left = started + total - now;
  const done = left <= 0;
  const pct = Math.min(100, Math.max(0, ((total - left) / total) * 100));
  const level = done ? 'over' : left <= 60_000 ? 'crit' : left <= total * 0.25 ? 'warn' : '';
  return (
    <span className={`step-timer ${level}`} role="timer" aria-label={t('timer.label')} title={t('timer.help')}>
      <span className="timer-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
      <span className="timer-text" aria-live={done ? 'polite' : 'off'}>{done ? t('timer.up') : fmtLeft(left)}</span>
      {!ws.readOnly && <button type="button" className="btn small" onClick={() => ws.set(path, null)}>{t('timer.reset')}</button>}
    </span>
  );
}
