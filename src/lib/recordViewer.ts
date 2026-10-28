import type { RecordItem, User } from '../types';

/**
 * A previously authorized feed can outlive a role change while its refresh is
 * in flight. Restrict that snapshot for the current viewer; never undo server
 * redaction or use this in place of the API's authorization.
 */
export function recordForViewer(record: RecordItem, me: User | null): RecordItem {
  if (me && (me.is_admin || me.is_judge || me.id === record.subject.id || me.id === record.reporter.id)) return record;
  const verdict = record.verdict && record.verdict.source !== 'manual'
    ? { ...record.verdict, headline: '', reasoning: '', factors: [] } : record.verdict;
  const publicRecord = { ...record, statement: null, appeal_reason: null, verdict, redacted: true };
  if (record.status !== 'awaiting_statement' && record.status !== 'judging') return publicRecord;
  return { ...publicRecord, type: null, range: null, claim: null, claim_summary: null, note: null,
    escalation_suggested: false, pending_hidden: true };
}
