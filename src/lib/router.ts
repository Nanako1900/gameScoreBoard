// src/lib/router.ts — the one module that drives window.history (spec §2.2;
// source-hygiene keeps it that way). Hand-written on purpose: five routes do not
// need a dependency.
//
// The address is the state: useLocation() reads window.location, cached by
// pathname + search, so a test that sets the address with replaceState before
// render() is read correctly. Every entry the router writes carries
// { edg: 1, idx }; idx > 0 means there is an entry of ours behind this one.
//
// P1-2 — overlays in history. A sheet / dialog / drawer given a historyKey owns
// one entry at the same address ({ edg, idx, sheet, layer }), so the back
// button closes it instead of leaving the page; popstate closes only what sits
// above the entry the browser landed on — normally just the top layer. Closing
// from the UI (✕, Esc, backdrop, the caller's buttons) still calls onClose
// synchronously; when the overlay goes away the router walks back over its
// entry with a silent history.go(-n) whose popstate closes nothing. Until that
// lands every other history write waits in `held`, so it never undoes one.
// A fresh tab on a deep address gets one `/` underneath; a reload pads nothing
// and never reopens an overlay. Leaving an entry remembers scrollY in `y`.

import { useSyncExternalStore } from 'react';
import { HISTORY_SHEET_NAME_MAX, SILENT_BACK_TIMEOUT_MS } from './constants';
import { HOME_PATH, isAppPath, parseRoute, readEdgState, type EdgHistoryState, type Route } from './routes';

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

/** P1-2: one overlay's claim on a history entry. Positive, never reused while the page lives. */
export type LayerEntryId = number;

type Listener = () => void;

interface OpenLayer {
  readonly id: LayerEntryId;
  readonly onPop: () => void;
}

const listeners = new Set<Listener>();
let snapshot: RouterLocation | null = null;
let listening = false;
/** pathname + search the subscribers were last told about (P1-2: tracked even with no subscriber). */
let lastKey = '';

/** P1-2: overlays that asked for an entry and have not closed yet, bottom → top. */
let openLayers: readonly OpenLayer[] = [];
/** P1-2: overlay entries sitting directly on top of the current route entry, bottom → top. */
let stacked: readonly LayerEntryId[] = [];
let nextLayerEntryId: LayerEntryId = 1;
/** P1-2: popstates still owed by our own silent history.go(-n). */
let silentBacks = 0;
let silentTimer: ReturnType<typeof setTimeout> | null = null;
/** P1-2: history writes waiting for the silent back to land, oldest first. */
let held: readonly (() => void)[] = [];

const keyOf = (pathname: string, search: string): string => pathname + search;
const currentKey = (): string => keyOf(window.location.pathname, window.location.search);
const currentState = (): EdgHistoryState | null => readEdgState(window.history.state);
const currentIndex = (): number => currentState()?.idx ?? 0;

function readLocation(): RouterLocation {
  const { pathname, search } = window.location;
  if (snapshot === null || keyOf(snapshot.pathname, snapshot.search) !== keyOf(pathname, search)) {
    snapshot = { pathname, search, route: parseRoute(pathname) };
  }
  return snapshot;
}

function notify(): void {
  lastKey = currentKey();
  listeners.forEach((listener) => listener());
}

/** Did pathname + search change since the last notify? A hash-only move does not count. */
function moved(): boolean {
  return currentKey() !== lastKey;
}

// ---------------------------------------------------------------- the popstate listener

/** One window listener for the whole module, only while someone needs it (P1-2: open overlays and silent backs too). */
function syncListener(): void {
  const needed = listeners.size > 0 || openLayers.length > 0 || silentBacks > 0;
  if (needed && !listening) {
    lastKey = currentKey();
    window.addEventListener('popstate', onPopState);
    listening = true;
  } else if (!needed && listening) {
    window.removeEventListener('popstate', onPopState);
    listening = false;
  }
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  syncListener();
  return () => {
    listeners.delete(listener);
    syncListener();
  };
}

// ---------------------------------------------------------------- silent back and the queue

/** Run now, or after the silent back in flight has landed. */
function whenSettled(write: () => void): void {
  if (silentBacks === 0) {
    write();
    return;
  }
  held = [...held, write];
}

function flushHeld(): void {
  while (silentBacks === 0 && held.length > 0) {
    const [next, ...rest] = held;
    held = rest;
    next();
  }
}

function clearSilentTimer(): void {
  if (silentTimer !== null) {
    clearTimeout(silentTimer);
    silentTimer = null;
  }
}

/** A traversal that never reported back must not hold navigations forever. */
function onSilentTimeout(): void {
  silentTimer = null;
  silentBacks = 0;
  flushHeld();
  syncListener();
}

function silentBack(steps: number): void {
  silentBacks += 1;
  clearSilentTimer();
  silentTimer = setTimeout(onSilentTimeout, SILENT_BACK_TIMEOUT_MS);
  syncListener();
  window.history.go(-steps);
}

function onSilentPop(): void {
  silentBacks -= 1;
  if (silentBacks === 0) {
    clearSilentTimer();
    flushHeld();
  }
  syncListener();
  if (moved()) notify();
}

// ---------------------------------------------------------------- overlays

function isOpenLayer(id: LayerEntryId): boolean {
  return openLayers.some((layer) => layer.id === id);
}

function withoutOverlay(state: EdgHistoryState): EdgHistoryState {
  return { edg: 1, idx: state.idx, ...(state.y !== undefined ? { y: state.y } : {}) };
}

/** How many entries on top of `stacked` belong to overlays that are already closed. */
function closedOnTop(): number {
  let count = 0;
  while (count < stacked.length && !isOpenLayer(stacked[stacked.length - 1 - count])) {
    count += 1;
  }
  return count;
}

function trimClosedEntries(): void {
  const steps = closedOnTop();
  if (steps === 0) return;
  stacked = stacked.slice(0, stacked.length - steps);
  silentBack(steps);
}

/** The browser landed on `state`: every overlay above its entry closes, top first. */
function popLayersAbove(state: EdgHistoryState | null): void {
  const floor = state?.layer ?? 0;
  const popped = openLayers.filter((layer) => layer.id > floor);
  openLayers = openLayers.filter((layer) => layer.id <= floor);
  if (state !== null && state.layer !== undefined && !isOpenLayer(state.layer)) {
    // Forward onto an overlay that is gone: keep the entry, drop its overlay marks.
    window.history.replaceState(withoutOverlay(state), '', currentKey());
    stacked = [];
  } else {
    const at = stacked.indexOf(floor);
    stacked = floor === 0 ? [] : at >= 0 ? stacked.slice(0, at + 1) : [floor];
  }
  [...popped].reverse().forEach((layer) => layer.onPop());
}

/** Before any push (a route or an overlay): remember where the user was on the entry they are leaving (P1-2). */
function rememberScroll(state: EdgHistoryState | null): void {
  const y = window.scrollY;
  if (!Number.isFinite(y) || y < 0) return;
  window.history.replaceState({ ...(state ?? { edg: 1, idx: 0 }), y }, '', currentKey());
}

/** Runs after React has rendered the address the browser went back to (useSyncExternalStore renders synchronously). */
function restoreScroll(state: EdgHistoryState | null): void {
  const y = state?.y ?? 0;
  setTimeout(() => window.scrollTo(0, y), 0);
}

function onPopState(): void {
  if (silentBacks > 0) {
    onSilentPop();
    return;
  }
  const state = currentState();
  // A popstate that only moved the hash changes nothing here (spec §2.2: no hash routing).
  if (state === null && !moved()) return;
  popLayersAbove(state);
  syncListener();
  if (!moved()) return;
  notify();
  restoreScroll(state);
}

/**
 * P1-2: an overlay opened — push { edg, idx + 1, sheet, layer } at the same
 * address. `onPop` runs when the back button leaves that entry; the overlay is
 * then off the router's books, and if it stays open (a leave confirm stopped
 * it) it asks for a new entry (useHistoryLayer does).
 */
export function pushLayerEntry(name: string, onPop: () => void): LayerEntryId {
  const id = nextLayerEntryId;
  nextLayerEntryId += 1;
  openLayers = [...openLayers, { id, onPop }];
  syncListener();
  const sheet = name.slice(0, HISTORY_SHEET_NAME_MAX);
  whenSettled(() => {
    if (!isOpenLayer(id)) return;
    // A navigation from inside the overlay replaces this entry, so the page under it keeps its y here.
    rememberScroll(currentState());
    window.history.pushState({ edg: 1, idx: currentIndex() + 1, sheet, layer: id }, '', currentKey());
    stacked = [...stacked, id];
  });
  return id;
}

/** P1-2: an overlay closed from the UI — if its entry is still on top, walk back over it silently. */
export function dropLayerEntry(id: LayerEntryId): void {
  if (!isOpenLayer(id)) return;
  openLayers = openLayers.filter((layer) => layer.id !== id);
  whenSettled(trimClosedEntries);
  syncListener();
}

// ---------------------------------------------------------------- navigation

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

function applyNavigate(target: string, options: NavigateOptions): void {
  const replace = options.replace === true;
  if (!replace && target === currentKey()) return; // no duplicate entries
  const state = currentState();
  const idx = state?.idx ?? 0;
  const onOverlay = state?.layer !== undefined || state?.sheet !== undefined;
  // An overlay's entry is used up by the navigation; any below it are buried under the new one.
  stacked = [];
  if (replace || onOverlay) {
    window.history.replaceState({ edg: 1, idx }, '', target);
  } else {
    rememberScroll(state);
    window.history.pushState({ edg: 1, idx: idx + 1 }, '', target);
  }
  if (!replace && options.keepScroll !== true) window.scrollTo(0, 0);
  notify();
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
  whenSettled(() => applyNavigate(target, options));
}

/** Back through our own entries; from the first one, replace with `fallback` instead of leaving the site. */
export function goBack(fallback: string = HOME_PATH): void {
  whenSettled(() => {
    if (currentIndex() > 0) {
      window.history.back();
      return;
    }
    const url = new URL(fallback, window.location.origin);
    applyNavigate(keyOf(url.pathname, url.search), { replace: true });
  });
}

/**
 * Called from App's first useState initializer; idempotent (it reads
 * history.state, not a module flag, so StrictMode and repeated renders are
 * safe). P1-2: a fresh tab on a deep address gets one `/` underneath — a
 * reload finds the mark and pads nothing; an overlay that was open before the
 * reload is not reopened, its marks are dropped.
 */
export function bootRouter(): void {
  if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
  const here = currentKey();
  const state = currentState();
  if (state === null) {
    if (window.location.pathname === HOME_PATH) {
      window.history.replaceState({ edg: 1, idx: 0 }, '', here);
    } else {
      window.history.replaceState({ edg: 1, idx: 0 }, '', HOME_PATH);
      window.history.pushState({ edg: 1, idx: 1 }, '', here);
    }
    return;
  }
  const staleLayer = state.layer !== undefined && !isOpenLayer(state.layer);
  if (staleLayer || (state.sheet !== undefined && state.layer === undefined)) {
    window.history.replaceState(withoutOverlay(state), '', here);
  }
}

// ---------------------------------------------------------------- tests only

function clearModuleState(): void {
  listeners.clear();
  window.removeEventListener('popstate', onPopState);
  listening = false;
  snapshot = null;
  lastKey = '';
  openLayers = [];
  stacked = [];
  nextLayerEntryId = 1;
  silentBacks = 0;
  clearSilentTimer();
  held = [];
}

/** Tests only (tests/dom/setup.ts): forget everything, back to '/' with no state. */
export function resetRouterForTests(): void {
  clearModuleState();
  window.history.replaceState(null, '', HOME_PATH);
}

/** Tests only: what a reload leaves behind — the module forgets everything; the URL and history.state stay. */
export function simulateReloadForTests(): void {
  clearModuleState();
}
