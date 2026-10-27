import { describe, expect, it } from 'vitest';
import {
  PENDING_HIDDEN_DELTA,
  PENDING_HIDDEN_LABEL,
  isPendingHidden,
  pendingHiddenSentence,
  violationDef,
  violationLabel,
} from '../../src/lib/recordView';
import { computeTrends } from '../../src/lib/feedStats';
import { computeWeekHighlights } from '../../src/lib/weekStars';
import type { CaseStatus, RecordItem, ViolationType } from '../../src/types';

// B1-1 (spec §11 #3 tier b): before the verdict, the API tells an outsider only
// that a case exists. These helpers name such a case; the week's numbers never
// count it.

const NEXT_RESET = '2026-11-01T16:00:00.000Z'; // Monday 00:00 in Beijing
const IN_WEEK = '2026-10-27 12:00:00';
const LAST_WEEK = '2026-10-25 15:00:00';

function rec(id: number, subjectId: string, type: ViolationType, delta: number, status: CaseStatus, created_at = IN_WEEK): RecordItem {
  return {
    id,
    subject: { id: subjectId, username: subjectId, avatar_url: null },
    reporter: { id: 'j', username: '裁判', avatar_url: null },
    type,
    delta,
    note: null,
    claim: null,
    claim_summary: null,
    classified_by: 'derived',
    escalation_suggested: false,
    session_id: null,
    statement: null,
    statement_at: null,
    appeal_reason: null,
    deadline_at: null,
    status,
    verdict: null,
    range: { min: delta, max: delta, base: delta },
    created_at,
  };
}

/** What the API sends an outsider for a case still awaiting its verdict. */
function hidden(id: number, subjectId: string, status: CaseStatus = 'awaiting_statement'): RecordItem {
  return {
    ...rec(id, subjectId, 'no_show', 0, status),
    type: null,
    range: null,
    redacted: true,
    pending_hidden: true,
  };
}

describe('recordView — naming a case', () => {
  it('says 处理中 for a type the API hid, and the rules label otherwise', () => {
    expect(PENDING_HIDDEN_LABEL).toBe('处理中');
    expect(violationLabel(null)).toBe('处理中');
    expect(violationLabel('no_show')).toBe('放鸽子');
    expect(violationLabel('late_major')).toBe('大迟到');
  });

  it('falls back to the raw type a newer API might send', () => {
    expect(violationLabel('brand_new' as ViolationType)).toBe('brand_new');
    expect(violationDef('brand_new' as ViolationType)).toBeUndefined();
  });

  it('has no rules entry for a hidden type', () => {
    expect(violationDef(null)).toBeUndefined();
    expect(violationDef('no_show')?.kind).toBe('penalty');
  });

  it('tells who has a case in progress, and that the score waits for the verdict', () => {
    expect(pendingHiddenSentence('老王')).toBe('老王有一起记录在处理中，判决后公开。');
    expect(PENDING_HIDDEN_DELTA).toBe('分数变化：判决后公开');
  });

  it('reads the flag only when it is exactly true (an older API sends none)', () => {
    expect(isPendingHidden({ pending_hidden: true })).toBe(true);
    expect(isPendingHidden({ pending_hidden: false })).toBe(false);
    expect(isPendingHidden({})).toBe(false);
  });
});

describe('the week’s numbers ignore a hidden case', () => {
  const OLD = rec(1, '老王', 'organizer_bonus', 2, 'decided', LAST_WEEK);

  it('still finds the stars, and a hidden case of theirs takes nothing away', () => {
    const records = [hidden(9, '阿杰'), hidden(8, '阿杰', 'judging'), rec(3, '阿杰', 'on_time_bonus', 2, 'decided'), rec(2, '阿杰', 'on_time_bonus', 2, 'decided'), OLD];
    expect(computeWeekHighlights(records, NEXT_RESET)).toEqual({
      kind: 'stars',
      stars: [{ user: { id: '阿杰', username: '阿杰', avatar_url: null }, onTime: 2 }],
    });
  });

  it('never moves the week’s trend', () => {
    expect(computeTrends([hidden(9, '阿杰'), OLD], NEXT_RESET)).toEqual({});
  });
});
