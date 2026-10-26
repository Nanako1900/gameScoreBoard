// A case's charge in Discord (P8, events from 0006_p8.sql). The escalation DM
// to the filing judge: `dm.escalation` asks while the hint is open,
// `dm.escalation.closed` rewrites that DM without its buttons once it is
// settled. And `dm.recharged`: the charge changed before the verdict, so the
// subject's statement DMs are rewritten to say so. Split out of dispatcher.ts;
// the dispatcher hands in the DM tools it already has.

import { getRecordItemById } from '../../../worker/case-reads';
import { renderDm, STATEMENT_DMS, type DmKind } from '../discord/dm';
import { isPenalty, type ChannelMessage } from '../discord/verdict';
import { escalationOpen, renderEscalationClosed, renderEscalationDm } from '../discord/escalation';
import { parseTimestamp } from '../discord/render';
import type { DispatcherConfig, OutboxRow, Outcome, Recipient } from './kit';
import type pg from 'pg';

export const ESCALATION_KINDS: ReadonlySet<string> = new Set(['dm.escalation', 'dm.escalation.closed']);
export const ESCALATION_PURPOSE = 'dm:esc';

export interface EscalationTools {
  pool: pg.Pool;
  db: D1Database;
  config: DispatcherConfig;
  recipient(userId: string): Promise<Recipient | Outcome>;
  sendDm(row: OutboxRow, to: Recipient, message: ChannelMessage): Promise<{ channelId: string; messageId: string } | Outcome>;
  rewrite(
    userId: string,
    targets: ReadonlyArray<{ channel_id: string; message_id: string }>,
    message: ChannelMessage,
  ): Promise<Outcome | number>;
  messageFor(entity: string, entityId: string, purpose: string): Promise<{ channel_id: string; message_id: string } | null>;
  /** Store the DM (false: the record was deleted meanwhile, and its rewrite is queued). */
  rememberDm(row: OutboxRow, recordId: number, purpose: string, sent: { channelId: string; messageId: string }): Promise<boolean>;
}

const skipped = (note: string): Outcome => ({ result: 'skipped', note });

function isOutcome(value: object): value is Outcome {
  return 'result' in value;
}

export async function deliverEscalation(row: OutboxRow, tools: EscalationTools): Promise<Outcome> {
  const recordId = Number(row.payload.record_id);
  if (!Number.isSafeInteger(recordId)) return skipped('no record in the payload');

  if (row.kind === 'dm.escalation.closed') {
    // Only ever an edit of the DM already sent: not subject to /notify.
    const posted = await tools.messageFor('record', String(recordId), ESCALATION_PURPOSE);
    if (!posted) return skipped('no escalation DM to rewrite');
    const record = await getRecordItemById(tools.db, recordId);
    if (!record) return skipped('record is gone');
    const done = await tools.rewrite(row.entity_id, [posted], renderEscalationClosed(record));
    if (typeof done !== 'number') return done;
    return done > 0 ? { result: 'sent', note: null } : skipped('the escalation DM is gone');
  }

  const to = await tools.recipient(row.entity_id);
  if (isOutcome(to)) return to;
  const record = await getRecordItemById(tools.db, recordId);
  if (!record || !isPenalty(record.type)) return skipped('nothing to ask about this record');
  // Still theirs to settle: they filed it, and they are a judge (or an admin).
  if (record.reporter.id !== row.entity_id) return skipped('not for this recipient any more');
  const roles = (
    await tools.pool.query<{ is_judge: number; is_admin: number }>('SELECT is_judge, is_admin FROM users WHERE id = $1', [
      row.entity_id,
    ])
  ).rows[0];
  if (!roles || (roles.is_judge !== 1 && roles.is_admin !== 1)) return skipped('no longer a judge');
  if (!escalationOpen(record)) return skipped('no longer true');
  if (record.deadline_at && parseTimestamp(record.deadline_at) <= Date.now()) {
    return skipped('the statement window has closed');
  }

  const sent = await tools.sendDm(row, to, renderEscalationDm(record, tools.config.frontendUrl));
  if (isOutcome(sent)) return sent;
  await tools.rememberDm(row, recordId, ESCALATION_PURPOSE, sent);
  return { result: 'sent', note: null };
}

/**
 * The charge changed before the verdict: the subject's filing DM and
 * reminder are rewritten in place to say what they are accused of now (their
 * 写陈述 button stays). Never a new DM, so not subject to /notify.
 */
export async function deliverRecharged(row: OutboxRow, tools: EscalationTools): Promise<Outcome> {
  const recordId = Number(row.payload.record_id);
  if (!Number.isSafeInteger(recordId)) return skipped('no record in the payload');
  const record = await getRecordItemById(tools.db, recordId);
  if (!record || record.status !== 'awaiting_statement') return skipped('no longer true');
  let edited = 0;
  for (const [kind, purpose] of Object.entries(STATEMENT_DMS) as Array<[DmKind, string]>) {
    const posted = await tools.messageFor('record', String(recordId), purpose);
    const message = posted ? renderDm(kind, record, tools.config.frontendUrl) : null;
    if (!posted || !message) continue;
    const done = await tools.rewrite(row.entity_id, [posted], message);
    if (typeof done !== 'number') return done;
    edited += done;
  }
  return edited > 0 ? { result: 'sent', note: null } : skipped('no statement DM to rewrite');
}
