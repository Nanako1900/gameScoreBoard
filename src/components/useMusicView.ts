import { useCallback, useEffect, useRef, useState } from 'react';
import type { MusicView } from '@shared/music';
import { ApiError } from '../api';
import { serverClockOffset } from '../lib/musicFormat';
import { musicApi } from '../music-api';

export const MUSIC_POLL_MS = 2000;
const GONE_STATUSES: readonly number[] = [401, 403, 404];
const FALLBACK_MESSAGE = '音乐播放器暂不可用，请重试';

export interface MusicProblem {
  status: number;
  message: string;
}

export interface FailOptions {
  /** Whether a 404 means the room itself is gone. Search and login endpoints use 404 for other things. */
  notFoundIsGone?: boolean;
}

export type FailHandler = (cause: unknown, options?: FailOptions) => string;

/** A view as it arrived: when, in browser-versus-server clock terms, and how many views came before it. */
interface Received {
  view: MusicView;
  /** Counts every view accepted since the page opened; lets a command see that a poll has answered. */
  seq: number;
  clockOffsetMs: number;
}

export interface MusicViewHandle {
  view: MusicView | null;
  seq: number;
  /** Add to `Date.now()` to get the server's time. */
  clockOffsetMs: number;
  problem: MusicProblem | null;
  reload: () => void;
  /** Use a view returned by a write, and drop any older read still in flight. */
  applyView: (next: MusicView) => void;
  fail: FailHandler;
}

export function errorMessage(cause: unknown): string {
  return cause instanceof Error && cause.message ? cause.message : FALLBACK_MESSAGE;
}

function isGone(cause: unknown, notFoundIsGone: boolean): cause is ApiError {
  if (!(cause instanceof ApiError) || !GONE_STATUSES.includes(cause.status)) return false;
  return cause.status !== 404 || notFoundIsGone;
}

/** Polls the player view while the tab is visible; stale responses never overwrite newer ones. */
export function useMusicView(roomRef: string): MusicViewHandle {
  const [received, setReceived] = useState<Received | null>(null);
  const [problem, setProblem] = useState<MusicProblem | null>(null);
  const epoch = useRef(0);
  const inflight = useRef<AbortController | null>(null);
  const blocked = useRef(false);

  const accept = useCallback((next: MusicView) => {
    const clockOffsetMs = serverClockOffset(next.serverNow, Date.now());
    setReceived((previous) => ({ view: next, seq: (previous?.seq ?? 0) + 1, clockOffsetMs }));
  }, []);

  const block = useCallback((cause: ApiError) => {
    epoch.current += 1;
    inflight.current?.abort();
    inflight.current = null;
    blocked.current = true;
    setReceived(null);
    setProblem({ status: cause.status, message: errorMessage(cause) });
  }, []);

  const reload = useCallback(() => {
    inflight.current?.abort();
    const abort = new AbortController();
    inflight.current = abort;
    epoch.current += 1;
    const mine = epoch.current;
    const stale = (): boolean => abort.signal.aborted || epoch.current !== mine;
    musicApi
      .view(roomRef, abort.signal)
      .then((next) => {
        if (stale()) return;
        blocked.current = false;
        accept(next);
        setProblem(null);
      })
      .catch((cause: unknown) => {
        if (stale()) return;
        if (isGone(cause, true)) block(cause);
        else setProblem({ status: cause instanceof ApiError ? cause.status : 0, message: errorMessage(cause) });
      })
      .finally(() => {
        if (inflight.current === abort) inflight.current = null;
      });
  }, [roomRef, block, accept]);

  const applyView = useCallback((next: MusicView) => {
    epoch.current += 1;
    inflight.current?.abort();
    inflight.current = null;
    blocked.current = false;
    accept(next);
    setProblem(null);
  }, [accept]);

  const fail = useCallback<FailHandler>(
    (cause, options) => {
      if (isGone(cause, options?.notFoundIsGone ?? true)) block(cause);
      return errorMessage(cause);
    },
    [block],
  );

  useEffect(() => {
    reload();
    const tick = setInterval(() => {
      const idle = inflight.current === null && !blocked.current;
      if (document.visibilityState === 'visible' && idle) reload();
    }, MUSIC_POLL_MS);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') reload();
    };
    window.addEventListener('focus', reload);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(tick);
      window.removeEventListener('focus', reload);
      document.removeEventListener('visibilitychange', onVisible);
      inflight.current?.abort();
      epoch.current += 1;
    };
  }, [reload]);

  return { view: received?.view ?? null, seq: received?.seq ?? 0, clockOffsetMs: received?.clockOffsetMs ?? 0, problem, reload, applyView, fail };
}
