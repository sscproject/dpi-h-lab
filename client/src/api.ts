// Small fetch wrapper for /api/v1. Network failures surface as ApiError with status 0.

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public body?: Record<string, unknown>) {
    super(message);
  }
  get offline() { return this.status === 0; }
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; token?: string; cache?: RequestCache } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: opts.method ?? 'GET',
      cache: opts.cache,
      headers: {
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'offline', 'No connection.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'error', data.message ?? res.statusText, data);
  return data as T;
}

export interface GroupSummary {
  id: string;
  teamCode: string;
  name: string | null;
  country: string | null;
  state: 'draft' | 'open' | 'closed' | 'deleted';
  eventId: string | null;
  startsAt: string | null;
  endsAt: string | null;
  contentVersion: string | null;
  /** "Just exploring": deleted 24 hours after it started; its code works until then. */
  practice?: boolean;
  /** Practice groups: when they are deleted. */
  expiresAt?: string | null;
}

/** A practice group: signed in on this browser only; no code to share, no owner link. */
export interface PracticeResponse {
  groupId: string;
  teamCode: string;
  practice: true;
  groupToken: string;
}

export interface JoinResponse {
  groupToken: string;
  group: GroupSummary;
  readOnly: boolean;
}

/** What a code opens (home page): a workshop, to pick a team from, or a team. */
export type LookupResponse =
  | { kind: 'workshop'; workshop: { name: string; code: string; state: string; startsAt: string | null }; teams: { id: string; label: string; state: string }[] }
  | { kind: 'team'; team: { label: string | null; practice: boolean } };
