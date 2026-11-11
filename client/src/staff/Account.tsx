// The signed-in person's account: the name menu in the header (My workshops, Admin, Change
// password, Sign out), the change-password dialog, and the screen that asks someone whose
// password was set by an admin to choose their own before anything else.

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '../api';
import { Modal } from '../components/Modal';
import { useContent } from '../content';
import { navigate } from '../router';
import { isAdmin, type StaffSession, type StaffUser } from './staffSession';

export type Call = <T>(path: string, opts?: { method?: string; body?: unknown }) => Promise<T>;

export const errText = (e: unknown, fallback: string) => (e instanceof ApiError && e.status !== 0 && e.status < 500 ? e.message : fallback);

export const roleLabel = (t: ReturnType<typeof useContent>['t'], role: StaffUser['role']) => t(`acct.role.${role}` as 'acct.role.admin');

/** "Ana · Facilitator ▾": where to go, change password, sign out. */
export function StaffMenu({ session, onSignOut, onPassword }: { session: StaffSession; onSignOut: () => void; onPassword: () => void }) {
  const { t } = useContent();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const u = session.user;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);

  const go = (path: string) => { setOpen(false); navigate(path); };
  return (
    <div className="staff-menu" ref={ref}>
      <button type="button" className="btn small" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen(!open)}>
        <span className="staff-menu-name">{u.name ?? u.email}</span>
        <span className="staff-menu-role"> · {roleLabel(t, u.role)}</span> <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div id={menuId} className="staff-menu-list" role="menu">
          {!u.mustChangePassword && <button type="button" role="menuitem" onClick={() => go('/staff/workshops')}>{t('menu.workshops')}</button>}
          {!u.mustChangePassword && isAdmin(u.role) && <button type="button" role="menuitem" onClick={() => go('/staff')}>{t('menu.admin')}</button>}
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onPassword(); }}>{t('staff.changepw')}</button>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onSignOut(); navigate('/'); }}>{t('staff.signout')}</button>
        </div>
      )}
    </div>
  );
}

function PasswordForm({ call, onDone }: { call: Call; onDone: (s: StaffSession) => void }) {
  const { t } = useContent();
  const id = useId();
  const [current, setCurrent] = useState('');
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (pw !== confirm) { setMsg(t('staff.password.mismatch')); return; }
    setBusy(true);
    try {
      const r = await call<StaffSession>('/auth/password', { method: 'POST', body: { current, password: pw } });
      setCurrent(''); setPw(''); setConfirm('');
      onDone(r);
    } catch (err) { setMsg(errText(err, t('error.generic'))); }
    setBusy(false);
  };
  return (
    <form className="stack" style={{ gap: 12 }} onSubmit={submit}>
      <div className="f"><label className="lab" htmlFor={`${id}-c`}>{t('staff.password.current')}</label><input id={`${id}-c`} type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} /></div>
      <div className="f"><label className="lab" htmlFor={`${id}-n`}>{t('staff.password.new')}</label><small id={`${id}-nh`}>{t('staff.password.help')}</small><input id={`${id}-n`} type="password" autoComplete="new-password" required aria-describedby={`${id}-nh`} value={pw} onChange={(e) => setPw(e.target.value)} /></div>
      <div className="f"><label className="lab" htmlFor={`${id}-k`}>{t('staff.password.confirm')}</label><input id={`${id}-k`} type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
      <div><button type="submit" className="btn primary" disabled={busy}>{t('staff.changepw')}</button></div>
      {msg && <p className="err" role="alert">{msg}</p>}
    </form>
  );
}

export function ChangePassword({ call, onClose, onChanged }: { call: Call; onClose: () => void; onChanged: (s: StaffSession) => void }) {
  const { t } = useContent();
  const [done, setDone] = useState(false);
  return (
    <Modal title={t('staff.changepw')} onClose={onClose}>
      {done ? <p role="status">{t('acct.saved')}</p> : <PasswordForm call={call} onDone={(s) => { onChanged(s); setDone(true); }} />}
    </Modal>
  );
}

/** First sign-in with a password an admin chose: nothing else opens until they choose their own. */
export function ForcePassword({ call, onChanged }: { call: Call; onChanged: (s: StaffSession) => void }) {
  const { t } = useContent();
  return (
    <main className="wrap">
      <section className="panel stack narrow-panel" aria-labelledby="force-pw-h">
        <div>
          <h1 id="force-pw-h" className="h-page">{t('pw.force.title')}</h1>
          <p className="muted">{t('pw.force.help')}</p>
        </div>
        <PasswordForm call={call} onDone={onChanged} />
      </section>
    </main>
  );
}
