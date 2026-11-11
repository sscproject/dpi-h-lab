// My workshops: the sessions this person runs or co-facilitates, and setting up a new one.
// A session is a dated workshop or an open session, with one team or several. Each team
// represents a country, or has any team name (e.g. regional experts). Only facilitators add
// teams; teams join with the workshop code (and pick their team) or their own team code.

import { useEffect, useId, useState, type FormEvent } from 'react';
import { COUNTRIES, countryName } from '../../../shared/countries';
import { fmtDateTime, fromLocalInput } from '../components/Time';
import { useContent } from '../content';
import { navigate } from '../router';
import { errText, type Call } from './Account';
import type { EventDto, GroupCard } from './types';
import type { StaffSession } from './staffSession';

export function CountryPick({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const { t } = useContent();
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{t('f.country.choose')}</option>
      {COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
    </select>
  );
}

/** A team being set up: represents a country (and maybe has a team name), or just a team name. */
export interface TeamDraft { rep: boolean; countryCode: string; name: string }
export const newTeam = (): TeamDraft => ({ rep: true, countryCode: '', name: '' });
export const teamReady = (d: TeamDraft) => (d.rep ? !!d.countryCode : !!d.name.trim());
export const teamSpec = (d: TeamDraft) => (d.rep
  ? { countryCode: d.countryCode, name: d.name.trim() || null }
  : { countryCode: null, name: d.name.trim() });
/** A team card back into a draft, for editing. */
export const draftOf = (g: GroupCard): TeamDraft => (g.countryCode
  ? { rep: true, countryCode: g.countryCode, name: g.name && g.name !== countryName(g.countryCode) ? g.name : '' }
  : { rep: false, countryCode: '', name: g.name ?? '' });

/** One team: "This team represents a country" → country (and an optional team name), else a team name. */
export function TeamRow({ value, onChange, onRemove, n }: { value: TeamDraft; onChange: (d: TeamDraft) => void; onRemove?: () => void; n: number }) {
  const { t } = useContent();
  const id = useId();
  return (
    <div className="team-row">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <label className="checkline" htmlFor={`${id}-rep`}>
          <input id={`${id}-rep`} type="checkbox" checked={value.rep} onChange={(e) => onChange({ ...value, rep: e.target.checked })} />
          <span>{t('team.rep')}</span>
        </label>
        {onRemove && <button type="button" className="btn link" onClick={onRemove} aria-label={t('team.remove.label', { n: String(n) })}>{t('team.remove')}</button>}
      </div>
      <div className="grid2">
        {value.rep && (
          <div className="f">
            <label className="lab" htmlFor={`${id}-c`}>{t('f.country.code')}</label>
            <CountryPick id={`${id}-c`} value={value.countryCode} onChange={(v) => onChange({ ...value, countryCode: v })} />
          </div>
        )}
        <div className="f">
          <label className="lab" htmlFor={`${id}-n`}>{t(value.rep ? 'team.name.optional' : 'team.name.required')}</label>
          <input id={`${id}-n`} maxLength={80} value={value.name} placeholder={t(value.rep ? 'team.name.placeholder.country' : 'team.name.placeholder')}
            onChange={(e) => onChange({ ...value, name: e.target.value })} />
        </div>
      </div>
    </div>
  );
}

/** Several team rows, with "Add another team" (up to `max`). */
export function TeamRows({ teams, onChange, max = 60 }: { teams: TeamDraft[]; onChange: (t: TeamDraft[]) => void; max?: number }) {
  const { t } = useContent();
  return (
    <div className="stack" style={{ gap: 10 }}>
      {teams.map((d, i) => (
        <TeamRow key={i} n={i + 1} value={d} onChange={(x) => onChange(teams.map((y, j) => (j === i ? x : y)))}
          onRemove={teams.length > 1 ? () => onChange(teams.filter((_, j) => j !== i)) : undefined} />
      ))}
      {teams.length < max && <div><button type="button" className="btn small" onClick={() => onChange([...teams, newTeam()])}>+ {t('team.add.another')}</button></div>}
    </div>
  );
}

function CreateSession({ call, onCreated, onCancel }: { call: Call; onCreated: (id: string) => void; onCancel: () => void }) {
  const { t } = useContent();
  const id = useId();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'workshop' | 'open'>('workshop');
  const [scope, setScope] = useState<'single' | 'multi'>('multi');
  const [location, setLocation] = useState('');
  const [starts, setStarts] = useState('');
  const [ends, setEnds] = useState('');
  const [teams, setTeams] = useState<TeamDraft[]>([newTeam()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const chooseScope = (s: 'single' | 'multi') => { setScope(s); if (s === 'single') setTeams((x) => x.slice(0, 1)); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!teams.every(teamReady)) { setError(t('team.incomplete')); return; }
    setBusy(true);
    try {
      const r = await call<{ event: EventDto }>('/events', {
        method: 'POST',
        body: {
          name, kind, scope, location: location || null,
          startsAt: kind === 'workshop' ? fromLocalInput(starts) : null,
          endsAt: kind === 'workshop' ? fromLocalInput(ends) : null,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          teams: teams.map(teamSpec),
        },
      });
      onCreated(r.event.id);
    } catch (err) {
      setError(errText(err, t('error.generic')));
    }
    setBusy(false);
  };

  const radios = <V extends string>(name: string, value: V, set: (v: V) => void, options: [V, string, string][]) => (
    <div className="choice-row" role="radiogroup">
      {options.map(([v, label, help]) => (
        <label key={v} className={`choice${value === v ? ' on' : ''}`}>
          <input type="radio" name={`${id}-${name}`} checked={value === v} onChange={() => set(v)} />
          <span><b>{label}</b><br /><span className="note">{help}</span></span>
        </label>
      ))}
    </div>
  );

  return (
    <form className="panel stack" onSubmit={submit} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>{t('ev.create.title')}</h2>
      <div className="f"><label className="lab" htmlFor={`${id}-n`}>{t('ev.name')}</label><input id={`${id}-n`} required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('ev.name.placeholder')} /></div>
      <div className="f">
        <span className="lab">{t('ev.kind')}</span>
        {radios('kind', kind, setKind, [['workshop', t('ev.kind.workshop'), t('ev.kind.workshop.help')], ['open', t('ev.kind.open'), t('ev.kind.open.help')]])}
      </div>
      {kind === 'workshop' && (
        <div className="grid2">
          <div className="f"><label className="lab" htmlFor={`${id}-s`}>{t('ev.starts')}</label><small>{t('ev.starts.help')}</small><input id={`${id}-s`} type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} /></div>
          <div className="f"><label className="lab" htmlFor={`${id}-e`}>{t('ev.ends')}</label><small>{t('ev.ends.help')}</small><input id={`${id}-e`} type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} /></div>
          <div className="f"><label className="lab" htmlFor={`${id}-l`}>{t('ev.location')}</label><input id={`${id}-l`} maxLength={120} value={location} onChange={(e) => setLocation(e.target.value)} /></div>
        </div>
      )}
      <div className="f">
        <span className="lab">{t('ev.scope')}</span>
        {radios('scope', scope, chooseScope, [['single', t('ev.scope.single'), t('ev.scope.single.help')], ['multi', t('ev.scope.multi'), t('ev.scope.multi.help')]])}
      </div>
      <div className="f">
        <span className="lab">{t(scope === 'single' ? 'ev.team' : 'ev.groups')}</span>
        <TeamRows teams={teams} onChange={setTeams} max={scope === 'single' ? 1 : 60} />
      </div>
      <div className="row">
        <button className="btn primary" type="submit" disabled={busy}>{t('ev.create.submit')}</button>
        <button className="btn" type="button" onClick={onCancel}>{t('confirm.cancel')}</button>
      </div>
      {error && <p className="err" role="alert">{error}</p>}
    </form>
  );
}

/** Session cards; `showOwner` adds who runs each one (admin list, co-facilitated ones). */
export function WorkshopCards({ events, showOwner, meId }: { events: EventDto[]; showOwner?: boolean; meId?: string }) {
  const { t } = useContent();
  return (
    <div className="ev-list">
      {events.map((e) => (
        <a key={e.id} className="ev-card" href={`/staff/events/${e.id}`} onClick={(ev) => { ev.preventDefault(); navigate(`/staff/events/${e.id}`); }}>
          <span className="row" style={{ justifyContent: 'space-between' }}>
            <b>{e.name}</b>
            <span className={`pill state-${e.state}`}>{t(`state.${e.state}` as 'state.open')}</span>
          </span>
          <span className="mono muted">{e.code}</span>
          <span className="note">
            {t(e.kind === 'open' ? 'ev.kind.open' : 'ev.kind.workshop')} · {t('ev.groupcount', { n: String(e.groupCount ?? 0) })}
            {e.kind === 'workshop' && e.startsAt && ` · ${fmtDateTime(e.startsAt)}`}
          </span>
          {(showOwner || (meId && e.facilitatorId !== meId)) && e.facilitatorName && <span className="note">{t('ws.runby', { name: e.facilitatorName })}</span>}
        </a>
      ))}
    </div>
  );
}

export function MyWorkshops({ session, call }: { session: StaffSession; call: Call }) {
  const { t } = useContent();
  const [events, setEvents] = useState<EventDto[] | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    call<{ events: EventDto[] }>('/events').then((r) => setEvents(r.events)).catch(() => setEvents([]));
  }, [call]);

  return (
    <main className="wrap stack">
      <div className="head">
        <div>
          <p className="eyebrow">{t('staff.signedin', { name: session.user.name ?? session.user.email })}</p>
          <h1 className="h-page">{t('ws.title')}</h1>
        </div>
        {!creating && <button type="button" className="btn primary" onClick={() => setCreating(true)}>+ {t('ws.new')}</button>}
      </div>
      {creating && <CreateSession call={call} onCreated={(id) => navigate(`/staff/events/${id}`)} onCancel={() => setCreating(false)} />}
      {events === null ? <p className="muted">…</p>
        : events.length === 0 ? (!creating && <p className="muted">{t('ws.empty')}</p>)
        : <WorkshopCards events={events} meId={session.user.id} />}
    </main>
  );
}
