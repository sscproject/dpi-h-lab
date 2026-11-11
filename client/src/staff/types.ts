export type State = 'draft' | 'open' | 'closed' | 'deleted';

export interface EventDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  location: string | null;
  timezone: string | null;
  state: State;
  startsAt: string | null;
  endsAt: string | null;
  /** A dated workshop, or an open (ongoing) session. */
  kind: 'workshop' | 'open';
  /** One team, or several. */
  scope: 'single' | 'multi';
  contentVersion: string | null;
  facilitatorId: string | null;
  facilitatorName: string | null;
  groupCount: number | null;
}

export interface GroupCard {
  id: string;
  teamCode: string;
  name: string | null;
  country: string | null;
  countryCode: string | null;
  /** When the team last pressed Submit on its Summary step. */
  submittedAt: string | null;
  state: State;
  linkStatus: 'pending' | 'approved' | 'declined' | null;
  progressPct: number;
  priority: string | null;
  regional: string | null;
  connected: number;
  lastActivity: string;
  endsAt: string | null;
  consent: 'private' | 'aggregate' | 'identified' | null;
  joinUrl?: string;
}

export interface Person { id: string; name: string | null; email: string }

export interface EventView {
  event: EventDto;
  facilitator: Person | null;
  coFacilitators: Person[];
  groups: GroupCard[];
}
