import { describe, expect, it } from 'vitest';
import { canReadPrivate, redactRecord } from '../../worker/case-reads';
import type { RecordItem, User } from '../../worker/types';

const user = (id: string, roles: Partial<Pick<User, 'is_judge' | 'is_admin'>> = {}): User => ({
  id,
  username: id,
  oauth_username: id,
  avatar_url: null,
  is_participant: true,
  is_judge: roles.is_judge ?? false,
  is_admin: roles.is_admin ?? false,
  score: 100,
  created_at: '2026-10-01 00:00:00',
});

const record: RecordItem = {
  id: 1,
  subject: { id: 's', username: 's', avatar_url: null },
  reporter: { id: 'r', username: 'r', avatar_url: null },
  type: 'no_show',
  delta: -12,
  note: null,
  claim: '没来',
  claim_summary: null,
  classified_by: 'ai',
  escalation_suggested: false,
  session_id: null,
  statement: '家里有事',
  statement_at: '2026-10-26 10:00:00',
  appeal_reason: '不服',
  deadline_at: null,
  status: 'appealed',
  verdict: { source: 'ai', headline: '从轻', reasoning: '情有可原', factors: [{ kind: 'mitigating', text: '家人住院' }] },
  range: { min: -20, max: -10, base: -15 },
  created_at: '2026-10-26 09:00:00',
};

describe('canReadPrivate', () => {
  it('is the subject, the reporter, judges and admins — nobody else', () => {
    expect(canReadPrivate(record, null)).toBe(false);
    expect(canReadPrivate(record, user('x'))).toBe(false);
    expect(canReadPrivate(record, user('s'))).toBe(true);
    expect(canReadPrivate(record, user('r'))).toBe(true);
    expect(canReadPrivate(record, user('j', { is_judge: true }))).toBe(true);
    expect(canReadPrivate(record, user('a', { is_admin: true }))).toBe(true);
  });
});

describe('redactRecord', () => {
  it('blanks the private parts for an outsider, in a new object, keeping the outcome', () => {
    const frozen = Object.freeze({ ...record, verdict: Object.freeze({ ...record.verdict! }) });
    const view = redactRecord(frozen, user('x'));
    expect(view).not.toBe(frozen);
    expect(view).toMatchObject({
      statement: null,
      appeal_reason: null,
      verdict: { source: 'ai', headline: '', reasoning: '', factors: [] },
      redacted: true,
      delta: -12,
      status: 'appealed',
      statement_at: record.statement_at,
    });
    expect(frozen.statement).toBe('家里有事');
  });

  it('marks every hidden case the same, whether or not it had an appeal reason', () => {
    const without = redactRecord({ ...record, appeal_reason: null }, null);
    const withReason = redactRecord(record, null);
    expect(without).toEqual(withReason);
  });

  it('keeps a bonus’s manual verdict: it is only its label', () => {
    const bonus = { ...record, verdict: { source: 'manual' as const, headline: '守约', reasoning: '', factors: [] } };
    expect(redactRecord(bonus, null).verdict).toEqual(bonus.verdict);
  });

  it('leaves everything for those who may read it', () => {
    expect(redactRecord(record, user('s'))).toEqual({ ...record, redacted: false });
  });
});

// B1-1 (spec §11 #3 tier b): before the verdict, an outsider learns only that a case exists.
describe('redactRecord before the verdict', () => {
  const pendingCase: RecordItem = {
    ...record,
    type: 'no_show',
    delta: 0,
    note: '立案短评',
    claim: '说好八点五排结果没来',
    claim_summary: '八点没来',
    escalation_suggested: true,
    session_id: 5,
    statement: '家里有事',
    statement_at: '2026-10-26 10:00:00',
    appeal_reason: null,
    deadline_at: '2026-10-26 21:00:00',
    status: 'awaiting_statement',
    verdict: null,
  };

  for (const status of ['awaiting_statement', 'judging'] as const) {
    for (const viewer of [null, user('x')]) {
      it(`hides the accusation itself while ${status}, from ${viewer ? 'an unrelated user' : 'a visitor'}`, () => {
        const view = redactRecord({ ...pendingCase, status }, viewer);
        expect(view).toEqual({
          ...pendingCase,
          status,
          type: null,
          range: null,
          claim: null,
          claim_summary: null,
          note: null,
          escalation_suggested: false,
          statement: null,
          appeal_reason: null,
          verdict: null,
          redacted: true,
          pending_hidden: true,
        });
      });
    }
  }

  it('keeps statement_at, so the page can still say a statement was written', () => {
    expect(redactRecord(pendingCase, null)).toMatchObject({ pending_hidden: true, statement_at: '2026-10-26 10:00:00' });
    expect(redactRecord({ ...pendingCase, statement_at: null }, null)).toMatchObject({ pending_hidden: true, statement_at: null });
  });

  it('leaves the input as it is', () => {
    const frozen = Object.freeze({ ...pendingCase });
    const view = redactRecord(frozen, null);
    expect(view).not.toBe(frozen);
    expect(frozen.claim).toBe('说好八点五排结果没来');
    expect(frozen.type).toBe('no_show');
  });

  it('hides nothing more from the subject, the reporter, judges and admins', () => {
    for (const viewer of [user('s'), user('r'), user('j', { is_judge: true }), user('a', { is_admin: true })]) {
      const view = redactRecord(pendingCase, viewer);
      expect(view).toEqual({ ...pendingCase, redacted: false });
      expect(view).not.toHaveProperty('pending_hidden');
    }
  });

  it('stops once there is a verdict: decided, appealed, revoked and withdrawn cases keep their type', () => {
    for (const status of ['decided', 'appealed', 'revoked', 'withdrawn'] as const) {
      const view = redactRecord({ ...pendingCase, status }, null);
      expect(view, status).not.toHaveProperty('pending_hidden');
      expect(view, status).toMatchObject({ type: 'no_show', claim: '说好八点五排结果没来', note: '立案短评', range: pendingCase.range, redacted: true });
    }
  });
});
