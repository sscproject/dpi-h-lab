// Real-time hub (FR-R2, FR-J4): each open worksheet holds a Server-Sent Events stream.
// The server pushes patches, presence and state changes; clients send edits and
// presence over plain HTTPS. SSE instead of WebSockets because AWS App Runner, the
// recommended host, does not support WebSockets.
// Facilitator dashboards and read-only viewers "watch" a channel without taking part.
// State is in memory, so this serves one instance; scaling out needs a shared bus
// (e.g. PostgreSQL LISTEN/NOTIFY).

import type { ServerResponse } from 'node:http';

export interface PresenceEntry {
  clientId: string;
  name: string | null;
  /** Stable "Guest n" number for members without a display name. */
  guestNo: number;
  step: number;
}

interface Member extends PresenceEntry {
  res: ServerResponse;
}

const KEEPALIVE_MS = 20_000;

export class Hub {
  private groups = new Map<string, Map<string, Member>>();
  private guestSeq = new Map<string, number>();
  /** Channels: `event:<id>` for facilitator dashboards, `group:<id>` for read-only viewers. */
  private watchers = new Map<string, Set<ServerResponse>>();
  private timer: NodeJS.Timeout;
  /** Called when a group's presence changes (dashboards show how many people are connected). */
  onPresence: (groupId: string) => void = () => {};

  constructor() {
    // Comments keep proxies and load balancers from closing idle streams.
    this.timer = setInterval(() => {
      for (const members of this.groups.values()) for (const m of members.values()) m.res.write(': ping\n\n');
      for (const set of this.watchers.values()) for (const res of set) res.write(': ping\n\n');
    }, KEEPALIVE_MS);
    this.timer.unref();
  }

  join(groupId: string, entry: Omit<PresenceEntry, 'guestNo'>, res: ServerResponse) {
    let members = this.groups.get(groupId);
    if (!members) this.groups.set(groupId, (members = new Map()));
    const previous = members.get(entry.clientId);
    let guestNo = previous?.guestNo ?? 0;
    if (!guestNo) {
      guestNo = (this.guestSeq.get(groupId) ?? 0) + 1;
      this.guestSeq.set(groupId, guestNo);
    }
    if (previous && previous.res !== res) previous.res.end();
    members.set(entry.clientId, { ...entry, guestNo, res });
    this.broadcastPresence(groupId);
  }

  leave(groupId: string, clientId: string, res: ServerResponse) {
    const members = this.groups.get(groupId);
    if (members?.get(clientId)?.res !== res) return;
    members.delete(clientId);
    if (!members.size) {
      this.groups.delete(groupId);
      this.guestSeq.delete(groupId);
    }
    this.broadcastPresence(groupId);
  }

  /** Open streams on a group (members and read-only viewers), to cap them. */
  streamCount(groupId: string) {
    return (this.groups.get(groupId)?.size ?? 0) + (this.watchers.get(`group:${groupId}`)?.size ?? 0);
  }

  /** Ends every member's stream (e.g. after a new team code): they must join again. */
  kick(groupId: string) {
    for (const m of this.groups.get(groupId)?.values() ?? []) m.res.end();
  }

  setStep(groupId: string, clientId: string, step: number) {
    const m = this.groups.get(groupId)?.get(clientId);
    if (!m || m.step === step) return;
    m.step = step;
    this.broadcastPresence(groupId);
  }

  member(groupId: string, clientId: string | undefined): PresenceEntry | undefined {
    return clientId ? this.groups.get(groupId)?.get(clientId) : undefined;
  }

  presence(groupId: string): PresenceEntry[] {
    return [...(this.groups.get(groupId)?.values() ?? [])].map(({ clientId, name, guestNo, step }) => ({ clientId, name, guestNo, step }));
  }

  connectedCount(groupId: string) {
    return this.groups.get(groupId)?.size ?? 0;
  }

  /** Sends to the group's members and to anyone watching it read-only. */
  broadcast(groupId: string, event: string, data: unknown) {
    const frame = sseFrame(event, data);
    for (const m of this.groups.get(groupId)?.values() ?? []) m.res.write(frame);
    this.notify(`group:${groupId}`, event, data);
  }

  watch(channel: string, res: ServerResponse) {
    let set = this.watchers.get(channel);
    if (!set) this.watchers.set(channel, (set = new Set()));
    set.add(res);
  }

  unwatch(channel: string, res: ServerResponse) {
    const set = this.watchers.get(channel);
    set?.delete(res);
    if (set && !set.size) this.watchers.delete(channel);
  }

  notify(channel: string, event: string, data: unknown) {
    const set = this.watchers.get(channel);
    if (!set) return;
    const frame = sseFrame(event, data);
    for (const res of set) res.write(frame);
  }

  close() {
    clearInterval(this.timer);
    for (const members of this.groups.values()) for (const m of members.values()) m.res.end();
    for (const set of this.watchers.values()) for (const res of set) res.end();
    this.groups.clear();
    this.watchers.clear();
  }

  private broadcastPresence(groupId: string) {
    this.broadcast(groupId, 'presence', this.presence(groupId));
    this.onPresence(groupId);
  }
}

export const sseFrame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** Starts an event stream on a hijacked Fastify reply. */
export function openSse(res: ServerResponse) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
}
