// Staff sign-in with an in-app password; on a fresh install, create the first admin account
// using the one-time setup code printed in the server log.

import { useEffect, useId, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import { useContent } from '../content';
import type { StaffSession } from './staffSession';

function Field({ label, help, ...input }: { label: string; help?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="f">
      <label className="lab" htmlFor={id}>{label}</label>
      {help && <small id={`${id}-h`}>{help}</small>}
      <input id={id} aria-describedby={help ? `${id}-h` : undefined} {...input} />
    </div>
  );
}

export function SignIn({ onSignedIn }: { onSignedIn: (s: StaffSession) => void }) {
  const { t } = useContent();
  const [setupNeeded, setSetupNeeded] = useState<boolean | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ setupNeeded: boolean }>('/auth/status').then((r) => setSetupNeeded(r.setupNeeded)).catch(() => setSetupNeeded(false));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (setupNeeded && password !== confirm) { setError(t('staff.password.mismatch')); return; }
    setBusy(true);
    try {
      const r = setupNeeded
        ? await api<StaffSession>('/auth/setup', { method: 'POST', body: { setupCode: code, email, name, password } })
        : await api<StaffSession>('/auth/login', { method: 'POST', body: { email, password } });
      onSignedIn(r);
    } catch (err) {
      setError(err instanceof ApiError && err.status !== 0 && err.status < 500 ? err.message : t('error.generic'));
    }
    setBusy(false);
  };

  if (setupNeeded === null) return <main className="wrap" aria-busy="true"><p className="muted">…</p></main>;

  return (
    <main className="wrap">
      <form className="panel stack narrow-panel" onSubmit={submit} aria-labelledby="signin-h">
        <div>
          <h1 id="signin-h" className="h-page">{setupNeeded ? t('staff.setup.title') : t('signin.title')}</h1>
          <p className="muted">{setupNeeded ? t('staff.setup.help') : t('staff.signin.help')}</p>
        </div>
        {setupNeeded && <Field label={t('staff.setup.code')} help={t('staff.setup.code.help')} value={code} onChange={(e) => setCode(e.target.value)} required autoComplete="off" className="mono" />}
        {setupNeeded && <Field label={t('staff.name')} value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />}
        <Field label={t('staff.email')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
        <Field label={t('staff.password')} help={setupNeeded ? t('staff.password.help') : undefined} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete={setupNeeded ? 'new-password' : 'current-password'} />
        {setupNeeded && <Field label={t('staff.password.confirm')} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />}
        <button className="btn primary" type="submit" disabled={busy}>{setupNeeded ? t('staff.setup.submit') : t('staff.signin.submit')}</button>
        {error && <p className="err" role="alert">{error}</p>}
      </form>
    </main>
  );
}
