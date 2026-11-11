// Offline queue (FR-R4): unsaved edits are kept on the device until the server confirms
// them, so a dropped connection, a closed tab or a reload never loses a confirmed edit.

import type { FieldValue } from '../../../shared/worksheet';

export type QueuedOp = [path: string, value: FieldValue | null];

export interface QueueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const key = (groupId: string) => `dpih.queue.${groupId}`;

function storage(): QueueStorage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

export function loadQueue(groupId: string, s: QueueStorage | null = storage()): QueuedOp[] {
  try {
    const raw = s?.getItem(key(groupId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => Array.isArray(x) && typeof x[0] === 'string') : [];
  } catch {
    return [];
  }
}

/** Saves everything not yet confirmed: the batch in flight first, then newer edits (later entries win). */
export function saveQueue(groupId: string, ops: QueuedOp[], s: QueueStorage | null = storage()) {
  try {
    if (!ops.length) s?.removeItem(key(groupId));
    else s?.setItem(key(groupId), JSON.stringify(ops));
  } catch {
    /* storage full or blocked: edits stay in memory for this page */
  }
}

/** Collapses a list of ops to the latest value per path, keeping first-seen order. */
export function collapse(ops: QueuedOp[]): Map<string, FieldValue | null> {
  const m = new Map<string, FieldValue | null>();
  for (const [p, v] of ops) {
    m.delete(p);
    m.set(p, v);
  }
  return m;
}
