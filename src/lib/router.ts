// src/lib/router.ts — the one module that drives window.history (spec §2.2;
// source-hygiene keeps it that way). Hand-written on purpose: five routes do not
// need a dependency.
//
// The address is the state: useLocation() reads window.location, cached by
// pathname + search, so a test that sets the address with replaceState before
// render() is read correctly. Every entry the router writes carries
// { edg: 1, idx }; idx > 0 means there is an entry of ours behind this one.

import { useSyncExternalStore } from 'react';
import { HOME_PATH, isAppPath, parseRoute, readEdgState, type Route } from './routes';

export interface RouterLocation {
  readonly pathname: string;
  /** '' or '?…' */
  readonly search: string;
  readonly route: Route;
}

export interface NavigateOptions {
  /** Default false: pushState. */
  readonly replace?: boolean;
  /** Default false: a push scrolls to the top. Desktop drawers pass true — the lobby stays put. */
  readonly keepScroll?: boolean;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let snapshot: RouterLocation | null = null;

const keyOf = (pathname: string, search: string): string => pathname + search;
const currentKey = (): string => keyOf(window.location.pathname, window.location.search);

function readLocation(): RouterLocation {
  const { pathname, search } = window.location;
  if (snapshot === null || keyOf(snapshot.pathname, snapshot.search) !== keyOf(pathname, search)) {
    snapshot = { pathname, search, route: parseRoute(pathname) };
  }
  return snapshot;
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

/** A popstate that only moved the hash changes nothing here (spec §2.2: no hash routing). */
function onPopState(): void {
  if (snapshot !== null && keyOf(snapshot.pathname, snapshot.search) === currentKey()) return;
  notify();
}

function subscribe(listener: Listener): () => void {
  if (listeners.size === 0) window.addEventListener('popstate', onPopState);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('popstate', onPopState);
  };
}

const currentIndex = (): number => readEdgState(window.history.state)?.idx ?? 0;

export function useLocation(): RouterLocation {
  return useSyncExternalStore(subscribe, readLocation, readLocation);
}

export function useRoute(): Route {
  return useLocation().route;
}

/** pathname + search of the current entry (LoginLink saves it, P1-3). */
export function currentPath(): string {
  return currentKey();
}

/** In-app paths only; /api, /auth and /link leave the SPA with a full page load. */
export function navigate(path: string, options: NavigateOptions = {}): void {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Error('navigate 只接受站内路径');
  }
  const url = new URL(path, window.location.origin);
  if (!isAppPath(url.pathname)) {
    window.location.assign(path);
    return;
  }
  const target = keyOf(url.pathname, url.search);
  const replace = options.replace === true;
  if (!replace && target === currentKey()) return; // no duplicate entries
  const idx = currentIndex();
  if (replace) {
    window.history.replaceState({ edg: 1, idx }, '', target);
  } else {
    window.history.pushState({ edg: 1, idx: idx + 1 }, '', target);
    if (options.keepScroll !== true) window.scrollTo(0, 0);
  }
  notify();
}

/** Back through our own entries; from the first one, replace with `fallback` instead of leaving the site. */
export function goBack(fallback: string = HOME_PATH): void {
  if (currentIndex() > 0) {
    window.history.back();
    return;
  }
  navigate(fallback, { replace: true });
}

/** Marks the entry the tab landed on (idempotent: StrictMode and repeated renders are safe). */
export function bootRouter(): void {
  if (readEdgState(window.history.state) !== null) return;
  window.history.replaceState({ edg: 1, idx: 0 }, '', currentKey());
}

/** Tests only (tests/dom/setup.ts): forget everything, back to '/' with no state. */
export function resetRouterForTests(): void {
  listeners.clear();
  window.removeEventListener('popstate', onPopState);
  snapshot = null;
  window.history.replaceState(null, '', HOME_PATH);
}
