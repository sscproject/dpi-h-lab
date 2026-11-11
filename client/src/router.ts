import { useEffect, useState } from 'react';

export type Route =
  | { name: 'landing'; code?: string }
  | { name: 'worksheet'; code: string }
  | { name: 'staff' }
  | { name: 'workshops' }
  | { name: 'adminview'; groupId: string }
  | { name: 'event'; eventId: string }
  | { name: 'print'; eventId: string }
  | { name: 'view'; eventId: string; groupId: string };

export function parseRoute(pathname: string): Route {
  const p = pathname.replace(/\/+$/, '').split('/').slice(1).map(decodeURIComponent);
  if (p[0] === 'join' && p[1]) return { name: 'landing', code: p[1] };
  if (p[0] === 'g' && p[1]) return { name: 'worksheet', code: p[1] };
  if (p[0] === 'staff') {
    if (p[1] === 'events' && p[2] && p[3] === 'print') return { name: 'print', eventId: p[2] };
    if (p[1] === 'events' && p[2]) return { name: 'event', eventId: p[2] };
    if (p[1] === 'view' && p[2] && p[3]) return { name: 'view', eventId: p[2], groupId: p[3] };
    if (p[1] === 'workshops') return { name: 'workshops' };
    if (p[1] === 'admin' && p[2] === 'view' && p[3]) return { name: 'adminview', groupId: p[3] };
    return { name: 'staff' };
  }
  return { name: 'landing' };
}

export function navigate(path: string) {
  history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.pathname));
  useEffect(() => {
    const on = () => setRoute(parseRoute(location.pathname));
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  return route;
}
