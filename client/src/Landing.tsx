// Home page (SPEC §3.3): one big code box. What happens next depends on the code:
//  - workshop code (E-ABC123): pick one of the workshop's teams, enter your name(s), go in
//  - team code (ABC-123): enter your name(s), go in
// Teams are set up only by facilitators; the only other way in is a practice group.
// Links and QR codes (/join/CODE) open the matching screen straight away.

import { useEffect, useId, useState, type FormEvent } from 'react';
import { formatTeamCode, isCodeShape, isWorkshopCode, normalizeCode } from '../../shared/codes';
import { api, ApiError, type JoinResponse, type LookupResponse, type PracticeResponse } from './api';
import { fmtDateTime } from './components/Time';
import { useContent } from './content';
import { navigate } from './router';
import { store } from './session';

type T = ReturnType<typeof useContent>['t'];

/** Joins a team (by team code, or by workshop code and the picked team) and opens its worksheet. Returns an error message or null. */
export async function joinGroup(code: string, displayName: string, t: T, groupId?: string): Promise<string | null> {
  try {
    const r = await api<JoinResponse>('/join', { method: 'POST', body: { teamCode: code, groupId, displayName: displayName || null } });
    store.setSession({ teamCode: r.group.teamCode, groupId: r.group.id, token: r.groupToken, contentVersion: r.group.contentVersion });
    store.setLastCode(r.group.teamCode);
    navigate(`/g/${r.group.teamCode}`);
    return null;
  } catch (e) {
    if (!(e instanceof ApiError)) return t('error.generic');
    if (e.code === 'not_open') {
      const at = e.body?.startsAt ? new Date(String(e.body.startsAt)).toLocaleString(undefined, { timeZoneName: 'short' }) : '…';
      return t('join.notopen', { time: at });
    }
    if (e.status === 429) return t('join.ratelimited');
    if (e.code === 'archived') return t('join.archived');
    if (e.status === 404 || e.status === 400) return t('join.error');
    return t('error.generic');
  }
}

/** "abc123" shows as "ABC-123", "e abc123" as "E-ABC123", while typing. */
function shapeCode(v: string): string {
  const c = normalizeCode(v).slice(0, 7);
  if (c.startsWith('E') && c.length === 7) return `E-${c.slice(1)}`;
  return c.length > 3 && c.length <= 6 ? `${c.slice(0, 3)}-${c.slice(3)}` : c;
}

/** Your name, or several names on one line: kept on this device for next time. */
function NamesField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useContent();
  return (
    <div className="f">
      <label className="lab" htmlFor="join-name">{t('join.name.label')}</label>
      <small id="join-name-help">{t('join.name.help')}</small>
      <input id="join-name" maxLength={200} value={value} onChange={(e) => onChange(e.target.value)} aria-describedby="join-name-help" autoComplete="off" />
    </div>
  );
}

type Found = { code: string; result: LookupResponse };

export function Landing({ initialCode }: { initialCode?: string }) {
  const { t } = useContent();
  const id = useId();
  // Older workshop QR codes used /?event=E-…; they open the same "pick your team" screen.
  const linked = initialCode ?? new URLSearchParams(window.location.search).get('event') ?? '';
  const [code, setCode] = useState(linked ? shapeCode(linked) : '');
  const [found, setFound] = useState<Found | null>(null);
  const [team, setTeam] = useState('');
  const [name, setName] = useState(store.displayName());
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const last = store.lastCode();

  const lookup = async (raw: string) => {
    setErr(null);
    const c = normalizeCode(raw);
    if (!isCodeShape(c) && !isWorkshopCode(c)) { setErr(t('home.code.short')); return; }
    setBusy(true);
    try {
      const result = await api<LookupResponse>('/lookup', { method: 'POST', body: { code: raw } });
      setFound({ code: shapeCode(raw), result });
      setTeam('');
    } catch (e) {
      setErr(e instanceof ApiError && e.status === 429 ? t('join.ratelimited') : e instanceof ApiError && e.status === 404 ? t('join.error') : t('error.generic'));
    }
    setBusy(false);
  };

  // A link or QR code goes straight to the next screen.
  useEffect(() => { if (linked) void lookup(linked); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onCode = (e: FormEvent) => { e.preventDefault(); void lookup(code); };

  const onJoin = async (e: FormEvent) => {
    e.preventDefault();
    if (!found) return;
    if (found.result.kind === 'workshop' && !team) { setErr(t('pick.missing')); return; }
    setBusy(true);
    store.setDisplayName(name.trim());
    setErr(await joinGroup(found.code, name.trim(), t, found.result.kind === 'workshop' ? team : undefined));
    setBusy(false);
  };

  const onContinue = async () => {
    const s = store.session();
    if (s && last && normalizeCode(s.teamCode) === normalizeCode(last)) navigate(`/g/${s.teamCode}`);
    else if (last) setErr(await joinGroup(last, store.displayName(), t));
  };

  // "Just exploring": a practice group opens straight away, and can be shared for 24 hours.
  const onPractice = async () => {
    setErr(null);
    setBusy(true);
    try {
      const r = await api<PracticeResponse>('/groups', { method: 'POST', body: { practice: true } });
      store.setSession({ teamCode: r.teamCode, groupId: r.groupId, token: r.groupToken, contentVersion: null });
      navigate(`/g/${r.teamCode}`);
    } catch {
      setErr(t('error.generic'));
      setBusy(false);
    }
  };

  const back = () => { setFound(null); setErr(null); if (window.location.pathname !== '/') navigate('/'); };

  // Step 2: a workshop's teams to pick from, or the team, then names.
  if (found) {
    const r = found.result;
    return (
      <main className="wrap home">
        <section className="home-center" aria-labelledby={`${id}-h`}>
          <form className="panel stack join-panel" onSubmit={onJoin} autoComplete="off">
            <div><button type="button" className="btn link" onClick={back}>← {t('home.back')}</button></div>
            {r.kind === 'workshop' ? (
              <>
                <div>
                  <p className="home-eyebrow">{t('pick.eyebrow')} · <span className="mono">{r.workshop.code}</span></p>
                  <h1 id={`${id}-h`} className="join-title">{r.workshop.name}</h1>
                  {r.workshop.state === 'draft' && r.workshop.startsAt && <p className="note">{t('join.notopen', { time: fmtDateTime(r.workshop.startsAt) })}</p>}
                </div>
                <fieldset className="pick-teams">
                  <legend className="lab">{t('pick.team')}</legend>
                  {r.teams.length === 0 && <p className="note">{t('pick.none')}</p>}
                  {r.teams.map((x) => (
                    <label key={x.id} className={`choice${team === x.id ? ' on' : ''}`}>
                      <input type="radio" name="team" value={x.id} checked={team === x.id} onChange={() => { setTeam(x.id); setErr(null); }} />
                      <span><b>{x.label}</b>{x.state === 'closed' && <span className="note"> · {t('state.closed')}</span>}</span>
                    </label>
                  ))}
                </fieldset>
                <p className="note">{t('pick.help')}</p>
              </>
            ) : (
              <div>
                <p className="home-eyebrow">{t(r.team.practice ? 'practice.label' : 'join.team')} · <span className="mono">{formatTeamCode(found.code)}</span></p>
                <h1 id={`${id}-h`} className="join-title">{r.team.label ?? t('practice.label')}</h1>
              </div>
            )}
            <NamesField value={name} onChange={setName} />
            {err && <p className="err" role="alert">{err}</p>}
            <div><button className="btn primary" type="submit" disabled={busy}>{t('join.submit')}</button></div>
          </form>
        </section>
      </main>
    );
  }

  // Step 1: one big code box.
  return (
    <main className="wrap home">
      <section className="home-center" aria-labelledby="home-title">
        <p className="home-eyebrow">{t('app.tagline')}</p>
        <h1 id="home-title">{t('home.headline')}</h1>
        <p className="home-lead">{t('home.lead')}</p>
        <form className="codepill-form" onSubmit={onCode} autoComplete="off" noValidate>
          <div className="codepill">
            <span className="codepill-ic" aria-hidden="true">👥</span>
            <input id="home-code" aria-label={t('home.code.label')} placeholder={t('home.code.placeholder')} maxLength={8}
              value={code} onChange={(e) => { setErr(null); setCode(shapeCode(e.target.value)); }}
              aria-describedby={err ? 'home-err' : 'home-link'} autoCapitalize="characters" spellCheck={false} />
            <button className="btn primary" type="submit" disabled={busy}>{t('home.code.join')}</button>
          </div>
          <p id="home-err" className="err" role="alert">{err ?? ''}</p>
        </form>
        <p id="home-link" className="home-note">{t('home.link')}</p>
        <p className="home-note">{t('home.nocode')}</p>
        <p className="home-more">
          {t('home.explore')}{' '}
          <button type="button" className="btn link" onClick={onPractice} disabled={busy}>{t('home.practice')}</button>
          {last && <> · <button type="button" className="btn link" onClick={onContinue}>{t('join.continue', { code: last })}</button></>}
        </p>
      </section>
    </main>
  );
}
