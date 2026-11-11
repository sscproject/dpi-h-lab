// Worksheet state for one group:
//  - autosave, debounced for text (FR-R1), with per-field versions for the server's merge (FR-R3)
//  - live updates from the group's event stream (FR-R2), with a 3-second polling fallback
//  - presence: who is here and which step they are on (FR-J4)
//  - an offline queue kept on the device and replayed on reconnect (FR-R4)
//  - "Updated by …" notices instead of overwriting a field someone is typing in (FR-R3)

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { FieldValue, Worksheet } from '../../../shared/worksheet';
import { api, ApiError, type GroupSummary } from '../api';
import { useContent } from '../content';
import { clientId, store } from '../session';
import { collapse, loadQueue, saveQueue } from './queue';
import { openStream } from './stream';

export type SaveStatus = 'saved' | 'saving' | 'offline' | 'readonly' | 'error';

export interface Person {
  clientId: string;
  name: string | null;
  guestNo: number;
  step: number;
}

export interface Author {
  name: string | null;
  guestNo: number | null;
}

export interface RemoteNotice {
  by: Author;
  value: FieldValue | null;
}

interface WorksheetResponse {
  group: GroupSummary;
  readOnly: boolean;
  worksheet: Worksheet;
  versions: Record<string, number>;
  idleCloseAt: string | null;
  /** Fields withheld from team-code readers once the group has closed (personal names). */
  hiddenPaths?: string[];
  /** The team's latest Submit, if any. */
  submission?: Submission | null;
}

/** A Submit from the Summary step: when, who, and whether they consented to share. */
export interface Submission { at: string; by: string | null; share: boolean }

interface PatchEvent {
  ops: { path: string; value: FieldValue | null; version: number }[];
  clientId: string | null;
  by: Author;
}

export interface WsApi {
  group: GroupSummary;
  values: Worksheet;
  readOnly: boolean;
  status: SaveStatus;
  live: boolean;
  /** End time, kept live when the owner or facilitator extends (FR-T2). */
  endsAt: string | null;
  /** When the group will close for lack of use (SPEC §4.4 X1). */
  idleCloseAt: string | null;
  /** Fields the server withheld (personal names after closing). */
  hiddenPaths: string[];
  /** True for a facilitator's read-only view (FR-F9). */
  viewOnly: boolean;
  people: Person[];
  notices: Record<string, RemoteNotice>;
  set(path: string, value: FieldValue | null, debounceMs?: number): void;
  flushNow(): void;
  startEditing(path: string): void;
  /** Leaving a field. With autoResolve, an untouched field takes the other person's text. */
  stopEditing(path: string, autoResolve?: boolean): void;
  /** Resolves a notice: take the other person's text, or keep your own. */
  resolveNotice(path: string, useTheirs: boolean): void;
  setStep(step: number): void;
  authorName(a: Author): string;
  /** Saves the group's answers as an Excel file. */
  downloadExcel(): Promise<void>;
  /** The team's latest Submit, if any. */
  submission: Submission | null;
  /** Saves pending edits, then submits a dated snapshot with the team's sharing choice. */
  submit(share: boolean): Promise<Submission>;
}

const Ctx = createContext<WsApi | null>(null);

export function useWs(): WsApi {
  const c = useContext(Ctx);
  if (!c) throw new Error('useWs outside WorksheetProvider');
  return c;
}

const RETRY_MS = 3000;
const POLL_MS = 3000;

export function WorksheetProvider(props: {
  groupId: string;
  token: string;
  onExpired: () => void;
  viewOnly?: boolean;
  children: ReactNode;
}) {
  const { groupId, token, onExpired } = props;
  const { t } = useContent();
  const [loaded, setLoaded] = useState<GroupSummary | null>(null);
  const [values, setValues] = useState<Worksheet>({});
  const [readOnly, setReadOnly] = useState(false);
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [live, setLive] = useState(false);
  const [endsAt, setEndsAt] = useState<string | null>(null);
  const [idleCloseAt, setIdleCloseAt] = useState<string | null>(null);
  const [hiddenPaths, setHiddenPaths] = useState<string[]>([]);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [notices, setNotices] = useState<Record<string, RemoteNotice>>({});
  const [loadError, setLoadError] = useState(false);

  const versions = useRef<Record<string, number>>({});
  const pending = useRef(new Map<string, FieldValue | null>());
  const inflight = useRef<Map<string, FieldValue | null> | null>(null);
  const editing = useRef<string | null>(null);
  const editedSinceNotice = useRef(new Set<string>());
  const timer = useRef<number | undefined>(undefined);
  const step = useRef(store.step(groupId));
  const readOnlyRef = useRef(false);
  readOnlyRef.current = readOnly;
  const valuesRef = useRef(values);
  valuesRef.current = values;

  const persistQueue = useCallback(() => {
    saveQueue(groupId, [...(inflight.current ?? []), ...pending.current]);
  }, [groupId]);

  const setValue = (path: string, value: FieldValue | null) =>
    setValues((cur) => {
      const next = { ...cur };
      if (value === null) delete next[path];
      else next[path] = value;
      return next;
    });

  /** Applies a server value unless this device has unsaved edits to it, or someone is typing in it. */
  const applyRemote = useCallback((path: string, value: FieldValue | null, version: number, by: Author | null) => {
    if (version <= (versions.current[path] ?? 0)) return;
    versions.current[path] = version;
    // Someone is typing here: never replace their text, tell them instead (FR-R3).
    if (editing.current === path && by) {
      editedSinceNotice.current.delete(path);
      setNotices((n) => ({ ...n, [path]: { by, value } }));
      return;
    }
    if (pending.current.has(path) || inflight.current?.has(path)) return; // our newer edit will win
    setValue(path, value);
  }, []);

  /** Full reload from the server: used on (re)connect and as the polling fallback. */
  const resync = useCallback(async () => {
    try {
      const r = await api<WorksheetResponse>(`/groups/${groupId}/worksheet`, { token });
      setReadOnly(r.readOnly);
      setIdleCloseAt(r.idleCloseAt);
      setHiddenPaths(r.hiddenPaths ?? []);
      setSubmission(r.submission ?? null);
      for (const [path, v] of Object.entries(r.versions)) applyRemote(path, r.worksheet[path] ?? null, v, null);
      return r;
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403 || e.status === 404)) onExpired();
      return null;
    }
  }, [groupId, token, applyRemote, onExpired]);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (inflight.current || pending.current.size === 0) return;
    if (readOnlyRef.current) return;
    const batch = new Map(pending.current);
    pending.current.clear();
    inflight.current = batch;
    persistQueue();
    setStatus('saving');
    try {
      const ops = [...batch].map(([path, value]) => ({ path, value, baseVersion: versions.current[path] ?? 0 }));
      const res = await api<{ applied: { path: string; version: number }[] }>(`/groups/${groupId}/worksheet`, { method: 'PATCH', token, body: { ops, clientId } });
      for (const a of res.applied) versions.current[a.path] = Math.max(versions.current[a.path] ?? 0, a.version);
      inflight.current = null;
      setIdleCloseAt(null); // any saved edit counts as activity (SPEC §4.4 X1)
      persistQueue();
      if (pending.current.size) void flush();
      else setStatus('saved');
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, 'offline', 'No connection.');
      // Put the batch back in front of newer edits (newer edits to the same path win).
      for (const [p, v] of batch) if (!pending.current.has(p)) pending.current.set(p, v);
      inflight.current = null;
      if (err.status === 409) {
        // Closed while we were editing (FR-J2). Keep the queue on the device; it is not sent.
        setReadOnly(true);
        setStatus('readonly');
      } else if (err.status === 401 || err.status === 403) {
        persistQueue();
        onExpired();
      } else if (err.status === 400) {
        pending.current.clear();
        setStatus('error');
      } else {
        setStatus('offline');
        timer.current = window.setTimeout(() => void flush(), RETRY_MS);
      }
      persistQueue();
    }
  }, [groupId, token, onExpired, persistQueue]);

  // Initial load, then replay anything left in the offline queue from a previous visit.
  useEffect(() => {
    let cancelled = false;
    api<WorksheetResponse>(`/groups/${groupId}/worksheet`, { token })
      .then((r) => {
        if (cancelled) return;
        versions.current = r.versions;
        const ws = { ...r.worksheet };
        for (const [p, v] of collapse(loadQueue(groupId))) {
          pending.current.set(p, v);
          if (v === null) delete ws[p];
          else ws[p] = v;
        }
        setValues(ws);
        setReadOnly(r.readOnly);
        setStatus(r.readOnly ? 'readonly' : pending.current.size ? 'saving' : 'saved');
        setEndsAt(r.group.endsAt);
        setIdleCloseAt(r.idleCloseAt);
        setHiddenPaths(r.hiddenPaths ?? []);
        setSubmission(r.submission ?? null);
        setLoaded(r.group);
        if (pending.current.size && !r.readOnly) void flush();
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && (e.status === 401 || e.status === 403 || e.status === 404)) onExpired();
        else setLoadError(true);
      });
    return () => { cancelled = true; };
  }, [groupId, token, onExpired, flush]);

  // Live stream with reconnect; polls every 3 seconds while the stream is down.
  useEffect(() => {
    if (!loaded) return;
    let stop = () => {};
    let retry: number | undefined;
    let poll: number | undefined;
    let backoff = 1000;
    let disposed = false;

    const startPolling = () => {
      if (poll === undefined) poll = window.setInterval(() => void resync(), POLL_MS);
    };
    const stopPolling = () => {
      window.clearInterval(poll);
      poll = undefined;
    };
    const connect = () => {
      stop = openStream(`/api/v1/groups/${groupId}/stream?clientId=${encodeURIComponent(clientId)}&step=${step.current}`, token, {
        onOpen() {
          backoff = 1000;
          setLive(true);
          stopPolling();
          void resync(); // catch up on anything missed while disconnected
          void flush();
        },
        onEvent(event, data) {
          if (event === 'patch') {
            const p = data as PatchEvent;
            if (p.clientId === clientId) return;
            for (const op of p.ops) applyRemote(op.path, op.value, op.version, p.by);
          } else if (event === 'presence') {
            setPeople(data as Person[]);
          } else if (event === 'state') {
            const s = data as { state: string; endsAt: string | null };
            setEndsAt(s.endsAt);
            const ro = s.state !== 'open' || !!props.viewOnly;
            setReadOnly(ro);
            setStatus((cur) => (ro ? 'readonly' : cur === 'readonly' ? 'saved' : cur));
          }
        },
        onClose(code) {
          setLive(false);
          setPeople([]);
          if (disposed) return;
          if (code === 401 || code === 403) return onExpired();
          startPolling();
          retry = window.setTimeout(connect, backoff);
          backoff = Math.min(backoff * 2, 15000);
        },
      });
    };
    connect();
    return () => {
      disposed = true;
      stop();
      stopPolling();
      window.clearTimeout(retry);
    };
  }, [loaded, groupId, token, resync, flush, applyRemote, onExpired]);

  const set = useCallback((path: string, value: FieldValue | null, debounceMs = 0) => {
    if (readOnlyRef.current) return;
    setValue(path, value);
    pending.current.set(path, value);
    if (notices[path]) editedSinceNotice.current.add(path);
    persistQueue();
    setStatus((s) => (s === 'offline' ? s : 'saving'));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), debounceMs);
  }, [flush, persistQueue, notices]);

  const startEditing = useCallback((path: string) => { editing.current = path; }, []);

  const resolveNotice = useCallback((path: string, useTheirs: boolean) => {
    const n = notices[path];
    if (!n) return;
    setNotices(({ [path]: _, ...rest }) => rest);
    editedSinceNotice.current.delete(path);
    if (useTheirs) {
      pending.current.delete(path);
      persistQueue();
      setValue(path, n.value);
    } else {
      // Keep mine: save my current text so it becomes the latest for everyone.
      pending.current.set(path, valuesRef.current[path] ?? null);
      persistQueue();
      void flush();
    }
  }, [notices, flush, persistQueue]);

  const stopEditing = useCallback((path: string, autoResolve = true) => {
    if (editing.current === path) editing.current = null;
    // Left the field without typing after the other person's change: show their text.
    if (autoResolve && notices[path] && !editedSinceNotice.current.has(path)) resolveNotice(path, true);
    void flush();
  }, [notices, resolveNotice, flush]);

  const setStep = useCallback((n: number) => {
    step.current = n;
    if (props.viewOnly) return; // viewers are not shown as members
    void api(`/groups/${groupId}/presence`, { method: 'POST', token, body: { clientId, step: n } }).catch(() => {});
  }, [groupId, token]);

  const authorName = useCallback(
    (a: Author) => a.name || (a.guestNo ? t('presence.guest', { n: String(a.guestNo) }) : t('presence.guest', { n: '?' })),
    [t],
  );

  const submit = useCallback(async (share: boolean) => {
    await flush();
    const r = await api<{ submission: Submission }>(`/groups/${groupId}/submit`, { method: 'POST', body: { share }, token });
    setSubmission(r.submission);
    return r.submission;
  }, [flush, groupId, token]);

  const downloadExcel = useCallback(async () => {
    await flush();
    const res = await fetch(`/api/v1/groups/${groupId}/export.xlsx`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Export failed (${res.status})`);
    const name = /filename\*=UTF-8''([^;]+)/.exec(res.headers.get('content-disposition') ?? '')?.[1];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await res.blob());
    a.download = name ? decodeURIComponent(name) : 'DPI-H pathway.xlsx';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, [flush, groupId, token]);

  // Save before the page goes away; warn if something is still unsent.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') void flush(); };
    const onOnline = () => void flush();
    const onUnload = (e: BeforeUnloadEvent) => { if (pending.current.size || inflight.current) e.preventDefault(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('online', onOnline);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [flush]);

  const value = useMemo<WsApi | null>(
    () => (loaded
      ? { group: loaded, values, readOnly, status, live, endsAt, idleCloseAt, hiddenPaths, viewOnly: !!props.viewOnly, people, notices, set, flushNow: () => void flush(), startEditing, stopEditing, resolveNotice, setStep, authorName, downloadExcel, submission, submit }
      : null),
    [loaded, values, readOnly, status, live, endsAt, idleCloseAt, hiddenPaths, props.viewOnly, people, notices, set, flush, startEditing, stopEditing, resolveNotice, setStep, authorName, downloadExcel, submission, submit],
  );

  if (loadError) return <p className="wrap err" role="alert">{t('error.generic')}</p>;
  if (!value) return <p className="wrap muted" aria-busy="true">…</p>;
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}
