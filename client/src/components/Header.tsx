// Sticky header (SPEC §15). One compact row on phones: app mark, team code, save status and
// Glossary. "Leave group" and the theme picker sit in the header on wide screens and in the
// page footer on narrow ones, so the sticky area stays small and the worksheet gets the room.

import { useState, type ReactNode } from 'react';
import { useContent } from '../content';
import { navigate } from '../router';
import { applyTheme, store, type Theme } from '../session';
import { GlossaryDrawer } from './Glossary';

function ThemeSelect({ id }: { id: string }) {
  const { t } = useContent();
  const [theme, setTheme] = useState<Theme>(store.theme());
  return (
    <>
      <label className="sr-only" htmlFor={id}>{t('header.theme')}</label>
      <select
        id={id}
        className="theme-select"
        value={theme}
        onChange={(e) => {
          const v = e.target.value as Theme;
          setTheme(v);
          store.setTheme(v);
          applyTheme(v);
        }}
      >
        <option value="light">{t('theme.light')}</option>
        <option value="dark">{t('theme.dark')}</option>
        <option value="system">{t('theme.system')}</option>
      </select>
    </>
  );
}

/** Secondary actions: in the header on wide screens, in the footer on phones. */
function Extras({ idSuffix, onLeave, leaveLabel }: { idSuffix: string; onLeave?: () => void; leaveLabel?: string }) {
  const { t } = useContent();
  return (
    <>
      {onLeave && <button type="button" className="btn small" onClick={onLeave}>{leaveLabel ?? t('header.leave')}</button>}
      <ThemeSelect id={`theme-${idSuffix}`} />
    </>
  );
}

/**
 * Where the DPI-H Lab logo goes: the start of what you're in. Staff pages and signed-in staff
 * go to their home (Admin or My workshops); a team member goes to their team's worksheet;
 * anyone else to the home page.
 */
export function homePath(): string {
  const staffSignedIn = (() => { try { return !!localStorage.getItem('dpih.staff'); } catch { return false; } })();
  if (location.pathname.startsWith('/staff') || staffSignedIn) return '/staff';
  const team = store.session();
  return team ? `/g/${team.teamCode}` : '/';
}

export function Header({ status, onLeave, leaveLabel, below, signIn, onHome }: {
  status?: ReactNode; onLeave?: () => void; leaveLabel?: string; below?: ReactNode;
  /** Home page only: sign-in in the top bar. */ signIn?: boolean;
  /** What the logo does here, when not the usual (e.g. the worksheet goes back to its first step). */ onHome?: () => void;
}) {
  const { t } = useContent();
  const [glossary, setGlossary] = useState(false);
  return (
    <header className="top">
      <div className="wrap topbar">
        <button type="button" className="brand" onClick={() => (onHome ? onHome() : navigate(homePath()))} aria-label={t('app.name')}>
          <span className="mark" aria-hidden="true"><i /><i /><i /><i /></span>
          <span className="brand-name" aria-hidden="true">{t('app.name')}</span>
        </button>
        <span className="spacer" />
        {status}
        {signIn && (
          <a className="btn small" href="/staff" onClick={(e) => { e.preventDefault(); navigate('/staff'); }}>
            <span className="signin-long">{t('header.signin')}</span><span className="signin-short" aria-hidden="true">{t('header.signin.short')}</span>
          </a>
        )}
        <button type="button" className="btn small" onClick={() => setGlossary(true)} aria-haspopup="dialog">{t('header.glossary')}</button>
        <span className="wide-only row" style={{ gap: 10 }}><Extras idSuffix="h" onLeave={onLeave} leaveLabel={leaveLabel} /></span>
      </div>
      {below}
      {glossary && <GlossaryDrawer onClose={() => setGlossary(false)} />}
    </header>
  );
}

/** Footer on every page: phone-only controls, and the WHO RA draft attribution (NOTICE). */
export function Footer({ onLeave, leaveLabel, children }: { onLeave?: () => void; leaveLabel?: string; children?: ReactNode }) {
  const { t } = useContent();
  return (
    <footer className="wrap site-footer">
      <div className="narrow-only footbar">{children}<Extras idSuffix="f" onLeave={onLeave} leaveLabel={leaveLabel} /></div>
      {/* One paragraph: the credit and the RA disclaimer read as a single statement. */}
      <p>{t('footer.credit')} {t('footer.ra')}</p>
    </footer>
  );
}
