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
import { dmStillRelevant, isDmKind, removedDm, renderDm, renderWelcomeDm, STATEMENT_DMS, type DmKind } from '../discord/dm';
import { isPenalty, isPostable, verdictPost, type ChannelMessage } from '../discord/verdict';
import {
  CANNOT_DM,
  STALE_MS,
  UNKNOWN_CHANNEL,
  UNKNOWN_MESSAGE,
  errorCode,
  errorStatus,
  nonceFor,
  type ChannelApi,
  type DispatcherConfig,
  type OutboxRow,
  type Outcome,
  type Recipient,
} from './kit';

import { deliverReport, REPORT_KINDS } from './report-delivery';
import { deliverBoard, BOARD_KINDS } from './board-delivery';
import { deliverEscalation, deliverRecharged, ESCALATION_KINDS } from './escalation-delivery';
import { deliverScoreAdjusted, SCORE_KIND } from './score-delivery';

export { STALE_MS, type ChannelApi, type DispatcherConfig } from './kit';

const POLL_MS = 30_000;
const RECONNECT_MS = 5_000;
const CLEANUP_MS = 24 * 3_600_000;
/** A claim not finished within this long (process died mid-send) is free again. */
const CLAIM_TIMEOUT = '2 minutes';
const MAX_ATTEMPTS = 8;
const MAX_BACKOFF_S = 3_600;
/** A refusal (401/403) waits this long, without using up an attempt: the fix is a human's. */
const REFUSED_RETRY_S = 300;
/** This many 401/403 within a minute pause delivery: a reset token or a lost permission. */
const AUTH_FAILURES_TO_PAUSE = 5;
const AUTH_WINDOW_MS = 60_000;
const PAUSE_MS = 5 * 60_000;

/**
 * Reminders and to-dos one person gets per 24 h; past it they are skipped (the
 * web has it all). Outcomes — a verdict, an override, a revoke, an appeal to
 * review, an admin's score correction — are never budgeted: they are what the
 * reminders were for. Each is
 * at most one per case (or needs an admin), and cases need a judge.
 */
export const DM_BUDGET = 20;
/**
 * Escalation asks to a judge (P8) have their own allowance: a batch of filings
 * the AI all flagged must not use up the judge's own statement reminders.
 */
export const ESCALATION_DM_BUDGET = 10;

interface Budget {
  kinds: readonly string[];
  limit: number;
}
const BUDGETS: readonly Budget[] = [
  { kinds: ['dm.filed', 'dm.deadline'], limit: DM_BUDGET },
  { kinds: ['dm.escalation'], limit: ESCALATION_DM_BUDGET },
];

function budgetFor(kind: string): Budget | null {
  return BUDGETS.find((b) => b.kinds.includes(kind)) ?? null;
}
/** News (not to-dos) that could not go out within this long is not worth sending late. */
const NEWS_KINDS: ReadonlySet<DmKind> = new Set(['dm.decided', 'dm.overridden', 'dm.revoked', 'dm.appealed']);


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


/** The record events this version delivers; anything else waits for a newer one. */
const RECORD_KINDS: ReadonlySet<string> = new Set(['case.decided', 'case.overridden', 'case.revoked', 'case.removed']);


export interface Dispatcher {
  start(): void;
  /** Deliver everything due now; resolves with how many events were handled. */
  runOnce(): Promise<number>;
  stop(): Promise<void>;
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
             -- In order per entity, but a reminder scheduled for later (never
             -- tried yet) does not hold up what comes after it.
             AND NOT EXISTS (
               SELECT 1 FROM outbox e
                WHERE e.entity = o.entity AND e.entity_id = o.entity_id
                  AND e.processed_at IS NULL AND e.id < o.id
                  AND (e.available_at <= now() OR e.attempts > 0 OR e.refused_since IS NOT NULL))
           -- Fresh events before retries of refused ones: a channel the bot may
           -- not post in must not keep everything else waiting.
           ORDER BY (o.refused_since IS NOT NULL), o.id
           LIMIT 1
           FOR UPDATE SKIP LOCKED)
      RETURNING id, kind, entity, entity_id, payload, claim_token, attempts, created_at, refused_since`,
    );
    return res.rows[0] ?? null;
  }

  async function finish(row: OutboxRow, outcome: Outcome): Promise<void> {
    if (outcome.result === 'retry' && (outcome.refused || outcome.unhandled)) {
      // A refusal is usually a permission someone forgot to give the bot: it
      // gets fixed eventually, so it waits without spending its attempts — for
      // a day counted from the first refusal. Corrections to the channel (an
      // edit, a removal) never give up: a revoked penalty must not stay up.
      // An unhandled event waits a day from its creation for a newer bot.
      const since = outcome.refused ? (row.refused_since ?? new Date()) : row.created_at;
      const keep = outcome.refused && row.entity === 'record' && RECORD_KINDS.has(row.kind);
      const overdue = Date.now() - since.getTime() > STALE_MS;
      if (keep || !overdue) {
        // A correction refused for over a day: someone has to fix the bot's
        // permissions. Ask hourly from then on (and say so each time).
        if (overdue) {
          log.error(`outbox ${row.id} (${row.kind} record:${row.entity_id}) refused for over a day: ${outcome.note}`);
        }
        await pool.query(
          `UPDATE outbox SET claim_token = NULL, claimed_at = NULL, attempts = attempts - 1,
                  refused_since = CASE WHEN $5 THEN COALESCE(refused_since, now()) ELSE refused_since END,
                  available_at = now() + make_interval(secs => $3), last_error = $4
            WHERE id = $1 AND claim_token = $2`,
          [row.id, row.claim_token, overdue ? MAX_BACKOFF_S : REFUSED_RETRY_S, outcome.note, outcome.refused === true],
        );
        return;
      }
    } else if (outcome.result === 'retry' && row.attempts < MAX_ATTEMPTS) {
      await pool.query(
        `UPDATE outbox SET claim_token = NULL, claimed_at = NULL,
                available_at = now() + make_interval(secs => $3), last_error = $4
          WHERE id = $1 AND claim_token = $2`,
        [row.id, row.claim_token, Math.min(MAX_BACKOFF_S, 5 * 2 ** row.attempts), outcome.note],
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

  function pause(why: string): void {
    pausedUntil = Date.now() + PAUSE_MS;
    log.error(`!!! ${why}: outbox delivery paused for 5 minutes.`);
  }

  function noteAuthFailure(status: number): void {
    // 401: the token itself is bad — every call will fail the same way.
    if (status === 401) {
      pause('Discord rejects the bot token (401) — check DISCORD_TOKEN');
      return;
    }
    const now = Date.now();
    authFailures.push(now);
    while (authFailures.length > 0 && authFailures[0] < now - AUTH_WINDOW_MS) authFailures.shift();
    if (authFailures.length >= AUTH_FAILURES_TO_PAUSE) {
      authFailures.length = 0;
      pause(
        'Discord keeps refusing the bot (403) — check its channel permissions ' +
          '(DISCORD_VERDICT_CHANNEL_ID / DISCORD_BOARD_CHANNEL_ID)',
      );
    }
  }

  /** What a failed Discord call means for the event. */
  function outcomeOf(error: unknown, row: OutboxRow): Outcome {
    const status = errorStatus(error);
    const note = describe(error).slice(0, 500);
    if (status === 401 || status === 403) {
      // Another refusal of something already refused says nothing new about
      // the bot as a whole: counted, a few stuck corrections would pause all
      // delivery every time their retry came round.
      if (status === 401 || row.refused_since === null) noteAuthFailure(status);
      return { result: 'retry', note, refused: true };
    }
    if (errorCode(error) === UNKNOWN_CHANNEL) {
      return { result: 'dead', note: `unknown channel — check ${row.entity === 'board' ? 'DISCORD_BOARD_CHANNEL_ID' : 'DISCORD_VERDICT_CHANNEL_ID'}: ${note}` };
    }
    if (status !== null && status >= 400 && status < 500 && status !== 429) return { result: 'dead', note };
    // 5xx, 429 that outlived discord.js's own handling, network errors.
    return { result: 'retry', note };
  }

  async function messageFor(
    entity: string,
    entityId: string,
    purpose: string,
  ): Promise<{ channel_id: string; message_id: string } | null> {
    const res = await pool.query<{ channel_id: string; message_id: string }>(
      'SELECT channel_id, message_id FROM discord_messages WHERE entity = $1 AND entity_id = $2 AND purpose = $3',
      [entity, entityId, purpose],
    );
    return res.rows[0] ?? null;
  }

  async function forgetMessage(entityId: string): Promise<void> {
    await pool.query(
      "DELETE FROM discord_messages WHERE entity = 'record' AND entity_id = $1 AND purpose = 'verdict'",
      [entityId],
    );
  }

  /** The record is gone (its user was deleted): take its post down too. */
  async function removeMessage(row: OutboxRow, entity: 'record' | 'session', purpose: string): Promise<Outcome> {
    const channelId = typeof row.payload.channel_id === 'string' ? row.payload.channel_id : null;
    const messageId = typeof row.payload.message_id === 'string' ? row.payload.message_id : null;
    if (!channelId || !messageId) return { result: 'skipped', note: 'no message to remove' };
    try {
      await api.remove(channelId, messageId);
    } catch (error) {
      const code = errorCode(error);
      if (code !== UNKNOWN_MESSAGE && code !== UNKNOWN_CHANNEL) throw error;
    }
    await pool.query('DELETE FROM discord_messages WHERE entity = $1 AND entity_id = $2 AND purpose = $3', [
      entity,
      String(Number.parseInt(row.entity_id, 10)),
      purpose,
    ]);
    return { result: 'sent', note: null };
  }

  async function deliverRecord(row: OutboxRow): Promise<Outcome> {
    if (!RECORD_KINDS.has(row.kind)) return unhandled(row);
    if (row.kind === 'case.removed') return removeMessage(row, 'record', 'verdict');
    const channelId = config.verdictChannelId;
    if (!channelId) return { result: 'skipped', note: 'no verdict channel configured' };
    const record = await getRecordItemById(db, Number(row.entity_id));
    if (!record || !isPostable(record)) return { result: 'skipped', note: 'nothing to post for this record' };
    const message = verdictPost(record, config.frontendUrl);

    const announced = await messageFor('record', row.entity_id, 'verdict');
    // The verdict channel was changed since: post in the new one.
    let existing = announced && announced.channel_id === channelId ? announced : null;
    if (existing) {
      try {
        await api.edit(existing.channel_id, existing.message_id, message);
        await pool.query(
          "UPDATE discord_messages SET updated_at = now() WHERE entity = 'record' AND entity_id = $1 AND purpose = 'verdict'",
          [row.entity_id],
        );
        return { result: 'sent', note: null };
      } catch (error) {
        // Deleted in Discord (the message or its channel): post the current state afresh.
        const code = errorCode(error);
        if (code !== UNKNOWN_MESSAGE && code !== UNKNOWN_CHANNEL) throw error;
        await forgetMessage(row.entity_id);
        existing = null;
      }
    } else if (!announced && row.kind !== 'case.decided') {
      // A revoke or override of a case the channel never heard about.
      return { result: 'skipped', note: 'never announced' };
    } else if (!announced && Date.now() - row.created_at.getTime() > STALE_MS) {
      return { result: 'skipped', note: 'stale: never posted and older than 24 h' };
    }

    // The nonce makes Discord return the first message instead of a second one
    // if a send is repeated after a crash between sending and recording it.
    const sent = await api.send(channelId, { ...message, nonce: nonceFor(row), enforce_nonce: true });
    await pool.query(
      `INSERT INTO discord_messages (entity, entity_id, purpose, channel_id, message_id)
       VALUES ('record', $1, 'verdict', $2, $3)
       ON CONFLICT (entity, entity_id, purpose)
       DO UPDATE SET channel_id = excluded.channel_id, message_id = excluded.message_id, updated_at = now()`,
      [row.entity_id, channelId, sent.id],
    );
    return { result: 'sent', note: null };
  }

  /** DMs of this budget this person got in the last 24 h. */
  async function dmsToday(userId: string, budget: Budget): Promise<number> {
    const res = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM outbox
        WHERE entity = 'user' AND entity_id = $1 AND result = 'sent' AND kind = ANY($2::text[])
          AND processed_at > now() - interval '1 day'`,
      [userId, [...budget.kinds]],
    );
    return res.rows[0]?.n ?? 0;
  }

  /** A DM about one case to the person it concerns (P6); entity_id is their users.id. */

  /** The recipient's Discord account if DMs to them are on — else why not. */
  async function recipient(userId: string): Promise<Recipient | Outcome> {
    const link = (
      await pool.query<{ discord_user_id: string; notify_dm: number; dm_ok: number }>(
        'SELECT discord_user_id, notify_dm, dm_ok FROM discord_links WHERE user_id = $1',
        [userId],
      )
    ).rows[0];
    if (!link) return { result: 'skipped', note: 'recipient has no Discord binding' };
    if (!link.notify_dm) return { result: 'skipped', note: 'recipient turned DMs off (/notify)' };
    if (!link.dm_ok) return { result: 'skipped', note: 'recipient does not accept DMs from the bot' };
    return { discord_user_id: link.discord_user_id };
  }

  function isOutcome(value: object): value is Outcome {
    return 'result' in value;
  }

  /** This person's DMs are shut (Discord 50007): stop until they use the bot again. */
  async function dmsClosed(userId: string): Promise<Outcome> {
    await pool.query('UPDATE discord_links SET dm_ok = 0 WHERE user_id = $1', [userId]);
    return { result: 'skipped', note: 'DMs closed (50007)' };
  }

  /** Send one new DM (budget, nonce, closed DMs). Returns where it went, or why not. */
  async function sendDm(
    row: OutboxRow,
    to: Recipient,
    message: ChannelMessage,
  ): Promise<{ channelId: string; messageId: string } | Outcome> {
    const budget = budgetFor(row.kind);
    if (budget && (await dmsToday(row.entity_id, budget)) >= budget.limit) {
      return { result: 'skipped', note: 'daily DM budget used up' };
    }
    try {
      const channelId = await api.openDm(to.discord_user_id);
      const sent = await api.send(channelId, { ...message, nonce: nonceFor(row), enforce_nonce: true });
      return { channelId, messageId: sent.id };
    } catch (error) {
      // Not a refusal of the bot as a whole: this one person's DMs are shut.
      if (errorCode(error) === CANNOT_DM) return dmsClosed(row.entity_id);
      throw error;
    }
  }


  async function isAdmin(userId: string): Promise<boolean> {
    const res = await pool.query<{ is_admin: number }>('SELECT is_admin FROM users WHERE id = $1', [userId]);
    return res.rows[0]?.is_admin === 1;
  }

  /** Rewrite DMs already sent (no new notification); 50007 marks DMs closed. */
  async function rewrite(
    userId: string,
    targets: ReadonlyArray<{ channel_id: string; message_id: string }>,
    message: ChannelMessage,
  ): Promise<Outcome | number> {
    let edited = 0;
    for (const target of targets) {
      try {
        await api.edit(target.channel_id, target.message_id, message);
        edited += 1;
      } catch (error) {
        const code = errorCode(error);
        if (code === CANNOT_DM) return dmsClosed(userId);
        if (code !== UNKNOWN_MESSAGE && code !== UNKNOWN_CHANNEL) throw error;
      }
    }
    return edited;
  }

  async function statementDms(recordId: number): Promise<Array<{ channel_id: string; message_id: string }>> {
    const found: Array<{ channel_id: string; message_id: string }> = [];
    for (const purpose of Object.values(STATEMENT_DMS)) {
      const posted = await messageFor('record', String(recordId), purpose);
      if (posted) found.push(posted);
    }
    return found;
  }

  /** The record was deleted with its user: say so in the DMs that quoted it. */
  async function deliverDmRemoved(row: OutboxRow): Promise<Outcome> {
    const { channel_id: channelId, message_id: messageId, purpose } = row.payload;
    if (typeof channelId !== 'string' || typeof messageId !== 'string' || typeof purpose !== 'string') {
      return { result: 'skipped', note: 'no message in the payload' };
    }
    const done = await rewrite(row.entity_id, [{ channel_id: channelId, message_id: messageId }], removedDm());
    if (typeof done !== 'number') return done;
    await pool.query("DELETE FROM discord_messages WHERE entity = 'record' AND entity_id = $1 AND purpose = $2", [
      String(row.payload.record_id),
      purpose,
    ]);
    return { result: 'sent', note: null };
  }

  async function deliverDm(row: OutboxRow): Promise<Outcome> {
    if (row.kind === 'dm.welcome') {
      const to = await recipient(row.entity_id);
      if (isOutcome(to)) return to;
      const sent = await sendDm(row, to, renderWelcomeDm(config.frontendUrl, config.boardChannelId));
      return isOutcome(sent) ? sent : { result: 'sent', note: null };
    }
    if (row.kind === 'dm.removed') return deliverDmRemoved(row);
    if (row.kind === SCORE_KIND) return deliverScoreAdjusted(row, { config, recipient, sendDm });
    if (row.kind === 'dm.recharged' || ESCALATION_KINDS.has(row.kind)) {
      const tools = { pool, db, config, recipient, sendDm, rewrite, messageFor, rememberDm };
      return row.kind === 'dm.recharged' ? deliverRecharged(row, tools) : deliverEscalation(row, tools);
    }
    if (row.kind.startsWith('dm.session.')) return { result: 'skipped', note: 'sessions are off' };
    if (!isDmKind(row.kind)) return unhandled(row);
    const kind = row.kind;
    const recordId = Number(row.payload.record_id);
    if (!Number.isSafeInteger(recordId)) return { result: 'skipped', note: 'no record in the payload' };

    if (kind === 'dm.withdrawn') {
      // Rewrite the DMs that asked for a statement (filing, reminder) in place:
      // their 写陈述 button goes. Never a new DM — so not subject to /notify or
      // the binding: it only edits what was already sent.
      const record = await getRecordItemById(db, recordId);
      if (!record || record.status !== 'withdrawn') return { result: 'skipped', note: 'no longer true' };
      const message = renderDm(kind, record, config.frontendUrl);
      const targets = await statementDms(recordId);
      if (!message || targets.length === 0) return { result: 'skipped', note: 'no statement DM to rewrite' };
      const done = await rewrite(row.entity_id, targets, message);
      if (typeof done !== 'number') return done;
      return done > 0 ? { result: 'sent', note: null } : { result: 'skipped', note: 'statement DMs are gone' };
    }

    const to = await recipient(row.entity_id);
    if (isOutcome(to)) return to;

    const record = await getRecordItemById(db, recordId);
    if (!record || !isPenalty(record.type)) return { result: 'skipped', note: 'nothing to say about this record' };
    // Still this recipient's business: the subject — or, for an appeal, an admin
    // (one demoted since it was queued is not any more).
    const forThem = kind === 'dm.appealed' ? await isAdmin(row.entity_id) : record.subject.id === row.entity_id;
    if (!forThem) return { result: 'skipped', note: 'not for this recipient any more' };
    if (!dmStillRelevant(kind, record)) return { result: 'skipped', note: 'no longer true' };
    if (NEWS_KINDS.has(kind) && Date.now() - row.created_at.getTime() > STALE_MS) {
      return { result: 'skipped', note: 'stale: older than 24 h' };
    }
    const message = renderDm(kind, record, config.frontendUrl);
    if (!message) return { result: 'skipped', note: 'nothing to say' };

    const purpose = STATEMENT_DMS[kind];
    const earlier = purpose ? await messageFor('record', String(recordId), purpose) : null;

    const sent = await sendDm(row, to, message);
    if (isOutcome(sent)) return sent;
    if (!purpose) return { result: 'sent', note: null };
    if (!(await rememberDm(row, recordId, purpose, sent))) return { result: 'sent', note: null };
    // A reminder sent again (its deadline moved): the earlier one loses its
    // button, so only the current DM offers 写陈述. The new one is sent and
    // remembered whatever happens to this — so it never decides the outcome.
    // (The same message, when Discord matched the nonce: leave it be.)
    if (earlier && earlier.message_id !== sent.messageId) {
      await tidy(row, earlier.channel_id, earlier.message_id, { ...message, components: [] }, 'take the button off the earlier reminder');
    }
    return { result: 'sent', note: null };
  }

  /**
   * Remember a DM about a case (a withdrawal or a deletion rewrites it) —
   * unless the record was deleted while it was being sent. The lock waits out
   * a deletion in progress (whose trigger saw nothing stored yet); a record
   * that is gone gets its DM rewritten like any other, as an event, so it is
   * retried. False: it was gone.
   */
  async function rememberDm(
    row: OutboxRow,
    recordId: number,
    purpose: string,
    sent: { channelId: string; messageId: string },
  ): Promise<boolean> {
    const kept = await pool.query(
      `INSERT INTO discord_messages (entity, entity_id, purpose, channel_id, message_id)
       SELECT 'record', $1, $2, $3, $4 WHERE EXISTS (SELECT 1 FROM records WHERE id = $5 FOR KEY SHARE)
       ON CONFLICT (entity, entity_id, purpose)
       DO UPDATE SET channel_id = excluded.channel_id, message_id = excluded.message_id, updated_at = now()`,
      [String(recordId), purpose, sent.channelId, sent.messageId, recordId],
    );
    if (kept.rowCount !== 0) return true;
    await pool.query(
      `INSERT INTO outbox (kind, entity, entity_id, dedupe_key, payload)
       VALUES ('dm.removed', 'user', $1, 'dm:case:' || $2 || ':removed:' || $3 || ':' || $4,
               jsonb_build_object('record_id', $2::bigint, 'purpose', $3::text, 'channel_id', $5::text, 'message_id', $4::text))
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [row.entity_id, recordId, purpose, sent.messageId, sent.channelId],
    );
    return false;
  }

  /** A best-effort edit after the event's real work is done: a failure is only logged. */
  async function tidy(row: OutboxRow, channelId: string, messageId: string, message: ChannelMessage, what: string): Promise<void> {
    try {
      await api.edit(channelId, messageId, message);
    } catch (error) {
      log.warn(`outbox ${row.id}: could not ${what}: ${describe(error)}`);
    }
  }

  /** Only old card removals survive the session feature's retirement. */
  async function deliverSession(row: OutboxRow): Promise<Outcome> {
    return row.kind === 'session.removed'
      ? removeMessage(row, 'session', 'card')
      : { result: 'skipped', note: 'sessions are off' };
  }

  /**
   * An event this version cannot deliver — most likely written by a newer
   * schema while this (older) bot is still running a rolling deploy. Leave it
   * for the newer dispatcher instead of throwing it away; the 24-hour rule
   * ends it if nobody ever can.
   */
  function unhandled(row: OutboxRow): Outcome {
    return { result: 'retry', note: `no handler for ${row.entity} ${row.kind}`, unhandled: true };
  }

  async function handle(row: OutboxRow): Promise<void> {
    let outcome: Outcome;
    try {
      outcome =
        row.entity === 'record'
          ? await deliverRecord(row)
          : row.entity === 'user'
            ? await deliverDm(row)
            : row.entity === 'session'
              ? await deliverSession(row)
              : row.entity === 'report' && REPORT_KINDS.has(row.kind)
                ? await deliverReport(row, { pool, db, api, config })
                : row.entity === 'board' && BOARD_KINDS.has(row.kind)
                  ? await deliverBoard(row, { pool, db, api, config })
                  : unhandled(row);
    } catch (error) {
      outcome = outcomeOf(error, row);
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
