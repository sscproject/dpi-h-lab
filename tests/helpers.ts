// Test helpers shared by the API test files.

import { formatTeamCode } from '../shared/codes';
import { activeContentVersion } from '../server/content-store';
import type { Db } from '../server/db';
import { createGroup } from '../server/groups';

/**
 * A team on its own, outside any session, for tests of joining, editing and live updates.
 * (In the app every team is set up by a facilitator in a session; these tests don't need one.)
 */
export async function makeTeam(db: Db, name = 'Fiji') {
  const version = await activeContentVersion(db);
  const g = await createGroup(db, { name, contentVersion: version! });
  return { groupId: g.id, teamCode: formatTeamCode(g.teamCode) };
}
