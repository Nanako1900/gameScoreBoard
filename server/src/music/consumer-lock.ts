// Only one music process may consume a guild's commands. The holder keeps a
// session-level PostgreSQL advisory lock on a dedicated connection; any other
// instance stays idle and retries, so a second container is harmless.

/** Advisory lock class for the music bot ("musi"); the guild picks the key. */
export const MUSIC_LOCK_CLASS = 0x6d757369;
export const MUSIC_LOCK_RETRY_MS = 30_000;
const LOCK_SQL = 'SELECT pg_try_advisory_lock($1::int4, hashtext($2)) AS granted';

export interface MusicLockClient {
  connect(): Promise<unknown>;
  query(sql: string, params: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  end(): Promise<unknown>;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'end', listener: () => void): unknown;
}

export interface MusicLockOptions {
  guildId: string;
  connect(): MusicLockClient;
  onAcquired(): void;
  /** The holding connection broke: the lock is gone and another process may take over. */
  onLost(error: Error | null): void;
  onWaiting(): void;
  onError(error: unknown): void;
  /** Defaults to setTimeout; returns a cancel function. */
  schedule?: (fn: () => void, ms: number) => () => void;
}

const nodeSchedule = (fn: () => void, ms: number): (() => void) => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};

export function musicLockKey(guildId: string): string {
  return `music:${guildId}`;
}

export function holdMusicLock(options: MusicLockOptions): { stop(): Promise<void> } {
  const schedule = options.schedule ?? nodeSchedule;
  let stopped = false;
  let held: MusicLockClient | null = null;
  let cancelRetry: (() => void) | null = null;

  const retryLater = (): void => {
    if (stopped) return;
    cancelRetry = schedule(() => {
      cancelRetry = null;
      void attempt();
    }, MUSIC_LOCK_RETRY_MS);
  };

  function watch(client: MusicLockClient): void {
    let reported = false;
    const lost = (error: Error | null): void => {
      if (reported || stopped || held !== client) return;
      reported = true;
      held = null;
      options.onLost(error);
    };
    client.on('error', (error) => lost(error));
    client.on('end', () => lost(null));
  }

  async function attempt(): Promise<void> {
    if (stopped) return;
    const client = options.connect();
    // Attached before connecting: an unhandled 'error' would crash the process.
    client.on('error', () => undefined);
    try {
      await client.connect();
      const result = await client.query(LOCK_SQL, [MUSIC_LOCK_CLASS, musicLockKey(options.guildId)]);
      if (result.rows[0]?.granted === true && !stopped) {
        held = client;
        watch(client);
        options.onAcquired();
        return;
      }
      if (!stopped) options.onWaiting();
    } catch (error) {
      options.onError(error);
    }
    await client.end().catch(() => undefined);
    retryLater();
  }

  void attempt();
  return {
    async stop() {
      stopped = true;
      cancelRetry?.();
      const client = held;
      held = null;
      // Closing the session releases the advisory lock.
      await client?.end().catch(() => undefined);
    },
  };
}
