// edg.return (spec §4.1 登录回跳, P1 contract 4.11): where a visitor was, and
// the address they left right before the top-level jump to the login page.
// Pure: no window, storage or writes. Old intent fields are ignored.

import { LOGIN_RETURN_TTL_MS, RETURN_PATH_MAX } from './constants';
import { hasRetiredSessionLink, readDeepLink } from './deepLink';
import { HOME_PATH, isAppPath, parseRoute } from './routes';
import type { Route } from './routes';

export const LOGIN_RETURN_KEY = 'edg.return';

const VERSION = 1;

export interface LoginReturn {
  readonly v: 1;
  /** pathname + search, never a hash. */
  readonly path: string;
  readonly savedAt: number;
}

/** The route a stored path leads to, or null when it is not a page worth coming back to. */
function returnRoute(path: unknown): Route | null {
  if (typeof path !== 'string' || path.length > RETURN_PATH_MAX) return null;
  if (!path.startsWith('/') || path.startsWith('//')) return null;
  if (path.includes('\\') || path.includes('#')) return null;
  const pathname = path.split('?')[0];
  if (!isAppPath(pathname)) return null;
  const route = parseRoute(pathname);
  return route.name === 'home' || route.name === 'notFound' ? null : route;
}

function isFresh(savedAt: unknown, now: number): savedAt is number {
  if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) return false;
  const age = now - savedAt;
  return age >= 0 && age <= LOGIN_RETURN_TTL_MS;
}

export function serializeLoginReturn(path: string, now: number): string {
  return JSON.stringify({ v: VERSION, path, savedAt: now });
}

/** A bad or stale value is null; retired addresses go home. Old extra fields are ignored. */
export function parseLoginReturn(raw: string | null, now: number): LoginReturn | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { v, path, savedAt } = parsed as Record<string, unknown>;
  if (v !== VERSION || !isFresh(savedAt, now)) return null;
  const route = returnRoute(path);
  if (route === null || typeof path !== 'string') return null;
  return { v: VERSION, path: route.name === 'sessionGone' ? HOME_PATH : path, savedAt };
}

/** An old ?case= / ?session= link opened this load: it wins over edg.return (contract 4.11). */
export function hasLegacyTarget(pathname: string, search: string): boolean {
  return pathname === HOME_PATH && (readDeepLink(search) !== null || hasRetiredSessionLink(search));
}
