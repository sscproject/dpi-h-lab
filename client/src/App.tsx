import { useCallback, useEffect, useState } from 'react';
import { normalizeCode } from '../../shared/codes';
import { api } from './api';
import { Footer, Header } from './components/Header';
import { InfoProvider } from './components/Info';
import { ContentProvider } from './content';
import { Landing } from './Landing';
import { StaffApp } from './staff/StaffApp';
import { navigate, useRoute } from './router';
import { store } from './session';
import { WorksheetProvider } from './worksheet/WorksheetContext';
import { WorksheetPage } from './worksheet/WorksheetPage';

const RENEW_MS = 4 * 60 * 60 * 1000; // sign-ins last 12 h; renew well before (SPEC §4.4 X5)

function WorksheetRoute({ code }: { code: string }) {
  const [session, setSession] = useState(store.session);
  const onExpired = useCallback(() => {
    store.setSession(null);
    navigate(`/join/${code}`);
  }, [code]);

  // Keep the sign-in alive while the group is open, so a long workshop never logs anyone out.
  useEffect(() => {
    if (!session) return;
    const timer = window.setInterval(async () => {
      try {
        const r = await api<{ groupToken: string }>(`/groups/${session.groupId}/token`, { method: 'POST', token: session.token });
        const next = { ...session, token: r.groupToken };
        store.setSession(next);
        setSession(next);
      } catch {
        /* closed or offline: the current sign-in still works until it expires */
      }
    }, RENEW_MS);
    return () => window.clearInterval(timer);
  }, [session]);

  if (!session || normalizeCode(session.teamCode) !== normalizeCode(code)) {
    return (
      <ContentProvider>
        <InfoProvider>
          <Header signIn />
          <Landing initialCode={code} />
          <Footer />
        </InfoProvider>
      </ContentProvider>
    );
  }
  return (
    // Each group renders with the content version it was started with (FR-A5).
    <ContentProvider version={session.contentVersion}>
      <InfoProvider>
        <WorksheetProvider groupId={session.groupId} token={session.token} onExpired={onExpired}>
          <WorksheetPage onLeave={() => { store.setSession(null); navigate('/'); }} />
        </WorksheetProvider>
      </InfoProvider>
    </ContentProvider>
  );
}

export function App() {
  const route = useRoute();
  if (route.name === 'worksheet') return <WorksheetRoute key={route.code} code={route.code} />;
  if (route.name === 'staff' || route.name === 'workshops' || route.name === 'adminview' || route.name === 'event' || route.name === 'print' || route.name === 'view') return <StaffApp route={route} />;
  return (
    <ContentProvider>
      <InfoProvider>
        <Header signIn />
        <Landing key={route.code ?? ''} initialCode={route.code} />
        <Footer />
      </InfoProvider>
    </ContentProvider>
  );
}
