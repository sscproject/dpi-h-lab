// Device-local state: the current group session, last team code (FR-J5), display name (FR-J3),
// current step and theme. Every access is guarded: storage can be blocked or unavailable.

export type Theme = 'light' | 'dark' | 'system';

export interface Session {
  teamCode: string;
  groupId: string;
  token: string;
  contentVersion: string | null;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the app still works for this page load */
  }
}

export const store = {
  session: () => read<Session>('dpih.session'),
  setSession: (s: Session | null) => write('dpih.session', s),
  lastCode: () => read<string>('dpih.lastCode'),
  setLastCode: (c: string) => write('dpih.lastCode', c),
  displayName: () => read<string>('dpih.displayName') ?? '',
  setDisplayName: (n: string) => write('dpih.displayName', n || null),
  step: (groupId: string) => read<number>(`dpih.step.${groupId}`) ?? 0,
  setStep: (groupId: string, n: number) => write(`dpih.step.${groupId}`, n),
  /** Light (white background) unless this device chose otherwise. */
  theme: (): Theme => read<Theme>('dpih.theme') ?? 'light',
  setTheme: (t: Theme) => write('dpih.theme', t),
};

/** Stable per-tab client id, sent with patches for the edit log. */
export const clientId = (() => {
  try {
    const existing = sessionStorage.getItem('dpih.clientId');
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem('dpih.clientId', id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
})();

export function applyTheme(theme: Theme) {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}
