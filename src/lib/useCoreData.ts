import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api';
import type { User } from '../types';
import { ALL_CORE_KEYS, loadInitialCore, reloadCore, type CoreData, type ReloadResult } from './coreData';
import { VISIBLE_KEYS, type CoreKey } from './coreKeys';
import { staleMessage } from './refreshPolicy';

export interface StaleInfo {
  /** loadedAt of the data still on screen. */
  since: number;
  message: string;
  /** Parts whose last fetch failed and that have not been fetched successfully since. */
  keys: readonly CoreKey[];
}

export type CoreState =
  | { status: 'loading' }
  /** Only when nothing was ever loaded. */
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      data: CoreData;
      /** Last successful refresh of everything the page shows (VISIBLE_KEYS), in ms. */
      loadedAt: number;
      /** A refresh failed: the old data stays on screen. */
      stale: StaleInfo | null;
    };

type ReadyState = Extract<CoreState, { status: 'ready' }>;

const LOAD_FAILED = '加载失败，请稍后重试';
/**
 * A GET that answers 503 means the site is down for maintenance (the hosting
 * gateway during a cutover). The worker's own READ_ONLY switch only refuses
 * writes (worker/routes.ts:180-191), so the page can still be read.
 */
const MAINTENANCE_STATUS = 503;

async function firstLoad(): Promise<CoreState> {
  try {
    const data = await loadInitialCore();
    return { status: 'ready', data, loadedAt: Date.now(), stale: null };
  } catch (err) {
    return { status: 'error', message: err instanceof ApiError ? err.message : LOAD_FAILED };
  }
}

/** Still stale after this refresh: what failed now, plus earlier failures it did not fetch again. */
function staleKeysAfter(prev: ReadyState, keys: readonly CoreKey[], failed: ReloadResult['failed']): CoreKey[] {
  const carried = (prev.stale?.keys ?? []).filter((key) => !keys.includes(key));
  return [...new Set([...carried, ...failed.map(({ key }) => key)])];
}

function afterReload(prev: ReadyState, keys: readonly CoreKey[], result: ReloadResult, now: number): ReadyState {
  const { data, failed } = result;
  const staleKeys = staleKeysAfter(prev, keys, failed);
  if (staleKeys.length === 0) {
    // Refreshing only the report or config says nothing about how old the board is.
    const loadedAt = VISIBLE_KEYS.every((key) => keys.includes(key)) ? now : prev.loadedAt;
    return { status: 'ready', data, loadedAt, stale: null };
  }
  if (failed.length === 0 && prev.stale) {
    // Other parts came in fine; what failed before is still old, so the notice stays.
    return { ...prev, data, stale: { ...prev.stale, keys: staleKeys } };
  }
  const maintenance = failed.some(({ error }) => error instanceof ApiError && error.status === MAINTENANCE_STATUS);
  const message = staleMessage(prev.loadedAt, now, maintenance);
  return { ...prev, data, stale: { since: prev.loadedAt, message, keys: staleKeys } };
}

/** Runs tasks one at a time, in call order; a failed task does not block the next one. */
function useSerialQueue(): (task: () => Promise<void>) => Promise<void> {
  const tail = useRef<Promise<void>>(Promise.resolve());
  return useCallback((task: () => Promise<void>): Promise<void> => {
    const run = tail.current.then(task);
    tail.current = run.catch(() => undefined);
    return run;
  }, []);
}

export interface CoreDataApi {
  state: CoreState;
  /** No keys = ALL_CORE_KEYS. With data on screen a failure only sets `stale`. */
  refresh: (keys?: readonly CoreKey[]) => Promise<void>;
  /** Optimistic local update after OnboardingDialog saves. */
  setMe: (user: User) => void;
}

/** The home page's data, refreshed by key; a failed refresh keeps what is on screen. */
export function useCoreData(): CoreDataApi {
  const [state, setState] = useState<CoreState>({ status: 'loading' });
  // What the next refresh starts from — set together with setState, so a queued
  // refresh never reads a value React has not rendered yet.
  const latest = useRef<CoreState>(state);
  const started = useRef(false);
  const enqueue = useSerialQueue();

  const commit = useCallback((next: CoreState): void => {
    latest.current = next;
    setState(next);
  }, []);

  // One at a time: each refresh starts from what the previous one left, so two
  // overlapping refreshes cannot put back each other's older parts. (A setMe
  // during a refresh is overwritten by it; callers refresh 'me' after setMe.)
  const refresh = useCallback(
    (keys: readonly CoreKey[] = ALL_CORE_KEYS): Promise<void> =>
      enqueue(async () => {
        const current = latest.current;
        if (current.status !== 'ready') {
          commit(await firstLoad());
          return;
        }
        const result = await reloadCore(current.data, keys);
        commit(afterReload(current, keys, result, Date.now()));
      }),
    [enqueue, commit],
  );

  const setMe = useCallback(
    (user: User): void => {
      const current = latest.current;
      if (current.status !== 'ready') return;
      commit({ ...current, data: { ...current.data, me: user } });
    },
    [commit],
  );

  useEffect(() => {
    // StrictMode runs mount effects twice in development; load once.
    if (started.current) return;
    started.current = true;
    void refresh();
  }, [refresh]);

  return { state, refresh, setMe };
}
