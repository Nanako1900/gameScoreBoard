import { useSyncExternalStore } from 'react';
import { DESKTOP_MEDIA_QUERY } from './constants';
import type { RouteLayout } from './routes';

// The only breakpoint in JS (contract §8 #9): a page and a drawer differ in
// semantics (inert, focus trap), not just in looks, so CSS alone cannot switch them.

function desktopQuery(): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia(DESKTOP_MEDIA_QUERY) : null;
}

function subscribe(onChange: () => void): () => void {
  const query = desktopQuery();
  if (query === null) return () => {};
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function readLayout(): RouteLayout {
  return desktopQuery()?.matches === true ? 'drawer' : 'page';
}

/** 'drawer' at ≥1024px, else 'page' (also when matchMedia is missing, as in jsdom). */
export function useRouteLayout(): RouteLayout {
  return useSyncExternalStore(subscribe, readLayout, readLayout);
}
