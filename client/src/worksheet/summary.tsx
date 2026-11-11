// Step 6: Our summary (FR-SU1–SU3): the 60-second readout and key facts, built live
// from the worksheet, with copy and download.

import { useId, useState } from 'react';
import { Modal } from '../components/Modal';
import { fmtDateTime } from '../components/Time';
import type { Content } from '../../../shared/content';
import { buildSummary, summaryMarkdown, summaryText } from '../../../shared/summary';
import type { Worksheet } from '../../../shared/worksheet';
import { Md, useContent } from '../content';
import { useWs } from './WorksheetContext';
import { representedCountry, teamLabel } from '../../../shared/countries';

/**
 * Submit: one tickbox for consent, nothing ticked in advance. Submitting saves a dated copy of
 * the answers; ticking shares it with the DPI-H Lab team for benchmarking, with the country named.
 */
function SubmitDialog({ onClose }: { onClose: () => void }) {
  const { t } = useContent();
  const ws = useWs();
  const id = useId();
  const [share, setShare] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const country = representedCountry(ws.values);
  const go = async () => {
    setBusy(true);
    setError(null);
    try { await ws.submit(share); setDone(true); } catch { setError(t('error.generic')); }
    setBusy(false);
  };
  if (done) {
    return (
      <Modal title={t('submit.done.title')} onClose={onClose}>
        <p role="status">{t(share ? 'submit.done.shared' : 'submit.done.private')}</p>
        <p className="note">{t('submit.again')}</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn primary" onClick={onClose}>{t('mp.done')}</button></div>
      </Modal>
    );
  }
  return (
    <Modal title={t('submit.title')} onClose={onClose} wide>
      <div className="stack" style={{ gap: 14 }}>
        <p>{t('submit.intro')}</p>
        <div className="consent stack" style={{ gap: 10 }}>
          <h3>{t('consent.heading')}</h3>
          <p>{t('consent.intro')}</p>
          <label className={`choice${share ? ' on' : ''}`} htmlFor={`${id}-share`}>
            <input id={`${id}-share`} type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
            <span><b>{t(country ? 'submit.consent' : 'submit.consent.team')}</b><br /><span className="note">{t('submit.consent.help')}</span></span>
          </label>
          <p className="note"><Md text={t('consent.never')} /></p>
        </div>
        {error && <p className="err" role="alert">{error}</p>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>{t('confirm.cancel')}</button>
          <button type="button" className="btn primary" disabled={busy} onClick={go}>{t(share ? 'submit.go.share' : 'submit.go')}</button>
        </div>
      </div>
    </Modal>
  );
}

/** The Submit section at the end of the Summary: last submission, and the button. */
function SubmitSection() {
  const { t } = useContent();
  const ws = useWs();
  const [open, setOpen] = useState(false);
  // Practice groups and read-only views can't submit.
  if (ws.group.practice) return <p className="note submit-box">{t('submit.practice')}</p>;
  if (ws.viewOnly) return null;
  const s = ws.submission;
  return (
    <section className="submit-box stack" aria-labelledby="submit-h">
      <h3 id="submit-h">{t('submit.heading')}</h3>
      <p className="note">{t('submit.help')}</p>
      {s && (
        <p className="submit-last" role="status">
          ✓ {t('submit.last', { time: fmtDateTime(s.at), name: s.by ?? t('submit.someone') })} · {t(s.share ? 'submit.last.shared' : 'submit.last.private')}
        </p>
      )}
      <div><button type="button" className="btn primary" onClick={() => setOpen(true)}>{t(s ? 'submit.button.again' : 'submit.button')}</button></div>
      {open && <SubmitDialog onClose={() => setOpen(false)} />}
    </section>
  );
}

/** Saves the readout and key facts as a Markdown file. */
export function downloadSummary(values: Worksheet, content: Content, teamCode: string) {
  const blob = new Blob([summaryMarkdown(buildSummary(values, content))], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const country = teamLabel(values) || teamCode;
  a.download = `DPI-H pathway - ${country.replace(/[\\/:*?"<>|]/g, '')}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function SummaryStep() {
  const { content, t } = useContent();
  const ws = useWs();
  const [copied, setCopied] = useState(false);
  const s = buildSummary(ws.values, content);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summaryText(s));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the text is on screen to select */
    }
  };
  const download = () => downloadSummary(ws.values, content, ws.group.teamCode);

  return (
    <>
      <section className="stack" style={{ gap: 8 }} aria-labelledby="readout-title">
        <h3 id="readout-title">{t('sum.readout')}</h3>
        <p className="readout">
          {s.readout.map((p, i) => (p.value ? <b key={i} className={p.missing ? 'missing' : ''}>{p.text}</b> : <span key={i}>{p.text}</span>))}
        </p>
      </section>
      <section className="stack" style={{ gap: 8 }} aria-labelledby="facts-title">
        <h3 id="facts-title">{t('sum.facts')}</h3>
        <dl className="kv">
          {s.facts.map((f) => (
            <div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>
          ))}
        </dl>
      </section>
      <div className="row">
        <button type="button" className="btn primary" onClick={copy}><span aria-live="polite">{copied ? t('copy.copied') : t('sum.copy')}</span></button>
        <button type="button" className="btn" onClick={() => ws.downloadExcel().catch(() => alert(t('error.generic')))}>{t('sum.excel')}</button>
        <button type="button" className="btn" onClick={download}>{t('sum.download')}</button>
      </div>
      <SubmitSection />
    </>
  );
}
