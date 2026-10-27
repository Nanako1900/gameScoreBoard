import { describe, expect, it } from 'vitest';
import { APPEAL_MAX, MAX_NARRATIVE_LEN } from '../../shared/scoring';
import {
  isCaseDraftEmpty,
  isRollCallDraftEmpty,
  isSessionDraftEmpty,
  mergeMarks,
  toStoredMark,
  validateAppealDraft,
  validateCaseDraft,
  validateOnboardingDraft,
  validateRollCallDraft,
  validateSessionDraft,
  validateStatementDraft,
} from '../../src/lib/draftShapes';

// Whatever comes back out of storage is outside data: it is checked, and
// anything the form could no longer show (a person who left, a slot that
// passed, a judge role the user does not hold) is dropped, not trusted.

describe('text drafts', () => {
  it('accept a string within the field cap, nothing else', () => {
    expect(validateStatementDraft('家里临时有事')).toBe('家里临时有事');
    expect(validateStatementDraft('长'.repeat(MAX_NARRATIVE_LEN + 1))).toBeNull();
    expect(validateAppealDraft('长'.repeat(APPEAL_MAX))).toBe('长'.repeat(APPEAL_MAX));
    expect(validateAppealDraft('长'.repeat(APPEAL_MAX + 1))).toBeNull();
    expect(validateAppealDraft(42)).toBeNull();
  });
});

describe('validateCaseDraft', () => {
  it('keeps only people who can still be picked, within the batch limit', () => {
    const raw = { picked: ['a', 'gone', 'b', 'c'], claim: '说好八点', extras: { a: '补一句', gone: 'x', c: 7 } };
    expect(validateCaseDraft(raw, ['a', 'b', 'c'], 2)).toEqual({
      picked: ['a', 'b'],
      claim: '说好八点',
      extras: { a: '补一句' },
    });
  });

  it('refuses a wrong shape', () => {
    expect(validateCaseDraft({ picked: 'a', claim: '', extras: {} }, ['a'], 5)).toBeNull();
    expect(validateCaseDraft({ picked: [], claim: 1, extras: {} }, ['a'], 5)).toBeNull();
    expect(validateCaseDraft({ picked: [], claim: '', extras: [] }, ['a'], 5)).toBeNull();
    expect(validateCaseDraft(null, ['a'], 5)).toBeNull();
  });

  it('is empty only with nobody, no claim and no notes', () => {
    expect(isCaseDraftEmpty({ picked: [], claim: '  ', extras: { a: ' ' } })).toBe(true);
    expect(isCaseDraftEmpty({ picked: ['a'], claim: '', extras: {} })).toBe(false);
    expect(isCaseDraftEmpty({ picked: [], claim: '有事', extras: {} })).toBe(false);
  });
});

describe('roll call drafts', () => {
  const roster = [
    { user: { id: 'a', username: '甲', avatar_url: null }, attendance: null, late_minutes: null },
    { user: { id: 'b', username: '乙', avatar_url: null }, attendance: 'late' as const, late_minutes: 5 },
  ];

  it('keeps marks for people still on the roster', () => {
    const raw = { a: { attendance: 'late', late_minutes: 12 }, gone: { attendance: 'on_time' }, b: { attendance: 'nope' } };
    expect(validateRollCallDraft(raw, ['a', 'b'])).toEqual({ a: { attendance: 'late', late_minutes: 12 } });
  });

  it('drops minutes that are not a whole number in range', () => {
    expect(validateRollCallDraft({ a: { attendance: 'late', late_minutes: -1 } }, ['a'])).toEqual({ a: { attendance: 'late' } });
    expect(validateRollCallDraft({ a: { attendance: 'late', late_minutes: 2000 } }, ['a'])).toEqual({ a: { attendance: 'late' } });
  });

  it('shows the server’s marks under this device’s', () => {
    expect(mergeMarks(roster, { a: { attendance: 'on_time' } })).toEqual({
      a: { attendance: 'on_time', lateMinutes: '' },
      b: { attendance: 'late', lateMinutes: '5' },
    });
    expect(mergeMarks(roster, { b: { attendance: 'late' } }).b).toEqual({ attendance: 'late', lateMinutes: '' });
  });

  it('stores a mark only once an attendance is picked', () => {
    expect(toStoredMark({ attendance: null, lateMinutes: '3' })).toBeNull();
    expect(toStoredMark({ attendance: 'late', lateMinutes: '12' })).toEqual({ attendance: 'late', late_minutes: 12 });
    expect(toStoredMark({ attendance: 'late', lateMinutes: '' })).toEqual({ attendance: 'late' });
    expect(toStoredMark({ attendance: 'on_time', lateMinutes: '1.5' })).toEqual({ attendance: 'on_time' });
  });

  it('is empty with no marks', () => {
    expect(isRollCallDraftEmpty({})).toBe(true);
    expect(isRollCallDraftEmpty({ a: { attendance: 'excused' } })).toBe(false);
  });
});

describe('validateSessionDraft', () => {
  it('drops people who left and a slot that passed', () => {
    const raw = { invite: ['b', 'gone'], custom: '', chosen: '2020-01-01T12:00:00.000Z' };
    expect(validateSessionDraft(raw, ['b'], ['2030-01-04T12:00:00.000Z'])).toEqual({ invite: ['b'], custom: '', chosen: null });
  });

  it('keeps a slot that is still offered and a datetime-local value', () => {
    const raw = { invite: [], custom: '2030-01-04T20:00', chosen: '2030-01-04T12:00:00.000Z' };
    expect(validateSessionDraft(raw, [], ['2030-01-04T12:00:00.000Z'])).toEqual(raw);
  });

  it('refuses a custom time that is not a datetime-local value', () => {
    expect(validateSessionDraft({ invite: [], custom: 'tomorrow', chosen: null }, [], [])).toBeNull();
  });

  it('counts as a draft only once someone is picked', () => {
    expect(isSessionDraftEmpty({ invite: [], custom: '2030-01-04T20:00', chosen: null })).toBe(true);
    expect(isSessionDraftEmpty({ invite: ['b'], custom: '', chosen: null })).toBe(false);
  });
});

describe('validateOnboardingDraft', () => {
  it('keeps a choice the user may make', () => {
    const raw = { choice: 'both', useNanako: false, customName: '小七' };
    expect(validateOnboardingDraft(raw, true)).toEqual(raw);
  });

  it('never pre-picks a judge role for someone who is not one', () => {
    expect(validateOnboardingDraft({ choice: 'judge', useNanako: true, customName: '' }, false)).toBeNull();
    expect(validateOnboardingDraft({ choice: 'participant', useNanako: true, customName: '' }, false)).toEqual({
      choice: 'participant',
      useNanako: true,
      customName: '',
    });
  });

  it('refuses an unknown choice or a too-long name', () => {
    expect(validateOnboardingDraft({ choice: 'admin', useNanako: true, customName: '' }, true)).toBeNull();
    expect(validateOnboardingDraft({ choice: 'participant', useNanako: false, customName: '名'.repeat(25) }, true)).toBeNull();
  });
});
