// Admin home: every workshop, every team, and the people who run them. Admins manage
// facilitators; only the Super Admin adds or changes admins. Insights comes later.

import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { countryName } from '../../../shared/countries';
import { Modal } from '../components/Modal';
import { fmtDateTime } from '../components/Time';
import { useContent } from '../content';
import { navigate } from '../router';
import { errText, roleLabel, type Call } from './Account';
import { WorkshopCards } from './Home';
import type { EventDto, State } from './types';
import type { Role, StaffSession, StaffUser } from './staffSession';

type Tab = 'workshops' | 'teams' | 'people';
const TABS: Tab[] = ['workshops', 'teams', 'people'];

interface TeamRow {
  id: string;
  teamCode: string;
  name: string | null;
  label: string;
  countryCode: string | null;
  useCase: string | null;
  state: State;
  eventId: string | null;
  eventName: string | null;
  progressPct: number;
  updatedAt: string;
}

function Workshops({ call }: { call: Call }) {
  const { t } = useContent();
  const id = useId();
  const [events, setEvents] = useState<EventDto[] | null>(null);
  const [who, setWho] = useState('');
  useEffect(() => { call<{ events: EventDto[] }>('/events?all=1').then((r) => setEvents(r.events)).catch(() => setEvents([])); }, [call]);
  const people = useMemo(() => [...new Map((events ?? []).filter((e) => e.facilitatorId).map((e) => [e.facilitatorId!, e.facilitatorName ?? '?'])).entries()], [events]);
  if (!events) return <p className="muted">…</p>;
  const shown = who ? events.filter((e) => e.facilitatorId === who) : events;
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row admin-filters">
        <label className="lab" htmlFor={`${id}-who`}>{t('admin.filter.facilitator')}</label>
        <select id={`${id}-who`} value={who} onChange={(e) => setWho(e.target.value)} style={{ maxWidth: 260 }}>
          <option value="">{t('admin.filter.everyone')}</option>
          {people.map(([pid, name]) => <option key={pid} value={pid}>{name}</option>)}
        </select>
        <span className="note">{t('admin.count.workshops', { n: String(shown.length) })}</span>
      </div>
      {shown.length ? <WorkshopCards events={shown} showOwner /> : <p className="muted">{t('admin.none')}</p>}
    </div>
  );
}

function Teams({ call }: { call: Call }) {
  const { t, item } = useContent();
  const id = useId();
  const [rows, setRows] = useState<TeamRow[] | null>(null);
  const [q, setQ] = useState('');
  const [country, setCountry] = useState('');
  const [state, setState] = useState('');
  useEffect(() => { call<{ groups: TeamRow[] }>('/admin/groups').then((r) => setRows(r.groups)).catch(() => setRows([])); }, [call]);
  const countries = useMemo(() => [...new Set((rows ?? []).map((r) => r.countryCode).filter((c): c is string => !!c))]
    .sort((a, b) => countryName(a).localeCompare(countryName(b))), [rows]);
  if (!rows) return <p className="muted">…</p>;
  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) => (!country || (country === '-' ? !r.countryCode : r.countryCode === country))
    && (!state || r.state === state)
    && (!needle || [r.label, r.name, r.teamCode, r.eventName].some((s) => s?.toLowerCase().includes(needle))));
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row admin-filters">
        <label className="sr-only" htmlFor={`${id}-q`}>{t('teams.search')}</label>
        <input id={`${id}-q`} type="search" placeholder={t('teams.search')} value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 240 }} />
        <label className="sr-only" htmlFor={`${id}-c`}>{t('teams.country')}</label>
        <select id={`${id}-c`} value={country} onChange={(e) => setCountry(e.target.value)} style={{ maxWidth: 220 }}>
          <option value="">{t('teams.country.all')}</option>
          {countries.map((c) => <option key={c} value={c}>{countryName(c)}</option>)}
          <option value="-">{t('teams.country.none')}</option>
        </select>
        <label className="sr-only" htmlFor={`${id}-s`}>{t('teams.state')}</label>
        <select id={`${id}-s`} value={state} onChange={(e) => setState(e.target.value)} style={{ maxWidth: 180 }}>
          <option value="">{t('teams.state.all')}</option>
          {(['open', 'draft', 'closed'] as const).map((s) => <option key={s} value={s}>{t(`state.${s}`)}</option>)}
        </select>
        <span className="note">{t('teams.count', { n: String(shown.length) })}</span>
      </div>
      <div className="table-wrap panel" style={{ padding: 0 }}>
        <table className="simple admin-table">
          <thead><tr>
            <th>{t('teams.col.team')}</th><th>{t('join.code.label')}</th><th>{t('teams.col.workshop')}</th><th>{t('teams.col.usecase')}</th>
            <th>{t('teams.col.progress')}</th><th>{t('teams.state')}</th><th>{t('teams.col.updated')}</th><th />
          </tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td><b>{r.label}</b>{r.name && r.name !== r.label && <div className="note">{r.name}</div>}</td>
                <td className="mono">{r.teamCode}</td>
                <td>{r.eventName ?? <span className="muted">{t('teams.noworkshop')}</span>}</td>
                <td>{r.useCase ? item(r.useCase)?.label ?? r.useCase : <span className="muted">–</span>}</td>
                <td>{r.progressPct}%</td>
                <td><span className={`pill state-${r.state}`}>{t(`state.${r.state}` as 'state.open')}</span></td>
                <td className="small-text">{fmtDateTime(r.updatedAt)}</td>
                <td><button type="button" className="btn small" onClick={() => navigate(`/staff/admin/view/${r.id}`)}>{t('dash.view')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && <p className="muted" style={{ padding: 16 }}>{t('teams.none')}</p>}
      </div>
    </div>
  );
}

/** Roles this person may give: the Super Admin any, an admin only Facilitator. */
const givable = (me: Role): Role[] => (me === 'super_admin' ? ['facilitator', 'admin', 'super_admin'] : ['facilitator']);

function People({ call, me }: { call: Call; me: StaffUser }) {
  const { t } = useContent();
  const id = useId();
  const [users, setUsers] = useState<StaffUser[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ email: '', name: '', role: 'facilitator' as Role, password: '' });
  const [edit, setEdit] = useState<StaffUser | null>(null);
  const [editRole, setEditRole] = useState<Role>('facilitator');
  const [newPw, setNewPw] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => setUsers((await call<{ users: StaffUser[] }>('/admin/users')).users), [call]);
  useEffect(() => { void load(); }, [load]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null); setErr(null);
    try {
      await call('/admin/users', { method: 'POST', body: form });
      setForm({ email: '', name: '', role: 'facilitator', password: '' });
      setAdding(false);
      setMsg(t('acct.added'));
      await load();
    } catch (x) { setErr(errText(x, t('error.generic'))); }
  };
  const patch = async (u: StaffUser, body: object) => {
    setMsg(null); setErr(null);
    try { await call(`/admin/users/${u.id}`, { method: 'PATCH', body }); setMsg(t('acct.saved')); setEdit(null); await load(); }
    catch (x) { setErr(errText(x, t('error.generic'))); }
  };
  const canEdit = (u: StaffUser) => u.id !== me.id && (me.role === 'super_admin' || u.role === 'facilitator');
  const status = (u: StaffUser) => (u.status !== 'active' ? 'inactive' : u.mustChangePassword ? 'mustchange' : 'active');

  if (!users) return <p className="muted">…</p>;
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="note">{t('admin.count.people', { n: String(users.length) })}</span>
        {!adding && <button type="button" className="btn primary" onClick={() => { setAdding(true); setMsg(null); }}>+ {t('acct.add')}</button>}
      </div>
      {msg && <p className="banner" role="status">{msg}</p>}
      {err && !edit && <p className="err" role="alert">{err}</p>}
      {adding && (
        <form className="panel stack" onSubmit={add} style={{ gap: 10 }} aria-labelledby={`${id}-add`}>
          <h3 id={`${id}-add`}>{t('acct.add')}</h3>
          <div className="grid2">
            <div className="f"><label className="lab" htmlFor={`${id}-n`}>{t('staff.name')}</label><input id={`${id}-n`} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="f"><label className="lab" htmlFor={`${id}-e`}>{t('staff.email')}</label><input id={`${id}-e`} type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="f"><label className="lab" htmlFor={`${id}-r`}>{t('acct.role')}</label>
              <select id={`${id}-r`} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                {givable(me.role).map((r) => <option key={r} value={r}>{roleLabel(t, r)}</option>)}
              </select>
            </div>
            <div className="f"><label className="lab" htmlFor={`${id}-p`}>{t('acct.startpw')}</label><small>{t('acct.startpw.help')}</small><input id={`${id}-p`} type="text" required autoComplete="off" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
          </div>
          <div className="row">
            <button type="submit" className="btn primary">{t('acct.add')}</button>
            <button type="button" className="btn" onClick={() => setAdding(false)}>{t('confirm.cancel')}</button>
          </div>
        </form>
      )}
      <div className="table-wrap panel" style={{ padding: 0 }}>
        <table className="simple admin-table">
          <thead><tr><th>{t('staff.name')}</th><th>{t('staff.email')}</th><th>{t('acct.role')}</th><th>{t('acct.status')}</th><th>{t('admin.tab.workshops')}</th><th /></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}{u.id === me.id && <span className="muted"> ({t('presence.you')})</span>}</td>
                <td>{u.email}</td>
                <td>{roleLabel(t, u.role)}</td>
                <td><span className={`pill acct-${status(u)}`}>{t(`acct.status.${status(u)}` as 'acct.status.active')}</span></td>
                <td>{u.workshops ?? 0}</td>
                <td>{canEdit(u) && <button type="button" className="btn small" onClick={() => { setEdit(u); setEditRole(u.role); setNewPw(''); setErr(null); }}>{t('acct.edit')}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">{t(me.role === 'super_admin' ? 'acct.rules.super' : 'acct.rules.admin')}</p>
      {edit && (
        <Modal title={t('acct.edit.title', { name: edit.name ?? edit.email })} onClose={() => setEdit(null)}>
          <div className="stack" style={{ gap: 14 }}>
            {me.role === 'super_admin' && (
              <div className="f">
                <label className="lab" htmlFor={`${id}-er`}>{t('acct.role')}</label>
                <div className="row">
                  <select id={`${id}-er`} value={editRole} onChange={(e) => setEditRole(e.target.value as Role)} style={{ maxWidth: 220 }}>
                    {givable(me.role).map((r) => <option key={r} value={r}>{roleLabel(t, r)}</option>)}
                  </select>
                  <button type="button" className="btn" disabled={editRole === edit.role} onClick={() => patch(edit, { role: editRole })}>{t('acct.save')}</button>
                </div>
              </div>
            )}
            <div className="f">
              <label className="lab" htmlFor={`${id}-np`}>{t('acct.reset')}</label>
              <small>{t('acct.reset.help')}</small>
              <div className="row">
                <input id={`${id}-np`} type="text" autoComplete="off" value={newPw} onChange={(e) => setNewPw(e.target.value)} style={{ maxWidth: 260 }} />
                <button type="button" className="btn" disabled={!newPw} onClick={() => patch(edit, { password: newPw })}>{t('acct.reset')}</button>
              </div>
            </div>
            <div>
              {edit.status === 'active'
                ? <button type="button" className="btn danger" onClick={() => patch(edit, { status: 'inactive' })}>{t('acct.deactivate')}</button>
                : <button type="button" className="btn" onClick={() => patch(edit, { status: 'active' })}>{t('acct.activate')}</button>}
            </div>
            {err && <p className="err" role="alert">{err}</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}

export function AdminHome({ session, call }: { session: StaffSession; call: Call }) {
  const { t } = useContent();
  const initial = new URLSearchParams(window.location.search).get('tab') as Tab | null;
  const [tab, setTab] = useState<Tab>(initial && TABS.includes(initial) ? initial : 'workshops');
  const choose = (x: Tab) => { setTab(x); history.replaceState(null, '', x === 'workshops' ? '/staff' : `/staff?tab=${x}`); };
  return (
    <main className="wrap stack">
      <div className="head">
        <div>
          <p className="eyebrow">{t('staff.signedin', { name: session.user.name ?? session.user.email })}</p>
          <h1 className="h-page">{t('admin.title')}</h1>
        </div>
        <button type="button" className="btn" onClick={() => navigate('/staff/workshops')}>{t('menu.workshops')}</button>
      </div>
      <div className="tabs" role="tablist" aria-label={t('admin.title')}>
        {TABS.map((x) => (
          <button key={x} type="button" role="tab" aria-selected={tab === x} className={`tab${tab === x ? ' on' : ''}`} onClick={() => choose(x)}>{t(`admin.tab.${x}`)}</button>
        ))}
        <span className="tab soon" aria-disabled="true" title={t('admin.soon')}>{t('admin.tab.insights')} <small>({t('admin.soon')})</small></span>
      </div>
      <div role="tabpanel">
        {tab === 'workshops' && <Workshops call={call} />}
        {tab === 'teams' && <Teams call={call} />}
        {tab === 'people' && <People call={call} me={session.user} />}
      </div>
    </main>
  );
}
