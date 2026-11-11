// Staff area. After signing in, each role lands on its own home: admins on Admin (every
// workshop, team and person), facilitators on My workshops. Someone whose password was set
// by an admin chooses their own first. Also: workshop console, codes sheet, team view.

import { useMemo, useState } from 'react';
import { Footer, Header } from '../components/Header';
import { InfoProvider } from '../components/Info';
import { ContentProvider, useContent } from '../content';
import type { Route } from '../router';
import { ChangePassword, ForcePassword, StaffMenu } from './Account';
import { AdminHome } from './Admin';
import { EventConsole } from './EventConsole';
import { MyWorkshops } from './Home';
import { PrintCodes } from './PrintCodes';
import { SignIn } from './SignIn';
import { isAdmin, staffApi, useStaffSession } from './staffSession';
import { ViewGroup } from './ViewGroup';

type StaffRoute = Extract<Route, { name: 'staff' | 'workshops' | 'adminview' | 'event' | 'print' | 'view' }>;

function Staff({ route }: { route: StaffRoute }) {
  const { t } = useContent();
  const { session, signIn, signOut } = useStaffSession();
  const [pwOpen, setPwOpen] = useState(false);
  const call = useMemo(() => (session ? staffApi(session, signOut) : null), [session, signOut]);

  if (!session || !call) {
    return (<><Header /><SignIn onSignedIn={signIn} /><Footer /></>);
  }
  const menu = <StaffMenu session={session} onSignOut={signOut} onPassword={() => setPwOpen(true)} />;
  if (session.user.mustChangePassword) {
    return (<><Header status={menu} /><ForcePassword call={call} onChanged={signIn} /><Footer /></>);
  }
  if (route.name === 'view') {
    return <ViewGroup viewPath={`/events/${route.eventId}/groups/${route.groupId}/view`} backTo={`/staff/events/${route.eventId}`} groupId={route.groupId} call={call} backLabel={t('view.back')} />;
  }
  if (route.name === 'adminview') {
    return <ViewGroup viewPath={`/admin/groups/${route.groupId}/view`} backTo="/staff?tab=teams" groupId={route.groupId} call={call} backLabel={t('staff.back')} />;
  }
  const admin = isAdmin(session.user.role);
  return (
    <>
      {route.name !== 'print' && <Header status={menu} />}
      {route.name === 'staff' && (admin ? <AdminHome session={session} call={call} /> : <MyWorkshops session={session} call={call} />)}
      {route.name === 'workshops' && <MyWorkshops session={session} call={call} />}
      {route.name === 'event' && <EventConsole eventId={route.eventId} session={session} call={call} onExpired={signOut} />}
      {route.name === 'print' && <PrintCodes eventId={route.eventId} call={call} />}
      {route.name !== 'print' && <Footer />}
      {pwOpen && <ChangePassword call={call} onClose={() => setPwOpen(false)} onChanged={signIn} />}
    </>
  );
}

export function StaffApp({ route }: { route: StaffRoute }) {
  return (
    <ContentProvider>
      <InfoProvider>
        <Staff route={route} />
      </InfoProvider>
    </ContentProvider>
  );
}
