// Staff session on this device: the token from signing in with an in-app password.

import { useCallback, useState } from 'react';
import { api, ApiError } from '../api';

export interface StaffUser {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  status: 'active' | 'inactive';
  lastLoginAt: string | null;
  /** Their password was set by an admin: they choose their own before anything else. */
  mustChangePassword: boolean;
  /** Admin people list only: how many workshops they run. */
  workshops?: number | null;
}

export type Role = 'super_admin' | 'admin' | 'facilitator';
export const isAdmin = (r: Role) => r === 'admin' || r === 'super_admin';

export interface StaffSession {
  token: string;
  user: StaffUser;
}

const KEY = 'dpih.staff';

function read(): StaffSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as StaffSession) : null;
  } catch {
    return null;
  }
}

function write(s: StaffSession | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: session lasts for this page only */
  }
}

export function useStaffSession() {
  const [session, setSession] = useState<StaffSession | null>(read);
  const signIn = useCallback((s: StaffSession) => { write(s); setSession(s); }, []);
  const signOut = useCallback(() => { write(null); setSession(null); }, []);
  return { session, signIn, signOut };
}

/** Calls the staff API; a 401 signs the person out so they see the sign-in form again. */
export function staffApi(session: StaffSession, onExpired: () => void) {
  return async <T,>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> => {
    try {
      return await api<T>(path, { ...opts, token: session.token });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onExpired();
      throw e;
    }
  };
}

/** Downloads a file that needs the staff token (CSV, JSON exports). */
export async function downloadWithToken(path: string, token: string, fallbackName: string) {
  const res = await fetch(`/api/v1${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new ApiError(res.status, 'download', res.statusText);
  const name = /filename\*=UTF-8''([^;]+)/.exec(res.headers.get('content-disposition') ?? '')?.[1];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await res.blob());
  a.download = name ? decodeURIComponent(name) : fallbackName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
