// The weekly report's post in the verdict channel (P8, events from
// server/migrations/0006_p8.sql): posted once per week when its report is
// written, edited when it is rewritten. Only the latest, finished week is ever
// posted — not an old week an admin re-rolled, not one imported from D1.

import type pg from 'pg';
import { getLatestReport, getReport } from '../../../worker/report';
import { reportPost } from '../discord/report';
import {
  STALE_MS,
  UNKNOWN_CHANNEL,
  UNKNOWN_MESSAGE,
  errorCode,
  nonceFor,
  type ChannelApi,
  type DispatcherConfig,
  type OutboxRow,
  type Outcome,
} from './kit';

export const REPORT_KINDS: ReadonlySet<string> = new Set(['report.ready', 'report.updated']);

const DAY_MS = 86_400_000;

export interface ReportDeliveryDeps {
  pool: pg.Pool;
  db: D1Database;
  api: ChannelApi;
  config: DispatcherConfig;
}

const skipped = (note: string): Outcome => ({ result: 'skipped', note });

/** Has the board-local week starting on this Monday ended? */
function weekOver(weekStart: string, offsetHours: number, now = Date.now()): boolean {
  const start = Date.parse(`${weekStart}T00:00:00Z`) - offsetHours * 3_600_000;
  return Number.isFinite(start) && start + 7 * DAY_MS <= now;
}

export async function deliverReport(row: OutboxRow, deps: ReportDeliveryDeps): Promise<Outcome> {
  const { pool, db, api, config } = deps;
  const channelId = config.verdictChannelId;
  if (!channelId) return skipped('no verdict channel configured');
  const week = row.entity_id;
  const report = await getReport(db, week);
  if (!report) return skipped('no such report');
  const post = reportPost(report, config.frontendUrl);

  const posted = (
    await pool.query<{ channel_id: string; message_id: string }>(
      "SELECT channel_id, message_id FROM discord_messages WHERE entity = 'report' AND entity_id = $1 AND purpose = 'post'",
      [week],
    )
  ).rows[0];
  if (posted) {
    // Edited where it is, even after a channel change: it is the post people saw.
    try {
      await api.edit(posted.channel_id, posted.message_id, post);
      await pool.query(
        "UPDATE discord_messages SET updated_at = now() WHERE entity = 'report' AND entity_id = $1 AND purpose = 'post'",
        [week],
      );
      return { result: 'sent', note: null };
    } catch (error) {
      const code = errorCode(error);
      if (code !== UNKNOWN_MESSAGE && code !== UNKNOWN_CHANNEL) throw error;
      // Deleted in Discord: an old week is not posted again.
      await pool.query("DELETE FROM discord_messages WHERE entity = 'report' AND entity_id = $1 AND purpose = 'post'", [week]);
      if (row.kind === 'report.updated') return skipped('the post was deleted in Discord');
    }
  }
  if (row.kind === 'report.updated') return skipped('never announced');

  // report.ready, not posted yet.
  if (Date.now() - row.created_at.getTime() > STALE_MS) return skipped('stale: never posted and older than 24 h');
  const latest = await getLatestReport(db);
  if (!latest || latest.week_start !== week) return skipped('not the latest week');
  if (!weekOver(week, config.offsetHours ?? 8)) return skipped('the week is not over');

  const sent = await api.send(channelId, { ...post, nonce: nonceFor(row), enforce_nonce: true });
  await pool.query(
    `INSERT INTO discord_messages (entity, entity_id, purpose, channel_id, message_id)
     VALUES ('report', $1, 'post', $2, $3)
     ON CONFLICT (entity, entity_id, purpose)
     DO UPDATE SET channel_id = excluded.channel_id, message_id = excluded.message_id, updated_at = now()`,
    [week, channelId, sent.id],
  );
  return { result: 'sent', note: null };
}
