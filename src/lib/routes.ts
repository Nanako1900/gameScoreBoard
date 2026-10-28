// src/lib/routes.ts — the app's addresses (spec §2.2) as data. Pure: no window,
// no document, no storage, no React, so tests/unit can import it.
//
// Board and case routes, plus a permanent landing for retired session URLs. No route starts with /api, /auth or
// /link: those belong to the API, and the SPA only ever sees them when the
// hosting is misconfigured.

import { HISTORY_SHEET_NAME_MAX, USER_ID_MAX } from './constants';
import { ID_PATTERN } from './deepLink';

export const BOARD_TABS = ['list', 'feed', 'report', 'rules'] as const;
export type BoardTab = (typeof BOARD_TABS)[number];
export const SETTINGS_TABS = ['profile', 'discord', 'members', 'ai'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];
export const TOOLS_TABS = ['home', 'filing', 'voice', 'score'] as const;
export type ToolsTab = (typeof TOOLS_TABS)[number];

export type Route =
  | { readonly name: 'home' }
  | { readonly name: 'welcome' }
  | { readonly name: 'guide' }
  | { readonly name: 'cases' }
  | { readonly name: 'settings'; readonly tab: SettingsTab }
  | { readonly name: 'tools'; readonly tab: ToolsTab }
  | { readonly name: 'admin'; readonly tab: 'voice' | 'ai' | 'members' }
  | { readonly name: 'sessionGone' }
  | { readonly name: 'player'; readonly userId: string }
  | { readonly name: 'playerCase'; readonly userId: string; readonly caseId: number }
  /** Alias: look the case up, then replace the address with its playerCase one. */
  | { readonly name: 'case'; readonly caseId: number }
  | { readonly name: 'board'; readonly tab: BoardTab }
  | { readonly name: 'notFound' };

export type LinkableRoute = Exclude<Route, { name: 'notFound' }>;
/** Retained viewport hint for existing callers; all route destinations now render as pages. */
export type RouteLayout = 'page' | 'drawer';

/** The mark the router puts on every entry it writes (P1-1: edg + idx; P1-2 adds fields). */
export interface EdgHistoryState {
  readonly edg: 1;
  /** 0 for the entry the tab landed on; a push is the current idx + 1; a replace keeps it. */
  readonly idx: number;
  /** P1-2: the open overlay's historyKey (≤ HISTORY_SHEET_NAME_MAX characters). */
  readonly sheet?: string;
  /** P1-2: which overlay owns this entry (a positive integer, never reused while the page lives). */
  readonly layer?: number;
  /** P1-2: scrollY when the user left this entry (finite, ≥ 0). */
  readonly y?: number;
}

export const HOME_PATH = '/';
export const WELCOME_PATH = '/welcome';
export const GUIDE_PATH = '/guide';
export const CASES_PATH = '/cases';
export const SETTINGS_PATH = '/settings';
export const TOOLS_PATH = '/tools';
export const RESERVED_PREFIXES = ['/api', '/auth', '/link'] as const;

const HOME: Route = { name: 'home' };
const NOT_FOUND: Route = { name: 'notFound' };

/** Not one of the API's prefixes (`/apix` is not `/api`). */
export function isAppPath(pathname: string): boolean {
  if (!pathname.startsWith('/')) return false;
  return !RESERVED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** OAuth subjects are free-form (worker/oauth.ts): non-empty, bounded, no NUL. */
export function isUserId(raw: string): boolean {
  return raw.length > 0 && raw.length <= USER_ID_MAX && !raw.includes('\u0000');
}

function numericId(raw: string): number | null {
  return ID_PATTERN.test(raw) ? Number(raw) : null;
}

function userIdFrom(segment: string): string | null {
  try {
    const decoded = decodeURIComponent(segment);
    return isUserId(decoded) ? decoded : null;
  } catch {
    return null; // a malformed %-escape
  }
}

/** Exactly one trailing slash is forgiven (`/players/p/`); `/` itself stays. */
function withoutTrailingSlash(pathname: string): string {
  const once = pathname.length > 1 && pathname.endsWith('/') && !pathname.endsWith('//');
  return once ? pathname.slice(0, -1) : pathname;
}

function playerRoute(segment: string): Route {
  const userId = userIdFrom(segment);
  return userId === null ? NOT_FOUND : { name: 'player', userId };
}

function playerCaseRoute(segment: string, rawCaseId: string): Route {
  const userId = userIdFrom(segment);
  const caseId = numericId(rawCaseId);
  return userId === null || caseId === null ? NOT_FOUND : { name: 'playerCase', userId, caseId };
}

function idRoute(raw: string): Route {
  const id = numericId(raw);
  if (id === null) return NOT_FOUND;
  return { name: 'case', caseId: id };
}

function matchSegments(segments: readonly string[]): Route {
  const [head, first, second, third] = segments;
  if (segments.length === 1 && head === 'welcome') return { name: 'welcome' };
  if (segments.length === 1 && head === 'guide') return { name: 'guide' };
  if (segments.length === 1 && head === 'cases') return { name: 'cases' };
  if (head === 'settings') {
    if (segments.length === 1) return { name: 'settings', tab: 'profile' };
    const tab = SETTINGS_TABS.find((value) => value === first);
    if (segments.length === 2 && tab) return { name: 'settings', tab };
  }
  if (head === 'tools') {
    if (segments.length === 1) return { name: 'tools', tab: 'home' };
    const tab = TOOLS_TABS.find((value) => value !== 'home' && value === first);
    if (segments.length === 2 && tab) return { name: 'tools', tab };
  }
  if (head === 'admin' && (segments.length === 1 || (segments.length === 2 && first === 'voice'))) return { name: 'admin', tab: 'voice' };
  if (head === 'admin' && segments.length === 2 && (first === 'ai' || first === 'members')) return { name: 'admin', tab: first };
  if (head === 'sessions') return { name: 'sessionGone' };
  if (segments.length === 2 && head === 'cases') return idRoute(first);
  if (segments.length === 2 && head === 'players') return playerRoute(first);
  if (segments.length === 4 && head === 'players' && second === 'cases') return playerCaseRoute(first, third);
  if (head === 'board') {
    if (segments.length === 1) return { name: 'board', tab: 'list' };
    const tab = BOARD_TABS.find((value) => value !== 'list' && value === first);
    if (segments.length === 2 && tab) return { name: 'board', tab };
  }
  return NOT_FOUND;
}

/** Reads only the pathname: search and hash never choose a route. */
export function parseRoute(pathname: string): Route {
  if (!isAppPath(pathname)) return NOT_FOUND;
  const path = withoutTrailingSlash(pathname);
  if (path === HOME_PATH) return HOME;
  return matchSegments(path.slice(1).split('/'));
}

export function playerPath(userId: string): string {
  return `/players/${encodeURIComponent(userId)}`;
}

export function playerCasePath(userId: string, caseId: number): string {
  return `${playerPath(userId)}/cases/${caseId}`;
}

export function casePath(caseId: number): string {
  return `/cases/${caseId}`;
}

export function adminVoicePath(userId?: string): string {
  return '/admin/voice' + (userId === undefined ? '' : `?${new URLSearchParams({ user: userId }).toString()}`);
}

export function boardPath(tab: BoardTab): string {
  return tab === 'list' ? '/board' : `/board/${tab}`;
}

export function settingsPath(tab: SettingsTab): string {
  return `${SETTINGS_PATH}/${tab}`;
}

/** Only the evidence and score tools select a subject through the query string. */
export function toolsPath(tab: ToolsTab = 'home', userId?: string): string {
  const path = tab === 'home' ? TOOLS_PATH : `${TOOLS_PATH}/${tab}`;
  return userId !== undefined && (tab === 'voice' || tab === 'score')
    ? `${path}?${new URLSearchParams({ user: userId }).toString()}` : path;
}

/** Never ends in `/` (except the home page itself). */
export function formatRoute(route: LinkableRoute): string {
  switch (route.name) {
    case 'home':
      return HOME_PATH;
    case 'welcome':
      return WELCOME_PATH;
    case 'guide':
      return GUIDE_PATH;
    case 'cases':
      return CASES_PATH;
    case 'settings':
      return settingsPath(route.tab);
    case 'tools':
      return toolsPath(route.tab);
    case 'admin':
      return route.tab === 'voice' ? adminVoicePath() : `/admin/${route.tab}`;
    case 'sessionGone':
      return '/sessions';
    case 'player':
      return playerPath(route.userId);
    case 'playerCase':
      return playerCasePath(route.userId, route.caseId);
    case 'case':
      return casePath(route.caseId);
    case 'board':
      return boardPath(route.tab);
  }
}

/** Every destination uses the full page; home stays mounted only to retain its data and scroll. */
export function routeCoversHome(route: Route, _layout: RouteLayout): boolean {
  return route.name !== 'home';
}

const isIndex = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isLayerId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

const isSheetName = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= HISTORY_SHEET_NAME_MAX;

const isScrollY = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

/**
 * The router's mark on a history entry, or null for an entry it did not write.
 * Only `edg === 1` decides that; a missing or broken idx reads as 0, and a
 * broken sheet / layer / y (P1-2) is left out.
 */
export function readEdgState(raw: unknown): EdgHistoryState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { edg, idx, sheet, layer, y } = raw as Record<string, unknown>;
  if (edg !== 1) return null;
  return {
    edg: 1,
    idx: isIndex(idx) ? idx : 0,
    ...(isSheetName(sheet) ? { sheet } : {}),
    ...(isLayerId(layer) ? { layer } : {}),
    ...(isScrollY(y) ? { y } : {}),
  };
}
