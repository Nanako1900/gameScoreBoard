import { describe, expect, it } from 'vitest';
import { recordForViewer } from '../../src/lib/recordViewer';
import type { RecordItem, User } from '../../src/types';
const record = { id: 1, subject: { id: 's' }, reporter: { id: 'r' }, type: 'no_show', status: 'awaiting_statement',
  claim: 'private', claim_summary: 'private summary', note: 'note', statement: 'statement', appeal_reason: 'appeal',
  range: { min: -20, max: -10, base: -15 }, escalation_suggested: true,
  verdict: { source: 'ai', headline: 'headline', reasoning: 'reason', factors: [] } } as unknown as RecordItem;
const viewer = (id: string, roles = {}): User => ({ id, is_judge: false, is_admin: false, ...roles }) as User;
describe('cached records after viewer changes', () => {
  it('keeps an unauthorized cached accusation hidden without mutating the cached object', () => {
    const safe = recordForViewer(record, viewer('outsider'));
    expect(safe).toMatchObject({ redacted: true, pending_hidden: true, type: null, claim: null, claim_summary: null,
      note: null, statement: null, appeal_reason: null, range: null, escalation_suggested: false,
      verdict: { headline: '', reasoning: '', factors: [] } });
    expect(record.claim).toBe('private');
  });
  it.each([null, viewer('outsider')])('keeps public decided facts but strips private verdict words: %o', me => {
    const safe = recordForViewer({ ...record, status: 'decided' }, me);
    expect(safe.type).toBe('no_show'); expect(safe.claim).toBe('private');
    expect(safe.statement).toBeNull(); expect(safe.verdict?.headline).toBe('');
  });
  it.each([viewer('s'), viewer('r'), viewer('judge', { is_judge: true }), viewer('admin', { is_admin: true })])('retains an authorized snapshot: %o', me => {
    expect(recordForViewer(record, me)).toBe(record);
  });
  it('never unredacts a server response when privileges increase', () => {
    const hidden = { ...record, redacted: true, pending_hidden: true, claim: null };
    expect(recordForViewer(hidden, viewer('admin', { is_admin: true }))).toBe(hidden);
  });
});
