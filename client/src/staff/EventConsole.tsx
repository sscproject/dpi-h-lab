// Facilitator console for one event: live dashboard (FR-F3), regional tally (FR-F4), event
// and group controls (FR-F5, FR-T2), link requests (FR-F8), codes (FR-F2), exports (FR-F6),
// read-only view of a group (FR-F9), and a projector view for the room readout.

import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { ApiError } from '../api';
import { Confirm } from '../components/Confirm';
import { CopyField, useCopy } from '../components/CopyField';
import { SharedIcon } from '../components/Icons';
import { Modal } from '../components/Modal';
import { Countdown, fmtDateTime, fromLocalInput, toLocalInput } from '../components/Time';
import { useContent } from '../content';
import { navigate } from '../router';
import { openStream } from '../worksheet/stream';
import { downloadWithToken, type StaffSession } from './staffSession';
import type { EventDto, EventView, GroupCard } from './types';
import { draftOf, newTeam, teamReady, TeamRow, TeamRows, teamSpec, type TeamDraft } from './Home';
import { isAdmin, type StaffUser } from './staffSession';
import type { Person } from './types';

type Call = <T>(path: string, opts?: { method?: string; body?: unknown }) => Promise<T>;

function Tally({ title, ids, icon }: { title: string; ids: (string | null)[]; icon?: boolean }) {
  const { item, t } = useContent();
  const counts = new Map<string, number>();
  for (const id of ids) if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  const rows = [...counts].sort((a, b) => b[1] - a[1]);
  const max = rows[0]?.[1] ?? 1;
  return (
    <section className="tally" aria-label={title}>
      <h3 className="row" style={{ gap: 6 }}>{icon && <span className="sharemark"><SharedIcon /></span>}{title}</h3>
      {rows.length === 0 ? <p className="muted">{t('dash.tally.none')}</p> : (
        <ol className="bars">
          {rows.map(([id, n]) => (
            <li key={id}>
              <span className="bar-label">{item(id)?.label ?? id}</span>
              <span className="bar-track"><span className="bar-fill" style={{ width: `${(n / max) * 100}%` }} /></span>
              <span className="bar-n">{n}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Card({ g, onAction, present }: { g: GroupCard; onAction: (g: GroupCard, a: 'view' | 'close' | 'reopen' | 'rename' | 'remove' | 'newcode') => void; present: boolean }) {
  const { item, t } = useContent();
  const label = (id: string | null) => (id ? item(id)?.label ?? id : t('sum.none'));
  return (
    <article className={`gcard state-${g.state}`} aria-label={g.country || g.name || g.teamCode}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h3>{g.country || g.name}</h3>
        <span className={`pill state-${g.state}`}>{t(`state.${g.state}` as 'state.open')}</span>
      </div>
      {!present && <span className="mono muted">{g.teamCode}{g.name && g.country && g.name !== g.country ? ` · ${g.name}` : ''}</span>}
      <div className="progress" role="progressbar" aria-valuenow={g.progressPct} aria-valuemin={0} aria-valuemax={100} aria-label={t('dash.progress')}>
        <span style={{ width: `${g.progressPct}%` }} />
      </div>
      <dl className="gfacts">
        <div><dt>{t('dash.progress')}</dt><dd>{g.progressPct}%</dd></div>
        <div><dt>{t('dash.priority')}</dt><dd>{label(g.priority)}</dd></div>
        <div><dt>{t('dash.regional')}</dt><dd>{label(g.regional)}</dd></div>
        {!present && <div><dt>{t('dash.connected')}</dt><dd>{g.connected}</dd></div>}
        {!present && <div><dt>{t('dash.activity')}</dt><dd>{fmtDateTime(g.lastActivity)}</dd></div>}
      </dl>
      {!present && (
        <div className="row card-actions">
          <button type="button" className="btn small" onClick={() => onAction(g, 'view')}>{t('dash.view')}</button>
          {g.state === 'closed'
            ? <button type="button" className="btn small" onClick={() => onAction(g, 'reopen')}>{t('owner.reopen')}</button>
            : <button type="button" className="btn small" onClick={() => onAction(g, 'close')}>{t('owner.close')}</button>}
          <button type="button" className="btn small" onClick={() => onAction(g, 'rename')}>{t('dash.rename')}</button>
          <button type="button" className="btn small" onClick={() => onAction(g, 'newcode')}>{t('dash.newcode')}</button>
          <button type="button" className="btn small" onClick={() => onAction(g, 'remove')}>{t('dash.remove')}</button>
        </div>
      )}
    </article>
  );
}

export function EventConsole({ eventId, session, call, onExpired }: { eventId: string; session: StaffSession; call: Call; onExpired: () => void }) {
  const { t } = useContent();
  const id = useId();
  const [view, setView] = useState<EventView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [present, setPresent] = useState(false);
  const [until, setUntil] = useState('');
  const [adding, setAdding] = useState<TeamDraft[]>([newTeam()]);
  // Editing one team's country or name (the facilitator sets these; teams see them read-only).
  const [editing, setEditing] = useState<{ g: GroupCard; d: TeamDraft } | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: 'close' | 'delete' } | { kind: 'remove' | 'closeGroup' | 'newcode'; g: GroupCard }>(null);
  const { copied, copy } = useCopy();
  const [coEmail, setCoEmail] = useState('');
  // Admins can hand the workshop to someone else, so they need the list of people.
  const [staff, setStaff] = useState<StaffUser[]>([]);
  useEffect(() => {
    if (isAdmin(session.user.role)) call<{ users: StaffUser[] }>('/admin/users').then((r) => setStaff(r.users.filter((u) => u.status === 'active'))).catch(() => {});
  }, [call, session.user.role]);

  const load = useCallback(async () => {
    try { setView(await call<EventView>(`/events/${eventId}`)); }
    catch (e) { setError(e instanceof ApiError && e.status === 404 ? t('ev.notfound') : t('error.generic')); }
  }, [call, eventId, t]);

  useEffect(() => { void load(); }, [load]);

  // Live dashboard: group cards and event state as they change; reconnects on its own.
  useEffect(() => {
    let stop = () => {};
    let retry: number | undefined;
    let disposed = false;
    const connect = () => {
      stop = openStream(`/api/v1/events/${eventId}/stream`, session.token, {
        onOpen: () => { setLive(true); void load(); },
        onEvent: (event, data) => {
          if (event === 'event') setView((v) => (v ? { ...v, event: data as EventDto } : v));
          if (event === 'group') {
            const c = data as GroupCard & { removed?: boolean };
            // A new link request: reload so it shows under "Groups asking to join" (FR-F8).
            setView((v) => {
              if (!v) return v;
              if (c.removed) return { ...v, groups: v.groups.filter((g) => g.id !== c.id) };
              const i = v.groups.findIndex((g) => g.id === c.id);
              if (i < 0) { void load(); return v; } // a new or newly approved group
              const groups = [...v.groups];
              groups[i] = { ...groups[i], ...c };
              return { ...v, groups };
            });
          }
        },
        onClose: (status) => {
          setLive(false);
          if (disposed) return;
          if (status === 401) return onExpired();
          retry = window.setTimeout(connect, 3000);
        },
      });
    };
    connect();
    return () => { disposed = true; stop(); window.clearTimeout(retry); };
  }, [eventId, session.token, load, onExpired]);

  const run = async (path: string, body?: unknown, done?: string) => {
    setNotice(null);
    try {
      const r = await call<EventView | { deleted: true }>(path, { method: 'POST', body: body ?? {} });
      if ('deleted' in r) { navigate('/staff'); return; }
      setView(r);
      if (done) setNotice(done);
    } catch (e) {
      setNotice(e instanceof ApiError && e.status !== 0 && e.status < 500 ? e.message : t('error.generic'));
    }
  };

  // Settings and people changes (PATCH / DELETE); leaving the workshop goes back home.
  const send = async (method: 'PATCH' | 'POST' | 'DELETE', path: string, body?: unknown, done?: string) => {
    setNotice(null);
    try {
      const r = await call<EventView | { left: true }>(path, { method, body });
      if ('left' in r) { navigate('/staff'); return; }
      setView(r);
      if (done) setNotice(done);
    } catch (e) {
      setNotice(e instanceof ApiError && e.status !== 0 && e.status < 500 ? e.message : t('error.generic'));
    }
  };

  const ids = useMemo(() => ({
    priorities: view?.groups.map((g) => g.priority) ?? [],
    regional: view?.groups.map((g) => g.regional) ?? [],
  }), [view]);

  if (error) return <main className="wrap"><p className="err" role="alert">{error}</p></main>;
  if (!view) return <main className="wrap" aria-busy="true"><p className="muted">…</p></main>;
  const ev = view.event;
  const base = `/events/${ev.id}`;

  const onAction = (g: GroupCard, a: 'view' | 'close' | 'reopen' | 'rename' | 'remove' | 'newcode') => {
    if (a === 'newcode') { setConfirm({ kind: 'newcode', g }); return; }
    if (a === 'view') navigate(`/staff/view/${ev.id}/${g.id}`);
    else if (a === 'reopen') void run(`${base}/groups/${g.id}/reopen`);
    else if (a === 'close') setConfirm({ kind: 'closeGroup', g });
    else if (a === 'remove') setConfirm({ kind: 'remove', g });
    else setEditing({ g, d: draftOf(g) });
  };

  const codesText = view.groups.map((g) => `${g.country || g.name}\t${g.teamCode}\t${g.joinUrl ?? ''}`).join('\n');

  return (
    <main className={`wrap stack console${present ? ' present' : ''}`}>
      <div className="head">
        <div className="stack" style={{ gap: 4 }}>
          {!present && <a className="note" href="/staff" onClick={(e) => { e.preventDefault(); navigate('/staff'); }}>← {t('staff.back')}</a>}
          <h1 className="h-page">{ev.name}</h1>
          <div className="row">
            <span className={`pill state-${ev.state}`}>{t(`state.${ev.state}` as 'state.open')}</span>
            <span className="pill mono">{ev.code}</span>
            {!present && <span className="note" aria-live="polite">{live ? t('dash.live') : t('dash.reconnecting')}</span>}
          </div>
        </div>
        <div className="stack" style={{ gap: 8, alignItems: 'flex-end' }}>
          <Countdown endsAt={ev.state === 'open' ? ev.endsAt : null} big />
          <button type="button" className="btn small" aria-pressed={present} onClick={() => setPresent(!present)}>{present ? t('dash.present.exit') : t('dash.present')}</button>
        </div>
      </div>
      {notice && <p className="banner" role="status">{notice}</p>}

      {!present && (
        <section className="panel stack" aria-labelledby={`${id}-ctl`}>
          <h2 id={`${id}-ctl`}>{t('ev.controls')}</h2>
          <p className="note">
            {ev.startsAt ? t('ev.startsat', { time: fmtDateTime(ev.startsAt) }) : ''} {ev.endsAt ? t('owner.time.ends', { time: fmtDateTime(ev.endsAt) }) : t('owner.time.none')}
          </p>
          <div className="row">
            {ev.state === 'draft' && <button type="button" className="btn primary" onClick={() => run(`${base}/start`, {}, t('ev.started'))}>{t('ev.start')}</button>}
            {ev.state === 'closed'
              ? <button type="button" className="btn primary" onClick={() => run(`${base}/reopen`, {}, t('owner.saved'))}>{t('ev.reopen')}</button>
              : <button type="button" className="btn" onClick={() => setConfirm({ kind: 'close' })}>{t('ev.close')}</button>}
            {[10, 15, 30].map((m) => (
              <button key={m} type="button" className="btn" onClick={() => run(`${base}/extend`, { minutes: m }, t('owner.saved'))}>+{m} {t('time.min')}</button>
            ))}
          </div>
          <div className="row">
            <label className="sr-only" htmlFor={`${id}-until`}>{t('owner.time.set')}</label>
            <input id={`${id}-until`} type="datetime-local" style={{ maxWidth: 260 }} value={until || toLocalInput(ev.endsAt)} onChange={(e) => setUntil(e.target.value)} />
            <button type="button" className="btn" disabled={!until} onClick={() => run(`${base}/extend`, { until: fromLocalInput(until) }, t('owner.saved'))}>{t('owner.time.set')}</button>
            {ev.endsAt && <button type="button" className="btn" onClick={() => run(`${base}/extend`, { clear: true }, t('owner.saved'))}>{t('owner.time.clear')}</button>}
          </div>
        </section>
      )}

      <section aria-labelledby={`${id}-dash`} className="stack" style={{ gap: 12 }}>
        <h2 id={`${id}-dash`}>{t('dash.title')} <span className="muted">({view.groups.length})</span></h2>
        <div className="gcards">
          {view.groups.map((g) => <Card key={g.id} g={g} onAction={onAction} present={present} />)}
        </div>
      </section>

      <div className="grid2 tallies">
        <Tally title={t('dash.tally.regional')} ids={ids.regional} icon />
        <Tally title={t('dash.tally.national')} ids={ids.priorities} />
      </div>

      {!present && (
        <>
          <section className="panel stack" aria-labelledby={`${id}-codes`}>
            <h2 id={`${id}-codes`}>{t('ev.codes.title')}</h2>
            <p className="note">{t('ev.codes.help', { code: ev.code })}</p>
            {/* The workshop link and QR: teams open it, pick their team and enter their names. */}
            <CopyField id={`${id}-evlink`} label={t('ev.link.label')} value={`${window.location.origin}/join/${ev.code}`}
              qrTitle={t('ev.link.label')} qrFile={`event-${ev.code}.png`} />
            <div className="row">
              <button type="button" className="btn" onClick={() => copy(codesText)}><span aria-live="polite">{copied ? t('copy.copied') : t('ev.codes.copy')}</span></button>
              <a className="btn" href={`/staff/events/${ev.id}/print`} onClick={(e) => { e.preventDefault(); navigate(`/staff/events/${ev.id}/print`); }}>{t('ev.codes.print')}</a>
            </div>
            <div className="table-wrap">
              <table className="simple">
                <thead><tr><th>{t('dash.group')}</th><th>{t('join.code.label')}</th><th>{t('start.link.label')}</th></tr></thead>
                <tbody>{view.groups.map((g) => <tr key={g.id}><td>{g.country || g.name}</td><td className="mono">{g.teamCode}</td><td className="mono small-text">{g.joinUrl}</td></tr>)}</tbody>
              </table>
            </div>
            {ev.scope === 'single' && view.groups.length >= 1
              ? <p className="note">{t('ev.single.full')}</p>
              : (
                <form className="stack" style={{ gap: 8 }} onSubmit={(e) => {
                  e.preventDefault();
                  if (!adding.every(teamReady)) { setNotice(t('team.incomplete')); return; }
                  void run(`${base}/groups`, { teams: adding.map(teamSpec) }, t('owner.saved')).then(() => setAdding([newTeam()]));
                }}>
                  <h3>{t('ev.groups.add')}</h3>
                  <TeamRows teams={adding} onChange={setAdding} max={ev.scope === 'single' ? 1 : 60} />
                  <div><button type="submit" className="btn primary">{t('ev.groups.add')}</button></div>
                </form>
              )}
          </section>

          <section className="panel stack" aria-labelledby={`${id}-exp`}>
            <h2 id={`${id}-exp`}>{t('ev.export.title')}</h2>
            <div className="row">
              <button type="button" className="btn" onClick={() => downloadWithToken(`${base}/export.csv`, session.token, 'groups.csv')}>{t('ev.export.csv')}</button>
              <button type="button" className="btn" onClick={() => downloadWithToken(`${base}/export.json`, session.token, 'worksheets.json')}>{t('ev.export.json')}</button>
              <button type="button" className="btn" onClick={() => downloadWithToken(`${base}/edit-log.csv`, session.token, 'edit-log.csv')}>{t('ev.export.log')}</button>
            </div>
          </section>

          <section className="panel stack" aria-labelledby={`${id}-ppl`}>
            <h2 id={`${id}-ppl`}>{t('ev.people')}</h2>
            <p className="note">{t('ev.people.help')}</p>
            <div className="ws-people">
              {view.facilitator && <PersonRow p={view.facilitator} role={t('ev.people.lead')} me={session.user.id} />}
              {view.coFacilitators.map((p) => (
                <PersonRow key={p.id} p={p} role={t('ev.people.co')} me={session.user.id}
                  action={<button type="button" className="btn small" onClick={() => send('DELETE', `${base}/facilitators/${p.id}`, undefined, t('owner.saved'))}>
                    {p.id === session.user.id ? t('ev.people.leave') : t('ev.people.remove')}</button>} />
              ))}
            </div>
            <form className="row" onSubmit={(e) => { e.preventDefault(); if (coEmail.trim()) void send('POST', `${base}/facilitators`, { email: coEmail.trim() }, t('owner.saved')).then(() => setCoEmail('')); }}>
              <label className="sr-only" htmlFor={`${id}-co`}>{t('ev.people.email')}</label>
              <input id={`${id}-co`} type="email" placeholder={t('ev.people.email')} value={coEmail} onChange={(e) => setCoEmail(e.target.value)} style={{ maxWidth: 300 }} />
              <button type="submit" className="btn">{t('ev.people.add')}</button>
            </form>
            {staff.length > 0 && (
              <div className="f">
                <label className="lab" htmlFor={`${id}-own`}>{t('ev.people.reassign')}</label>
                <small>{t('ev.people.reassign.help')}</small>
                <select id={`${id}-own`} style={{ maxWidth: 320 }} value={ev.facilitatorId ?? ''}
                  onChange={(e) => { if (e.target.value) void send('PATCH', base, { facilitatorId: e.target.value }, t('owner.saved')); }}>
                  {!ev.facilitatorId && <option value="">–</option>}
                  {staff.map((u) => <option key={u.id} value={u.id}>{u.name ?? u.email}</option>)}
                </select>
              </div>
            )}
          </section>

          <section className="panel stack" aria-labelledby={`${id}-set`}>
            <h2 id={`${id}-set`}>{t('ev.settings')}</h2>
            <div className="f">
              <label className="lab" htmlFor={`${id}-con`}>{t('owner.consent.title')}</label>
              <small>{t('ev.consent.help')}</small>
              <select id={`${id}-con`} style={{ maxWidth: 360 }} defaultValue="" onChange={(e) => { if (e.target.value) void run(`${base}/consent`, { consent: e.target.value }, t('owner.saved')); }}>
                <option value="">{t('ev.consent.choose')}</option>
                <option value="identified">{t('consent.identified')}</option>
                <option value="aggregate">{t('consent.aggregate')}</option>
                <option value="private">{t('consent.private')}</option>
              </select>
            </div>
            <div><button type="button" className="btn danger" onClick={() => setConfirm({ kind: 'delete' })}>{t('ev.delete')}</button></div>
          </section>
        </>
      )}

      {editing && (
        <Modal title={t('team.edit.title', { name: editing.g.country || editing.g.name || editing.g.teamCode })} onClose={() => setEditing(null)}>
          <div className="stack" style={{ gap: 12 }}>
            <TeamRow n={1} value={editing.d} onChange={(d) => setEditing({ ...editing, d })} />
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setEditing(null)}>{t('confirm.cancel')}</button>
              <button type="button" className="btn primary" disabled={!teamReady(editing.d)} onClick={async () => {
                try { setView(await call<EventView>(`${base}/groups/${editing.g.id}`, { method: 'PATCH', body: teamSpec(editing.d) })); setNotice(t('owner.saved')); } catch { setNotice(t('error.generic')); }
                setEditing(null);
              }}>{t('acct.save')}</button>
            </div>
          </div>
        </Modal>
      )}
      {confirm?.kind === 'close' && <Confirm title={t('ev.close')} message={t('ev.close.confirm')} action={t('ev.close')} onConfirm={() => run(`${base}/close`, {}, t('owner.saved'))} onClose={() => setConfirm(null)} />}
      {confirm?.kind === 'delete' && <Confirm title={t('ev.delete')} message={t('ev.delete.confirm')} action={t('ev.delete')} danger typeToConfirm={ev.code} onConfirm={() => run(`${base}/delete`)} onClose={() => setConfirm(null)} />}
      {confirm?.kind === 'closeGroup' && <Confirm title={t('owner.close')} message={t('owner.close.confirm')} action={t('owner.close')} onConfirm={() => run(`${base}/groups/${confirm.g.id}/close`, {}, t('owner.saved'))} onClose={() => setConfirm(null)} />}
      {confirm?.kind === 'newcode' && <Confirm title={t('dash.newcode')} message={t('dash.newcode.confirm', { name: confirm.g.country || confirm.g.name || confirm.g.teamCode })} action={t('dash.newcode')} onConfirm={() => run(`${base}/groups/${confirm.g.id}/newcode`, {}, t('dash.newcode.done'))} onClose={() => setConfirm(null)} />}
      {confirm?.kind === 'remove' && <Confirm title={t('dash.remove')} message={t('dash.remove.confirm', { name: confirm.g.country || confirm.g.name || confirm.g.teamCode })} action={t('dash.remove')} danger typeToConfirm={confirm.g.teamCode} onConfirm={() => run(`${base}/groups/${confirm.g.id}/remove`, {}, t('owner.saved'))} onClose={() => setConfirm(null)} />}
    </main>
  );
}

/** One person who runs the workshop: name, email and their part in it. */
function PersonRow({ p, role, me, action }: { p: Person; role: string; me: string; action?: ReactNode }) {
  const { t } = useContent();
  return (
    <div className="person">
      <span><b>{p.name ?? p.email}</b>{p.id === me && <span className="muted"> ({t('presence.you')})</span>} <span className="note">{p.email}</span></span>
      <span className="row" style={{ gap: 8 }}><span className="pill">{role}</span>{action}</span>
    </div>
  );
}
