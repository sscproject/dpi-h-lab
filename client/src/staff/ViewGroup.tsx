// A read-only view of one team's worksheet, with live updates: from a workshop console
// (FR-F9) or, for admins, from the Teams list. Uses a short-lived read-only group token, so
// the viewer never shows up as a team member.

import { useCallback, useEffect, useState } from 'react';
import { ContentProvider } from '../content';
import { InfoProvider } from '../components/Info';
import { navigate } from '../router';
import { WorksheetProvider } from '../worksheet/WorksheetContext';
import { WorksheetPage } from '../worksheet/WorksheetPage';

type Call = <T>(path: string, opts?: { method?: string; body?: unknown }) => Promise<T>;

export function ViewGroup({ viewPath, backTo, groupId, call, backLabel }: { viewPath: string; backTo: string; groupId: string; call: Call; backLabel: string }) {
  const [view, setView] = useState<{ token: string; contentVersion: string | null } | null>(null);
  const back = useCallback(() => navigate(backTo), [backTo]);

  useEffect(() => {
    call<{ token: string; contentVersion: string | null }>(viewPath, { method: 'POST' })
      .then(setView)
      .catch(back);
  }, [call, viewPath, back]);

  if (!view) return <main className="wrap" aria-busy="true"><p className="muted">…</p></main>;
  return (
    <ContentProvider version={view.contentVersion}>
      <InfoProvider>
        <WorksheetProvider groupId={groupId} token={view.token} onExpired={back} viewOnly>
          <WorksheetPage onLeave={back} leaveLabel={backLabel} />
        </WorksheetProvider>
      </InfoProvider>
    </ContentProvider>
  );
}
