// Printable codes sheet (FR-F2): A4, one card per group with the team code, the join link as
// text and a QR code. Uses the browser's print dialog (save as PDF or print).

import { useEffect, useState } from 'react';
import { QrSvg } from '../components/Qr';
import { useContent } from '../content';
import { navigate } from '../router';
import type { EventView } from './types';

type Call = <T>(path: string, opts?: { method?: string; body?: unknown }) => Promise<T>;

export function PrintCodes({ eventId, call }: { eventId: string; call: Call }) {
  const { t } = useContent();
  const [view, setView] = useState<EventView | null>(null);
  useEffect(() => { call<EventView>(`/events/${eventId}`).then(setView).catch(() => {}); }, [call, eventId]);
  if (!view) return <main className="wrap" aria-busy="true"><p className="muted">…</p></main>;
  return (
    <main className="wrap print-page">
      <div className="row no-print" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
        <a href={`/staff/events/${eventId}`} onClick={(e) => { e.preventDefault(); navigate(`/staff/events/${eventId}`); }}>← {view.event.name}</a>
        <button type="button" className="btn primary" onClick={() => window.print()}>{t('ev.codes.printnow')}</button>
      </div>
      <div className="code-cards">
        {view.groups.map((g) => (
          <section key={g.id} className="code-card">
            <p className="eyebrow">{view.event.name}</p>
            <h2>{g.country || g.name}</h2>
            <QrSvg text={g.joinUrl ?? ''} size={150} label={`${t('qr.join.title')}: ${g.country || g.name}`} />
            <p className="cc-label">{t('join.code.label')}</p>
            <p className="cc-code">{g.teamCode}</p>
            <p className="cc-url">{g.joinUrl}</p>
          </section>
        ))}
      </div>
    </main>
  );
}
