import { readDraft, type DraftKind } from '../../src/lib/drafts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APPEAL_MAX, MAX_NARRATIVE_LEN } from '../../shared/scoring';
import {
  isCaseDraftEmpty,
  validateAppealDraft,
  validateCaseDraft,
  validateOnboardingDraft,
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

describe('retired drafts', () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each(['rollcall', 'session'])('ignores a leftover %s draft before invoking its validator', (kind) => {
    const getItem = vi.fn(() => JSON.stringify({ v: 1, savedAt: 1, value: { a: { attendance: 'late' } } }));
    vi.stubGlobal('localStorage', { getItem, removeItem: vi.fn() });
    vi.stubGlobal('sessionStorage', { getItem, removeItem: vi.fn() });
    const validate = vi.fn((value: unknown) => value);
    expect(() => readDraft(kind as DraftKind, 1, validate)).not.toThrow();
    expect(readDraft(kind as DraftKind, 1, validate)).toBeNull();
    expect(validate).not.toHaveBeenCalled();
  });
});
