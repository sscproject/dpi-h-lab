// Time display (FR-T1–T4): countdown to an end time, warning banners at 10 and 2 minutes,
// and local date-time formatting with the viewer's time zone name.

import { useEffect, useState } from 'react';
import { useContent } from '../content';

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** "Tue 20 Oct, 4:25 pm AEDT" in the viewer's own time zone. */
export function fmtDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}

export function fmtLeft(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** For <input type="datetime-local">: an ISO time as local "YYYY-MM-DDTHH:mm". */
export function toLocalInput(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

const TEN = 10 * 60_000;
const TWO = 2 * 60_000;

export function Countdown({ endsAt, big }: { endsAt: string | null | undefined; big?: boolean }) {
  const { t } = useContent();
  const now = useNow();
  if (!endsAt) return null;
  const left = new Date(endsAt).getTime() - now;
  const level = left <= 0 ? 'over' : left <= TWO ? 'crit' : left <= TEN ? 'warn' : '';
  const text = left <= 0 ? t('time.ended') : fmtLeft(left);
  return (
    <span className={`pill countdown ${level}${big ? ' big' : ''}`} role="timer" title={fmtDateTime(endsAt)}>
      <span className="sr-only">{left <= 0 ? '' : t('time.left', { time: text })}</span>
      <span aria-hidden="true">⏱ {text}</span>
    </span>
  );
}

/** Banners for members at 10 and 2 minutes before the end (FR-T3); each can be dismissed. */
export function TimeWarnings({ endsAt }: { endsAt: string | null | undefined }) {
  const { t } = useContent();
  const now = useNow();
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (!endsAt) return null;
  const left = new Date(endsAt).getTime() - now;
  const level = left > 0 && left <= TWO ? 'two' : left > 0 && left <= TEN ? 'ten' : null;
  const key = `${endsAt}|${level}`;
  if (!level || dismissed === key) return null;
  return (
    <div className={`banner timewarn ${level}`} role="alert">
      <span>{level === 'two' ? t('time.warn2', { time: fmtDateTime(endsAt) }) : t('time.warn10', { time: fmtDateTime(endsAt) })}</span>
      <button type="button" className="btn small" onClick={() => setDismissed(key)}>{t('info.close')}</button>
    </div>
  );
}
