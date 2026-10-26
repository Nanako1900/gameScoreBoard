// Delivers outbox events (server/migrations/0003_outbox.sql) to Discord. Runs
// in the bot process, which owns the Discord connection; while the bot is
// down, events simply wait in the table.
//
//   claim    one due row at a time (FOR UPDATE SKIP LOCKED), and never an
//            entity's event while an earlier one of the same entity is open,
//            so a case's posts and edits happen in order;
//   deliver  re-read the current state, render it, send or edit;
//   finish   sent / skipped / dead, guarded by the claim token — or back to the
//            queue with a backoff.
//
// Woken by LISTEN outbox (the trigger NOTIFYs when a verdict commits) and by a
// 30-second poll, which also picks up retries whose time has come.

import type pg from 'pg';
import { getRecordItemById } from '../../../worker/case-reads';
import { isPostable, verdictPost, type ChannelMessage } from '../discord/verdict';

const POLL_MS = 30_000;
const RECONNECT_MS = 5_000;
const CLEANUP_MS = 24 * 3_600_000;
/** A claim not finished within this long (process died mid-send) is free again. */
const CLAIM_TIMEOUT = '2 minutes';
const MAX_ATTEMPTS = 8;
const MAX_BACKOFF_S = 3_600;
/** Never posted and older than this: not worth announcing any more (bot was down for a day). */
export const STALE_MS = 24 * 3_600_000;
/** This many 401/403 within a minute pause delivery: a reset token or a lost permission. */
const AUTH_FAILURES_TO_PAUSE = 5;
const AUTH_WINDOW_MS = 60_000;
const PAUSE_MS = 5 * 60_000;

// Discord JSON error codes.
const UNKNOWN_CHANNEL = 10003;
const UNKNOWN_MESSAGE = 10008;

export interface ChannelApi {
  send(channelId: string, message: ChannelMessage & { nonce: string; enforce_nonce: true }): Promise<{ id: string }>;
  edit(channelId: string, messageId: string, message: ChannelMessage): Promise<void>;
}

export interface DispatcherConfig {
  /** null: verdict events are marked skipped, nothing is posted. */
  verdictChannelId: string | null;
  frontendUrl: string;
}

export interface DispatcherDeps {
  /** Plain pg for the outbox tables. */
  pool: pg.Pool;
  /** The D1 adapter over the same database, for the Worker's own reads. */
  db: D1Database;
  api: ChannelApi;
  config: DispatcherConfig;
  /** A fresh client for LISTEN (start() only). */
  createListener?: () => pg.Client;
  log?: Pick<Console, 'log' | 'warn' | 'error'>;
  describeError?: (error: unknown) => string;
}

interface OutboxRow {
  id: number;
  kind: string;
  entity: string;
  entity_id: string;
  claim_token: string;
  attempts: number;
  created_at: Date;
}

type Outcome =
  | { result: 'sent' | 'skipped' | 'dead'; note: string | null }
  | { result: 'retry'; note: string };

export interface Dispatcher {
  start(): void;
  /** Deliver everything due now; resolves with how many events were handled. */
  runOnce(): Promise<number>;
  stop(): Promise<void>;
}

function errorStatus(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : null;
}

function errorCode(error: unknown): number | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'number' ? code : null;
}

export function createDispatcher(deps: DispatcherDeps): Dispatcher {
  const { pool, db, api, config } = deps;
  const log = deps.log ?? console;
  const describe = deps.describeError ?? ((error: unknown) => (error instanceof Error ? error.message : String(error)));

  let stopped = false;
  let running: Promise<void> | null = null;
  let again = false;
  let pausedUntil = 0;
  const authFailures: number[] = [];
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let cleanupTimer: ReturnType<typeof setInterval> | null = null;
  let listener: pg.Client | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  async function claim(): Promise<OutboxRow | null> {
    const res = await pool.query<OutboxRow>(
      `UPDATE outbox
          SET claim_token = gen_random_uuid(), claimed_at = now(), attempts = attempts + 1
        WHERE id = (
          SELECT o.id FROM outbox o
           WHERE o.processed_at IS NULL
             AND o.available_at <= now()
             AND (o.claimed_at IS NULL OR o.claimed_at < now() - interval '${CLAIM_TIMEOUT}')
             AND NOT EXISTS (
               SELECT 1 FROM outbox e
                WHERE e.entity = o.entity AND e.entity_id = o.entity_id
                  AND e.processed_at IS NULL AND e.id < o.id)
           ORDER BY o.id
           LIMIT 1
           FOR UPDATE SKIP LOCKED)
      RETURNING id, kind, entity, entity_id, claim_token, attempts, created_at`,
    );
    return res.rows[0] ?? null;
  }

  async function finish(row: OutboxRow, outcome: Outcome): Promise<void> {
    if (outcome.result === 'retry' && row.attempts < MAX_ATTEMPTS) {
      const delay = Math.min(MAX_BACKOFF_S, 5 * 2 ** row.attempts);
      await pool.query(
        `UPDATE outbox SET claim_token = NULL, claimed_at = NULL,
                available_at = now() + make_interval(secs => $3), last_error = $4
          WHERE id = $1 AND claim_token = $2`,
        [row.id, row.claim_token, delay, outcome.note],
      );
      return;
    }
    const result = outcome.result === 'retry' ? 'dead' : outcome.result;
    if (result === 'dead') log.error(`outbox ${row.id} (${row.kind} ${row.entity}:${row.entity_id}) is dead: ${outcome.note}`);
    await pool.query(
      `UPDATE outbox SET processed_at = now(), result = $3, last_error = $4, claim_token = NULL
        WHERE id = $1 AND claim_token = $2`,
      [row.id, row.claim_token, result, outcome.note],
    );
  }

  function noteAuthFailure(): void {
    const now = Date.now();
    authFailures.push(now);
    while (authFailures.length > 0 && authFailures[0] < now - AUTH_WINDOW_MS) authFailures.shift();
    if (authFailures.length >= AUTH_FAILURES_TO_PAUSE) {
      authFailures.length = 0;
      pausedUntil = now + PAUSE_MS;
      log.error(
        '!!! Discord keeps refusing the bot (401/403): outbox delivery paused for 5 minutes. ' +
          'Check DISCORD_TOKEN and the bot’s permissions in the verdict channel.',
      );
    }
  }

  /** What a failed Discord call means for the event. */
  function outcomeOf(error: unknown): Outcome {
    const status = errorStatus(error);
    const note = describe(error).slice(0, 500);
    if (status === 401 || status === 403) {
      noteAuthFailure();
      // Retried (with backoff): the usual cause, a missing channel permission, gets fixed.
      return { result: 'retry', note };
    }
    if (errorCode(error) === UNKNOWN_CHANNEL) return { result: 'dead', note: `unknown channel — check DISCORD_VERDICT_CHANNEL_ID: ${note}` };
    if (status !== null && status >= 400 && status < 500 && status !== 429) return { result: 'dead', note };
    // 5xx, 429 that outlived discord.js's own handling, network errors.
    return { result: 'retry', note };
  }

  async function messageFor(entity: string, entityId: string, purpose: string) {
    const res = await pool.query<{ channel_id: string; message_id: string }>(
      'SELECT channel_id, message_id FROM discord_messages WHERE entity = $1 AND entity_id = $2 AND purpose = $3',
      [entity, entityId, purpose],
    );
    return res.rows[0] ?? null;
  }

  async function deliverRecord(row: OutboxRow): Promise<Outcome> {
    const channelId = config.verdictChannelId;
    if (!channelId) return { result: 'skipped', note: 'no verdict channel configured' };
    const record = await getRecordItemById(db, Number(row.entity_id));
    if (!record || !isPostable(record)) return { result: 'skipped', note: 'nothing to post for this record' };
    const message = verdictPost(record, config.frontendUrl);

    const existing = await messageFor('record', row.entity_id, 'verdict');
    if (existing) {
      try {
        await api.edit(existing.channel_id, existing.message_id, message);
        await pool.query(
          "UPDATE discord_messages SET updated_at = now() WHERE entity = 'record' AND entity_id = $1 AND purpose = 'verdict'",
          [row.entity_id],
        );
        return { result: 'sent', note: null };
      } catch (error) {
        // Deleted in Discord: post the current state afresh.
        if (errorCode(error) !== UNKNOWN_MESSAGE) throw error;
        await pool.query(
          "DELETE FROM discord_messages WHERE entity = 'record' AND entity_id = $1 AND purpose = 'verdict'",
          [row.entity_id],
        );
      }
    } else if (Date.now() - row.created_at.getTime() > STALE_MS) {
      return { result: 'skipped', note: 'stale: never posted and older than 24 h' };
    }

    // The nonce makes Discord return the first message instead of a second one
    // if a send is repeated after a crash between sending and recording it.
    const sent = await api.send(channelId, { ...message, nonce: `ob${row.id}`, enforce_nonce: true });
    await pool.query(
      `INSERT INTO discord_messages (entity, entity_id, purpose, channel_id, message_id)
       VALUES ('record', $1, 'verdict', $2, $3)
       ON CONFLICT (entity, entity_id, purpose)
       DO UPDATE SET channel_id = excluded.channel_id, message_id = excluded.message_id, updated_at = now()`,
      [row.entity_id, channelId, sent.id],
    );
    return { result: 'sent', note: null };
  }

  async function handle(row: OutboxRow): Promise<void> {
    let outcome: Outcome;
    try {
      outcome = row.entity === 'record' ? await deliverRecord(row) : { result: 'skipped', note: `no handler for ${row.entity}` };
    } catch (error) {
      outcome = outcomeOf(error);
      if (outcome.result === 'retry') log.warn(`outbox ${row.id} failed (attempt ${row.attempts}), will retry: ${outcome.note}`);
    }
    await finish(row, outcome);
  }

  async function runOnce(): Promise<number> {
    let handled = 0;
    while (!stopped && Date.now() >= pausedUntil) {
      const row = await claim();
      if (!row) break;
      await handle(row);
      handled += 1;
    }
    return handled;
  }

  /** Run now, or right after the run in progress; never two at once. */
  function kick(): void {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = (async () => {
      do {
        again = false;
        await runOnce().catch((error: unknown) => log.error('outbox delivery failed', describe(error)));
      } while (again && !stopped);
    })().finally(() => {
      running = null;
    });
  }

  async function cleanup(): Promise<void> {
    await pool
      .query("DELETE FROM outbox WHERE processed_at < now() - interval '30 days'")
      .catch((error: unknown) => log.error('outbox cleanup failed', describe(error)));
  }

  function scheduleReconnect(): void {
    if (stopped || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void listen();
    }, RECONNECT_MS);
  }

  async function listen(): Promise<void> {
    if (!deps.createListener || stopped) return;
    const client = deps.createListener();
    listener = client;
    // The poll keeps things moving while this is down; just come back.
    client.on('error', (error) => {
      log.warn('outbox LISTEN connection error', describe(error));
      if (listener === client) listener = null;
      void client.end().catch(() => undefined);
      scheduleReconnect();
    });
    client.on('notification', () => kick());
    try {
      await client.connect();
      await client.query('LISTEN outbox');
      // Anything that committed while we were not listening.
      kick();
    } catch (error) {
      log.warn('outbox LISTEN failed', describe(error));
      if (listener === client) listener = null;
      void client.end().catch(() => undefined);
      scheduleReconnect();
    }
  }

  return {
    start() {
      if (pollTimer) return;
      pollTimer = setInterval(kick, POLL_MS);
      cleanupTimer = setInterval(() => void cleanup(), CLEANUP_MS);
      void cleanup();
      void listen();
      kick();
    },
    runOnce,
    async stop() {
      stopped = true;
      if (pollTimer) clearInterval(pollTimer);
      if (cleanupTimer) clearInterval(cleanupTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      await running;
      await listener?.end().catch(() => undefined);
    },
  };
}
