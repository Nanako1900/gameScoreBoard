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

/** A single departure decision. A disposed guard invalidates both callbacks. */
export interface NavigationAttempt {
  proceed: () => void;
  cancel: () => void;
}

export type NavigationGuard = (attempt: NavigationAttempt) => void;

interface GuardRegistration {
  readonly guard: NavigationGuard;
  readonly key: string;
}

interface HistoryEntry {
  readonly location: RouterLocation;
  readonly state: EdgHistoryState | null;
  readonly scrollY: number;
}

interface PendingNavigation {
  readonly owner: GuardRegistration;
  readonly origin: HistoryEntry;
  readonly action: () => void;
  restoring: boolean;
  asked: boolean;
  decision: 'proceed' | 'cancel' | null;
}

interface PermittedPop {
  readonly idx: number;
  readonly key?: string;
}

const listeners = new Set<Listener>();
let snapshot: RouterLocation | null = null;
let listening = false;
/** pathname + search the subscribers were last told about (P1-2: tracked even with no subscriber). */
let lastKey = '';
/** The last route/overlay entry accepted by the store, before a browser traversal. */
let committedEntry: HistoryEntry | null = null;
/** The page entry below any real overlays, which must close before a page asks. */
let committedPageEntry: HistoryEntry | null = null;
const navigationGuards: GuardRegistration[] = [];
let pendingNavigation: PendingNavigation | null = null;
/** A confirmed programmatic Back or a replay of a confirmed browser traversal. */
let permittedPop: PermittedPop | null = null;

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

function rawLocation(): RouterLocation {
  const { pathname, search } = window.location;
  return { pathname, search, route: parseRoute(pathname) };
}

function captureEntry(): HistoryEntry {
  return { location: rawLocation(), state: currentState(), scrollY: window.scrollY };
}

function commitEntry(): void {
  committedEntry = captureEntry();
  if (committedEntry.state?.layer === undefined && committedEntry.state?.sheet === undefined) {
    committedPageEntry = committedEntry;
  }
}

function readLocation(): RouterLocation {
  // A pop cannot be cancelled. Until its original entry is restored, every
  // render (not just store subscribers) must keep seeing the mounted editor.
  if (pendingNavigation !== null) return pendingNavigation.origin.location;
  const { pathname, search } = window.location;
  if (snapshot === null || keyOf(snapshot.pathname, snapshot.search) !== keyOf(pathname, search)) {
    snapshot = { pathname, search, route: parseRoute(pathname) };
  }
  return snapshot;
}

function notify(): void {
  lastKey = currentKey();
  commitEntry();
  listeners.forEach((listener) => listener());
}

/** Did pathname + search change since the last notify? A hash-only move does not count. */
function moved(): boolean {
  return currentKey() !== lastKey;
}

// ---------------------------------------------------------------- the popstate listener

/** One window listener for the whole module, only while someone needs it (P1-2: open overlays and silent backs too). */
function syncListener(): void {
  const needed = listeners.size > 0 || openLayers.length > 0 || silentBacks > 0
    || navigationGuards.length > 0 || pendingNavigation !== null || permittedPop !== null;
  if (needed && !listening) {
    lastKey = currentKey();
    if (pendingNavigation === null) commitEntry();
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
  if (silentBacks === 0 && pendingNavigation === null) {
    write();
    return;
  }
  held = [...held, write];
}

function flushHeld(): void {
  while (silentBacks === 0 && pendingNavigation === null && held.length > 0) {
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
  if (moved()) {
    // A user traversal can overtake an overlay's queued cleanup. It has
    // already passed the closed overlays: protect the page before publishing
    // that route or running writes that were waiting for the cleanup.
    silentBacks = 0;
    clearSilentTimer();
    if (guardBrowserPop(captureEntry())) { syncListener(); return; }
  } else {
    // A queued navigation may immediately ask its guard in flushHeld(). Keep
    // the accepted page index current before that question freezes the store.
    commitEntry();
  }
  if (silentBacks === 0) {
    clearSilentTimer();
    flushHeld();
  }
  syncListener();
  if (moved()) notify();
  else if (pendingNavigation === null) commitEntry();
}

// ---------------------------------------------------------------- page departure guards

function activeGuard(): GuardRegistration | null {
  const key = currentKey();
  for (let i = navigationGuards.length - 1; i >= 0; i -= 1) {
    if (navigationGuards[i].key === key) return navigationGuards[i];
  }
  return null;
}

function sameEntry(entry: HistoryEntry): boolean {
  return keyOf(entry.location.pathname, entry.location.search) === currentKey()
    && entry.state?.idx === currentState()?.idx;
}

function completeDecision(pending: PendingNavigation): void {
  if (pendingNavigation !== pending || pending.restoring || pending.decision === null) return;
  pendingNavigation = null;
  if (pending.decision === 'proceed') whenSettled(pending.action);
  flushHeld();
  syncListener();
}

function askGuard(pending: PendingNavigation): void {
  if (pendingNavigation !== pending || pending.asked || pending.restoring) return;
  if (!navigationGuards.includes(pending.owner)) {
    pending.decision = 'cancel';
    completeDecision(pending);
    return;
  }
  pending.asked = true;
  const decide = (decision: 'proceed' | 'cancel'): void => {
    if (pendingNavigation !== pending || pending.decision !== null) return;
    if (!navigationGuards.includes(pending.owner)) return;
    pending.decision = decision;
    completeDecision(pending);
  };
  pending.owner.guard({ proceed: () => decide('proceed'), cancel: () => decide('cancel') });
}

/** Restore the exact existing entry; never push a sentinel or replace a neighbour. */
function restoreGuardedEntry(pending: PendingNavigation): void {
  if (sameEntry(pending.origin)) {
    pending.restoring = false;
    commitEntry();
    if (Number.isFinite(pending.origin.scrollY)) window.scrollTo(0, pending.origin.scrollY);
    if (pending.decision !== null) completeDecision(pending);
    else askGuard(pending);
    return;
  }
  const here = currentState();
  const origin = pending.origin.state;
  if (here === null || origin === null || here.idx === origin.idx) return;
  pending.restoring = true;
  window.history.go(origin.idx - here.idx);
}

function guardBrowserPop(target: HistoryEntry): boolean {
  const owner = activeGuardForCommittedEntry();
  const origin = committedPageEntry ?? committedEntry;
  // Every in-document route written by this router is marked. A traversal to
  // another document is protected by the hook's native beforeunload handler.
  if (owner === null || origin === null || origin.state === null || target.state === null
    || origin.state.idx === target.state.idx) return false;
  const pending: PendingNavigation = {
    owner,
    origin: { ...origin, scrollY: window.scrollY },
    action: () => {
      const delta = target.state!.idx - currentIndex();
      if (delta === 0) return;
      permittedPop = { idx: target.state!.idx, key: keyOf(target.location.pathname, target.location.search) };
      syncListener();
      window.history.go(delta);
    },
    restoring: true,
    asked: false,
    decision: null,
  };
  pendingNavigation = pending;
  // A jump over several entries can skip a real overlay and the page in one
  // go. Close the skipped overlays first, so an inline page question is not
  // hidden behind their inert/focus trap; restore the underlying page entry.
  if (openLayers.length > 0) popLayersAbove(target.state);
  restoreGuardedEntry(pending);
  return true;
}

function activeGuardForCommittedEntry(): GuardRegistration | null {
  const entry = committedPageEntry ?? committedEntry;
  if (entry === null) return null;
  const key = keyOf(entry.location.pathname, entry.location.search);
  for (let i = navigationGuards.length - 1; i >= 0; i -= 1) {
    if (navigationGuards[i].key === key) return navigationGuards[i];
  }
  return null;
}

/** The last mounted page guard wins. Disposal cancels its pending departure. */
export function registerNavigationGuard(guard: NavigationGuard): () => void {
  const registration: GuardRegistration = { guard, key: currentPath() };
  navigationGuards.push(registration);
  syncListener();
  return () => {
    const index = navigationGuards.indexOf(registration);
    if (index < 0) return;
    navigationGuards.splice(index, 1);
    const pending = pendingNavigation;
    if (pending?.owner === registration) {
      pending.decision = 'cancel';
      completeDecision(pending);
    }
    syncListener();
  };
}

/** Ask the current page before an action that leaves it, including logout. */
export function requestNavigation(action: () => void): void {
  // One confirmation owns one target; double clicks cannot replace or queue it.
  if (pendingNavigation !== null) return;
  whenSettled(() => {
    if (pendingNavigation !== null) return;
    const owner = activeGuard();
    if (owner === null) {
      action();
      return;
    }
    const pending: PendingNavigation = {
      owner, origin: captureEntry(), action, restoring: false, asked: false, decision: null,
    };
    pendingNavigation = pending;
    askGuard(pending);
  });
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
  if (pendingNavigation !== null) {
    // A second Back while the question is open is restored as well; the first
    // requested target remains the one the user will approve or cancel.
    restoreGuardedEntry(pendingNavigation);
    return;
  }
  if (silentBacks > 0) {
    onSilentPop();
    return;
  }
  const state = currentState();
  // A popstate that only moved the hash changes nothing here (spec §2.2: no hash routing).
  if (state === null && !moved()) return;
  const allowed = permittedPop;
  permittedPop = null;
  const confirmed = allowed !== null && state?.idx === allowed.idx
    && (allowed.key === undefined || currentKey() === allowed.key);
  if (moved() && !confirmed && guardBrowserPop(captureEntry())) return;
  popLayersAbove(state);
  syncListener();
  if (!moved()) { commitEntry(); return; }
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
  const ownerPath = currentPath();
  whenSettled(() => {
    if (!isOpenLayer(id) || currentKey() !== ownerPath) return;
    // A navigation from inside the overlay replaces this entry, so the page under it keeps its y here.
    rememberScroll(currentState());
    window.history.pushState({ edg: 1, idx: currentIndex() + 1, sheet, layer: id }, '', currentKey());
    stacked = [...stacked, id];
    commitEntry();
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
  const location = readLocation();
  return keyOf(location.pathname, location.search);
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
    requestNavigation(() => window.location.assign(path));
    return;
  }
  const target = keyOf(url.pathname, url.search);
  if (target === currentPath()) {
    // Canonical same-address replacements may consume an overlay entry, but
    // they do not leave the editor and must not open a departure question.
    if (options.replace === true) whenSettled(() => applyNavigate(target, options));
    return;
  }
  requestNavigation(() => applyNavigate(target, options));
}

/** Back through our own entries; from the first one, replace with `fallback` instead of leaving the site. */
export function goBack(fallback: string = HOME_PATH): void {
  const action = (): void => {
    if (currentIndex() > 0) {
      permittedPop = { idx: currentIndex() - 1 };
      syncListener();
      window.history.back();
      return;
    }
    const url = new URL(fallback, window.location.origin);
    applyNavigate(keyOf(url.pathname, url.search), { replace: true });
  };
  // An actual top overlay keeps the old back-closes-layer semantics.
  const layer = currentState()?.layer;
  if (layer !== undefined && isOpenLayer(layer)) whenSettled(action);
  else requestNavigation(action);
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
    commitEntry();
    return;
  }
  const staleLayer = state.layer !== undefined && !isOpenLayer(state.layer);
  if (staleLayer || (state.sheet !== undefined && state.layer === undefined)) {
    window.history.replaceState(withoutOverlay(state), '', here);
  }
  commitEntry();
}

// ---------------------------------------------------------------- tests only

function clearModuleState(): void {
  listeners.clear();
  window.removeEventListener('popstate', onPopState);
  listening = false;
  snapshot = null;
  lastKey = '';
  committedEntry = null;
  committedPageEntry = null;
  navigationGuards.splice(0);
  pendingNavigation = null;
  permittedPop = null;
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
