// Keeps one Discord snapshot in memory and refreshes it on a timer.
//
// This replaces the discord-share Worker's Cache API layer (refresh lease,
// in-isolate singleflight, negative cache, stale-while-revalidate, write
// repair). All of that existed because every Cloudflare data centre and isolate
// held its own short-lived copy with no compare-and-swap. One long-lived Node
// process holds exactly one copy, so a timer-driven refresh plus an in-process
// singleflight gives the same guarantee: Discord is called at most once per
// interval, however much traffic arrives — and requests never wait on Discord
// once the first load has finished.

import { publicSnapshot, type GuildSnapshot, type StoredSnapshot } from './snapshot';

export const REFRESH_INTERVAL_MS = 60_000;
/** Older than this, a snapshot is flagged stale (the page then shows 「数据可能有延迟」). */
export const STALE_MS = 600_000;

/** The first load is still running; retry shortly. */
export class UpstreamLoadingError extends Error {
  override name = 'UpstreamLoadingError';
}

/** Nothing has loaded yet and the last attempt failed (already reported via onError). */
export class UpstreamFailedError extends Error {
  override name = 'UpstreamFailedError';
}

/** Rejections from get() that need no further logging. */
export function isReportedLoadError(error: unknown): boolean {
  return error instanceof UpstreamLoadingError || error instanceof UpstreamFailedError;
}

export interface SnapshotPoller {
  /** Load now, then every interval. Idempotent. */
  start(): void;
  stop(): void;
  /**
   * The snapshot for a request: public fields only, stale flag set. Waits for
   * the first load if it is still running. Rejects with UpstreamFailedError
   * only while nothing has ever loaded.
   */
  get(): Promise<GuildSnapshot>;
  /** Refresh now, joining a refresh already in flight. Never rejects. */
  refresh(): Promise<void>;
}

export interface PollerOptions {
  /** Receives the previous snapshot so a partial upstream failure keeps its data. */
  load: (previous: StoredSnapshot | null) => Promise<StoredSnapshot>;
  intervalMs?: number;
  now?: () => number;
  /** The single place refresh failures are reported, once each. */
  onError?: (error: unknown) => void;
}

export function createPoller(options: PollerOptions): SnapshotPoller {
  const intervalMs = options.intervalMs ?? REFRESH_INTERVAL_MS;
  const now = options.now ?? Date.now;
  const onError = options.onError ?? (() => undefined);

  let snapshot: StoredSnapshot | null = null;
  let inflight: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function runRefresh(): Promise<void> {
    try {
      // A failed refresh never touches the snapshot: old data beats no data.
      snapshot = await options.load(snapshot);
    } catch (error) {
      onError(error);
    }
  }

  function refresh(): Promise<void> {
    if (inflight) return inflight;
    const flight = runRefresh();
    inflight = flight;
    // Cleared only if still the current flight, and only after it settled — a
    // load that throws synchronously must not leave a settled flight pinned.
    void flight.finally(() => {
      if (inflight === flight) inflight = null;
    });
    return flight;
  }

  function present(stored: StoredSnapshot): GuildSnapshot {
    const age = now() - Date.parse(stored.fetchedAt);
    return { ...publicSnapshot(stored), stale: age > STALE_MS };
  }

  return {
    start() {
      if (timer) return;
      void refresh();
      timer = setInterval(() => void refresh(), intervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    async get() {
      if (snapshot) return present(snapshot);
      if (inflight) await inflight;
      if (snapshot) return present(snapshot);
      throw new UpstreamFailedError('Discord data unavailable');
    },
    refresh,
  };
}
