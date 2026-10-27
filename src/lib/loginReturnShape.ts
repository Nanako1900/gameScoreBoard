// edg.return (spec §4.1 登录回跳, P1 contract 4.11): where a visitor was, and
// what they clicked, right before the top-level jump to the login page. Pure —
// no window, no storage — so tests/unit can hold every rule. The value only
// ever leads to a question on screen: a saved intent never writes anything.

import { isSelfRsvp } from '@shared/attendance';
import type { SelfRsvp } from '@shared/attendance';
import { LOGIN_RETURN_TTL_MS, RETURN_PATH_MAX } from './constants';
import { readDeepLink } from './deepLink';
import { HOME_PATH, isAppPath, parseRoute } from './routes';
import type { Route } from './routes';

export const LOGIN_RETURN_KEY = 'edg.return';

const VERSION = 1;

/** The one intent P1 knows: an answer clicked on a session before logging in. */
export type LoginIntent = { readonly kind: 'rsvp'; readonly sessionId: number; readonly rsvp: SelfRsvp };

export interface LoginReturn {
  readonly v: 1;
  /** pathname + search, never a hash. */
  readonly path: string;
  readonly savedAt: number;
  readonly intent?: LoginIntent;
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

/** A well-formed intent that matches the page it was saved on; anything else is dropped. */
function readIntent(raw: unknown, route: Route): LoginIntent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { kind, sessionId, rsvp } = raw as Record<string, unknown>;
  if (kind !== 'rsvp' || typeof rsvp !== 'string' || !isSelfRsvp(rsvp)) return null;
  if (route.name !== 'session' || sessionId !== route.sessionId) return null;
  return { kind: 'rsvp', sessionId: route.sessionId, rsvp };
}

export function serializeLoginReturn(path: string, intent: LoginIntent | undefined, now: number): string {
  const base: LoginReturn = { v: VERSION, path, savedAt: now };
  return JSON.stringify(intent ? { ...base, intent } : base);
}

/** Validates everything; a bad or stale value is null, a bad intent alone is dropped. Never throws. */
export function parseLoginReturn(raw: string | null, now: number): LoginReturn | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { v, path, savedAt, intent } = parsed as Record<string, unknown>;
  if (v !== VERSION || !isFresh(savedAt, now)) return null;
  const route = returnRoute(path);
  if (route === null || typeof path !== 'string') return null;
  const kept = readIntent(intent, route);
  return kept ? { v: VERSION, path, savedAt, intent: kept } : { v: VERSION, path, savedAt };
}

/** An old ?case= / ?session= link opened this load: it wins over edg.return (contract 4.11). */
export function hasLegacyTarget(pathname: string, search: string): boolean {
  return pathname === HOME_PATH && readDeepLink(search) !== null;
}

/** The answer to point at on session `sessionId`, if the saved intent was about it. */
export function resumeRsvpFor(intent: LoginIntent | null | undefined, sessionId: number): SelfRsvp | null {
  return intent && intent.sessionId === sessionId ? intent.rsvp : null;
}
