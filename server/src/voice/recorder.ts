// Durable voice evidence. Live events and reconciliation share per-person
// queues; coverage is advanced only behind a successful write barrier.
import type pg from 'pg';
import { VOICE_HEARTBEAT_MS, VOICE_RETENTION_DAYS } from '../../../shared/voice';
import { checkOut } from '../db/d1';
import { planReconcile, planVoiceUpdate, type VoiceAction } from './plan';

export interface VoicePresent { discordUserId: string; channelId: string; channelName: string }
export interface VoiceUpdate {
  discordUserId: string;
  prevChannelId: string | null;
  nextChannelId: string | null;
  nextChannelName: string | null;
}
export interface VoiceStatus {
  coverage_since: string | null;
  degraded: boolean;
  open_segments: number | null;
  last_error: string | null;
}
export interface VoiceRecorder {
  onVoiceUpdate(input: VoiceUpdate): Promise<void>;
  reconcile(): Promise<void>;
  heartbeat(): Promise<void>;
  resume(): Promise<void>;
  cleanup(): Promise<void>;
  start(): void;
  stop(): Promise<void>;
  status(): Promise<VoiceStatus>;
}
export interface VoiceRecorderDeps {
  pool: pg.Pool;
  /** null means no complete, available target-guild snapshot. */
  getPresent: () => readonly VoicePresent[] | null;
  isReady: () => boolean;
  now?: () => number;
  log?: Pick<Console, 'log' | 'warn' | 'error'>;
}
interface Binding { user_id: string }
interface OpenRow { discordUserId: string; channelId: string }
interface Coverage { id: number; started_at: string; last_seen_at: string }
type Result<T> = { ok: true; value: T } | { ok: false };
const HOUR_MS = 3_600_000;
const FAILURE = 'Voice recorder unavailable; waiting for reconciliation';
const utc = (millis: number): string => new Date(Math.floor(millis / 1000) * 1000).toISOString().slice(0, 19).replace('T', ' ');
const millis = (text: string): number => Date.parse(text.replace(' ', 'T') + 'Z');

export function createVoiceRecorder(deps: VoiceRecorderDeps): VoiceRecorder {
  const { pool, getPresent, isReady } = deps;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? console;
  const people = new Map<string, Promise<void>>();
  let controls: Promise<void> = Promise.resolve();
  let generation = 0;
  let current: Coverage | null = null;
  let degraded = false;
  let lastError: string | null = null;
  let stopped = false;
  let reconciling: Promise<void> | null = null;
  let again = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let cleanupTimer: ReturnType<typeof setInterval> | null = null;

  function fail(context: string, error: unknown): void {
    generation += 1;
    current = null;
    degraded = true;
    // A pg error can contain parameter values. Only the private server log
    // gets the original; /status never receives identifiers or SQL details.
    lastError = FAILURE;
    log.error(`voice ${context} failed`, error);
  }
  async function attempt<T>(context: string, work: () => Promise<T>): Promise<Result<T>> {
    try { return { ok: true, value: await work() }; }
    catch (error) { fail(context, error); return { ok: false }; }
  }
  function control<T>(context: string, work: () => Promise<T>): Promise<Result<T>> {
    const job = controls.then(() => attempt(context, work));
    controls = job.then(() => undefined);
    return job;
  }
  function person<T>(discordUserId: string, work: () => Promise<T>): Promise<Result<T>> {
    const previous = people.get(discordUserId) ?? Promise.resolve();
    const job = previous.then(() => attempt('event', work));
    const tail = job.then(() => undefined);
    people.set(discordUserId, tail);
    void tail.then(() => { if (people.get(discordUserId) === tail) people.delete(discordUserId); });
    return job;
  }
  async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const checked = await checkOut(pool);
    try {
      await checked.client.query('BEGIN');
      const result = await work(checked.client);
      await checked.client.query('COMMIT');
      return result;
    } catch (error) {
      if (!checked.broken) await checked.client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { checked.release(); }
  }
  async function binding(client: pg.PoolClient, discordUserId: string): Promise<Binding | null> {
    // The API deletes this same row before closing old segments. Holding it
    // through INSERT means an unlink either prevents the open or closes it.
    const result = await client.query<Binding>('SELECT user_id FROM discord_links WHERE discord_user_id = $1 FOR UPDATE', [discordUserId]);
    return result.rows[0] ?? null;
  }
  async function actions(client: pg.PoolClient, planned: readonly VoiceAction[], linked: Binding | null,
    previousSeen: string | null = null): Promise<void> {
    let closedAt: string | null = null;
    for (const action of planned) {
      if (action.kind === 'close') {
        if (action.reason === 'bot_offline') {
          const closed = await client.query<{ left_at: string }>(`UPDATE voice_sessions
            SET left_at = GREATEST(joined_at, COALESCE($2::text, joined_at)), end_reason = 'bot_offline'
            WHERE discord_user_id = $1 AND left_at IS NULL RETURNING left_at`, [action.discordUserId, previousSeen]);
          closedAt = closed.rows[0]?.left_at ?? closedAt;
        } else {
          const closed = await client.query<{ left_at: string }>(`UPDATE voice_sessions
            SET left_at = GREATEST(joined_at, datetime('now')), end_reason = $2
            WHERE discord_user_id = $1 AND left_at IS NULL RETURNING left_at`, [action.discordUserId, action.reason]);
          closedAt = closed.rows[0]?.left_at ?? closedAt;
        }
      } else if (linked) {
        await client.query(`INSERT INTO voice_sessions
          (user_id, discord_user_id, channel_id, channel_name, joined_at, start_reason)
          VALUES ($1, $2, $3, $4, GREATEST(datetime('now'), $6::text), $5) ON CONFLICT DO NOTHING`,
        [linked.user_id, action.discordUserId, action.channelId, action.channelName, action.reason, closedAt]);
      }
    }
  }
  /** Capture before waiting for a pool connection or the write barrier. */
  async function cutoff(admittedAt: number): Promise<string> {
    const value = await pool.query<{ at: string }>("SELECT datetime('now') AS at");
    return utc(Math.min(admittedAt, millis(value.rows[0].at)));
  }
  async function barrier(): Promise<void> {
    // Capture once: later arrivals lie after the already-frozen cutoff and
    // must not keep postponing this heartbeat forever.
    await Promise.all([...people.values()]);
  }
  async function newCoverage(expected: number, admittedAt: number, requireReady: boolean): Promise<void> {
    if (stopped || generation !== expected || getPresent() === null || (requireReady && !isReady())) return;
    const at = await cutoff(admittedAt);
    await barrier();
    if (stopped || generation !== expected || getPresent() === null || (requireReady && !isReady())) return;
    const result = await pool.query<Coverage>(`INSERT INTO voice_coverage (started_at, last_seen_at)
      VALUES ($1, $1) RETURNING id, started_at, last_seen_at`, [at]);
    // A different person's failed in-flight event must not revive this cursor.
    if (!stopped && generation === expected && getPresent() !== null && (!requireReady || isReady())) {
      current = result.rows[0]; degraded = false; lastError = null;
    }
  }

  async function onVoiceUpdate(input: VoiceUpdate): Promise<void> {
    if (stopped) return;
    await person(input.discordUserId, async () => {
      if (stopped) return;
      await transaction(async (client) => {
        const linked = await binding(client, input.discordUserId);
        const planned = planVoiceUpdate({ channelId: input.prevChannelId },
          { channelId: input.nextChannelId, channelName: input.nextChannelName }, input.discordUserId, linked !== null);
        await actions(client, planned, linked);
      });
    });
  }

  async function reconcileRound(): Promise<void> {
    const expected = ++generation;
    current = null;
    // Serialized after any older coverage UPDATE, so the uncertain close uses
    // the last durable checkpoint rather than an earlier concurrent snapshot.
    const snapshot = await control('reconcile read', async () => {
      const open = await pool.query<OpenRow>('SELECT discord_user_id AS "discordUserId", channel_id AS "channelId" FROM voice_sessions WHERE left_at IS NULL');
      const previous = await pool.query<{ last_seen_at: string }>('SELECT last_seen_at FROM voice_coverage ORDER BY id DESC LIMIT 1');
      const linked = await pool.query<{ discord_user_id: string }>('SELECT discord_user_id FROM discord_links');
      return { open: open.rows, previousSeen: previous.rows[0]?.last_seen_at ?? null,
        bound: new Set(linked.rows.map((row) => row.discord_user_id)) };
    });
    if (!snapshot.ok || stopped || generation !== expected) return;
    const present = getPresent();
    if (present === null) return;
    const { open, previousSeen, bound } = snapshot.value;
    const planned = planReconcile(open, present, bound);
    // Include pending live users too: they may not have committed their open
    // yet and therefore occur in neither snapshot open rows nor present cache.
    const ids = new Set([...planned.map((action) => action.discordUserId), ...open.map((row) => row.discordUserId),
      ...present.map((row) => row.discordUserId), ...people.keys()]);
    const writes = [...ids].map((id) => person(id, async () => {
      if (stopped) return false;
      return transaction(async (client) => {
        const linked = await binding(client, id);
        const latest = await client.query<OpenRow>('SELECT discord_user_id AS "discordUserId", channel_id AS "channelId" FROM voice_sessions WHERE discord_user_id = $1 AND left_at IS NULL FOR UPDATE', [id]);
        const cache = getPresent();
        if (cache === null) return false;
        // Both facts are re-read after this person's earlier live events and
        // after acquiring the binding lock: stale planned closes cannot close
        // the newer channel, and someone who left is not opened from old cache.
        const fresh = cache.filter((row) => row.discordUserId === id);
        await actions(client, planReconcile(latest.rows, fresh, linked ? new Set([id]) : new Set()), linked, previousSeen);
        return true;
      });
    }));
    const results = await Promise.all(writes);
    if (results.some((result) => !result.ok || !result.value) || stopped || generation !== expected || getPresent() === null) return;
    const admittedAt = now();
    await control('reconcile coverage', () => newCoverage(expected, admittedAt, false));
  }
  function reconcile(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (reconciling) { again = true; return reconciling; }
    const loop = async (): Promise<void> => {
      do { again = false; await reconcileRound(); } while (again && !stopped);
    };
    const job = loop(); reconciling = job;
    void job.then(() => { if (reconciling === job) reconciling = null; }, (error: unknown) => {
      fail('reconcile', error); if (reconciling === job) reconciling = null;
    });
    return job;
  }
  async function heartbeat(): Promise<void> {
    if (stopped || !isReady() || getPresent() === null) return;
    if (degraded) { await reconcile(); return; }
    const expected = generation;
    const interval = current;
    if (!interval) return;
    const admittedAt = now();
    await control('heartbeat', async () => {
      if (stopped || generation !== expected || degraded || current?.id !== interval.id || !isReady() || getPresent() === null) return;
      const at = await cutoff(admittedAt);
      await barrier();
      if (stopped || generation !== expected || degraded || current?.id !== interval.id || !isReady() || getPresent() === null) return;
      const updated = await pool.query('UPDATE voice_coverage SET last_seen_at = GREATEST(last_seen_at, $2::text) WHERE id = $1', [interval.id, at]);
      if (updated.rowCount !== 1) throw new Error('Voice coverage checkpoint no longer exists');
      if (!stopped && generation === expected && current?.id === interval.id && !degraded) current = { ...interval, last_seen_at: at > interval.last_seen_at ? at : interval.last_seen_at };
    });
  }
  async function resume(): Promise<void> {
    // Let the rest of the synchronous ShardResume listeners publish ready.
    await Promise.resolve();
    if (stopped || degraded || !isReady() || getPresent() === null || !current) return;
    if (now() - millis(current.last_seen_at) <= 2 * VOICE_HEARTBEAT_MS) return;
    const expected = ++generation;
    current = null;
    const admittedAt = now();
    // Resume replays events itself: do not reconcile or synthesize offline ends.
    await control('resume coverage', () => newCoverage(expected, admittedAt, true));
  }
  async function cleanup(): Promise<void> {
    if (stopped) return;
    const result = await control('retention cleanup', () => transaction(async (client) => {
      const bounds = await client.query<{ at: string; cutoff: string }>(
        "SELECT datetime('now') AS at, datetime('now', $1) AS cutoff", [`-${VOICE_RETENTION_DAYS} days`]);
      const { at, cutoff: expiredBefore } = bounds.rows[0];
      const removed = await client.query<{ joined_at: string; left_at: string | null }>(`DELETE FROM voice_sessions
        WHERE joined_at < $1 RETURNING joined_at, left_at`, [expiredBefore]);
      // All removed joins precede cutoff, so their intersections with the
      // retained window share that one start. Their union is a single prefix.
      let lostUntil: string | null = null;
      for (const row of removed.rows) {
        const observedEnd = row.left_at === null || row.left_at > at ? at : row.left_at;
        if (observedEnd > expiredBefore && (lostUntil === null || observedEnd > lostUntil)) lostUntil = observedEnd;
      }
      if (lostUntil !== null) {
        // Invalidate inside the control job, before a previously queued
        // heartbeat can reuse this cursor. The DELETE and coverage withdrawal
        // commit together, so a failure rolls the evidence deletion back too.
        generation += 1; current = null;
        await client.query('DELETE FROM voice_coverage WHERE last_seen_at <= $1', [lostUntil]);
        await client.query('UPDATE voice_coverage SET started_at = $1 WHERE started_at < $1', [lostUntil]);
      }
      await client.query('DELETE FROM voice_coverage WHERE last_seen_at < $1', [expiredBefore]);
      return { openRemoved: removed.rows.some((row) => row.left_at === null), lost: lostUntil !== null };
    }));
    if (!result.ok || stopped || (!result.value.openRemoved && !result.value.lost)) return;
    // An expired visit may have described recent attendance. Its retained
    // prefix is now explicitly unknown; a complete current snapshot can begin
    // fresh evidence without keeping any part of the expired visit itself.
    if (!result.value.lost) { generation += 1; current = null; }
    if (isReady() && getPresent() !== null) await reconcile();
    else { degraded = true; lastError = FAILURE; }
  }
  function start(): void {
    if (stopped || heartbeatTimer !== null) return;
    heartbeatTimer = setInterval(() => void heartbeat().catch((error: unknown) => fail('heartbeat', error)), VOICE_HEARTBEAT_MS);
    cleanupTimer = setInterval(() => void cleanup().catch((error: unknown) => fail('cleanup', error)), HOUR_MS);
    heartbeatTimer.unref?.(); cleanupTimer.unref?.();
  }
  async function stop(): Promise<void> {
    if (!stopped) {
      stopped = true; generation += 1; current = null;
      if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
      if (cleanupTimer !== null) clearInterval(cleanupTimer);
      heartbeatTimer = null; cleanupTimer = null;
    }
    await Promise.allSettled([...people.values(), controls, ...(reconciling ? [reconciling] : [])]);
  }
  async function status(): Promise<VoiceStatus> {
    let count: number | null = null;
    try { count = Number((await pool.query<{ n: string | number }>('SELECT COUNT(*) AS n FROM voice_sessions WHERE left_at IS NULL')).rows[0].n); }
    catch (error) { fail('status read', error); }
    return { coverage_since: current?.started_at ?? null, degraded, open_segments: count, last_error: lastError };
  }
  return { onVoiceUpdate, reconcile, heartbeat, resume, cleanup, start, stop, status };
}
