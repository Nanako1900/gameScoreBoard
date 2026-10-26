// The DM telling someone an admin set their score by hand (P8, events from
// 0006_p8.sql). An outcome, like a verdict: not budgeted, but news — not sent
// a day late. Split out of dispatcher.ts.

import { scoreAdjustedDm } from '../discord/dm';
import type { ChannelMessage } from '../discord/verdict';
import { STALE_MS, type DispatcherConfig, type OutboxRow, type Outcome, type Recipient } from './kit';

export const SCORE_KIND = 'dm.score.adjusted';

export interface ScoreTools {
  config: DispatcherConfig;
  recipient(userId: string): Promise<Recipient | Outcome>;
  sendDm(row: OutboxRow, to: Recipient, message: ChannelMessage): Promise<{ channelId: string; messageId: string } | Outcome>;
}

const skipped = (note: string): Outcome => ({ result: 'skipped', note });

export async function deliverScoreAdjusted(row: OutboxRow, tools: ScoreTools): Promise<Outcome> {
  const eventId = Number(row.payload.score_event_id);
  const delta = Number(row.payload.delta);
  const resulting = Number(row.payload.resulting_score);
  if (!Number.isSafeInteger(eventId) || !Number.isFinite(delta) || !Number.isFinite(resulting)) {
    return skipped('no score change in the payload');
  }
  if (Date.now() - row.created_at.getTime() > STALE_MS) return skipped('stale: older than 24 h');
  // A deleted player has no binding any more: recipient() skips them.
  const to = await tools.recipient(row.entity_id);
  if ('result' in to) return to;
  const sent = await tools.sendDm(row, to, scoreAdjustedDm({ delta, resulting_score: resulting }, tools.config.frontendUrl));
  return 'result' in sent ? sent : { result: 'sent', note: null };
}
