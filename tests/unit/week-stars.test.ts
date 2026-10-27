import { describe, expect, it } from 'vitest';
import { computeWeekHighlights } from '../../src/lib/weekStars';
import type { CaseStatus, RecordItem, ViolationType } from '../../src/types';

// 本周之星 (spec §5 #1, §9 P0-4): only from decided records, only when the
// feed covers the whole week, never ranked by name, never a 鸽王.

const NEXT_RESET = '2026-11-01T16:00:00.000Z'; // Monday 00:00 in Beijing
const IN_WEEK = '2026-10-27 12:00:00'; // SQLite UTC
const LAST_WEEK = '2026-10-25 15:00:00'; // an hour before the week started

function rec(
  id: number,
  subjectId: string,
  type: ViolationType,
  delta: number,
  status: CaseStatus = 'decided',
  created_at = IN_WEEK,
): RecordItem {
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

const onTime = (id: number, who: string, status: CaseStatus = 'decided'): RecordItem =>
  rec(id, who, 'on_time_bonus', 2, status);
/** The oldest row in the feed is from last week: the week is fully covered. */
const OLD = rec(1, '老王', 'organizer_bonus', 2, 'decided', LAST_WEEK);

describe('computeWeekHighlights — the whole-week threshold', () => {
  it('hides on an empty feed', () => {
    expect(computeWeekHighlights([], NEXT_RESET)).toEqual({ kind: 'hidden' });
  });

  it('hides when the feed does not reach back past the week start', () => {
    const records = [onTime(4, '阿杰'), onTime(3, '阿杰'), onTime(2, '阿杰')];
    expect(computeWeekHighlights(records, NEXT_RESET)).toEqual({ kind: 'hidden' });
  });

  it('hides when nextResetAt cannot be read', () => {
    expect(computeWeekHighlights([onTime(3, '阿杰'), onTime(2, '阿杰'), OLD], 'soon')).toEqual({
      kind: 'hidden',
    });
  });
});

describe('computeWeekHighlights — stars', () => {
  it('needs at least two decided on-time bonuses this week', () => {
    const result = computeWeekHighlights(
      [onTime(5, '阿杰'), onTime(4, '小红'), onTime(3, '阿杰'), onTime(2, '阿杰'), OLD],
      NEXT_RESET,
    );
    expect(result).toEqual({
      kind: 'stars',
      stars: [{ user: { id: '阿杰', username: '阿杰', avatar_url: null }, onTime: 3 }],
    });
  });

  it('lists every tie, most bonuses first, then feed order — not by name', () => {
    // Feed is newest first: 阿杰 shows up before 小红. By code point 小红 sorts
    // first, so a name sort would flip them.
    const records = [onTime(6, '阿杰'), onTime(5, '小红'), onTime(4, '阿杰'), onTime(3, '小红'), onTime(2, '老王'), onTime(7, '老王'), onTime(8, '老王'), OLD];
    const result = computeWeekHighlights(records, NEXT_RESET);
    expect(result.kind).toBe('stars');
    if (result.kind !== 'stars') return;
    expect(result.stars.map((s) => [s.user.id, s.onTime])).toEqual([
      ['老王', 3],
      ['阿杰', 2],
      ['小红', 2],
    ]);
  });

  it('a low score is no bar: last week’s heavy penalty does not count against this week', () => {
    // 阿杰 lost 25 last week (so he sits low on the board) and was on time twice since.
    const records = [onTime(4, '阿杰'), onTime(3, '阿杰'), rec(2, '阿杰', 'no_show_group', -25, 'decided', LAST_WEEK), OLD];
    const result = computeWeekHighlights(records, NEXT_RESET);
    expect(result.kind === 'stars' && result.stars.map((s) => s.user.id)).toEqual(['阿杰']);
  });

  it('a decided penalty this week rules a player out', () => {
    const records = [onTime(4, '阿杰'), onTime(3, '阿杰'), rec(2, '阿杰', 'late_minor', -3), OLD];
    expect(computeWeekHighlights(records, NEXT_RESET)).toEqual({ kind: 'none' });
  });

  it('open, revoked or withdrawn cases, and last week, do not count either way', () => {
    const records = [
      onTime(7, '阿杰'),
      onTime(6, '阿杰'),
      onTime(5, '小红', 'revoked'),
      onTime(4, '小红'),
      rec(3, '阿杰', 'no_show', 0, 'awaiting_statement'),
      rec(2, '阿杰', 'no_show', -12, 'revoked'),
      rec(1, '阿杰', 'no_show', -12, 'decided', LAST_WEEK),
    ];
    const result = computeWeekHighlights(records, NEXT_RESET);
    expect(result.kind).toBe('stars');
    if (result.kind !== 'stars') return;
    expect(result.stars.map((s) => s.user.id)).toEqual(['阿杰']);
  });
});

describe('computeWeekHighlights — nobody qualifies', () => {
  it('says all-clean when this week has no decided penalty', () => {
    expect(computeWeekHighlights([onTime(2, '阿杰'), OLD], NEXT_RESET)).toEqual({ kind: 'all-clean' });
  });

  it('says none when someone was penalized this week', () => {
    const records = [onTime(3, '阿杰'), rec(2, '小红', 'no_show', -12, 'appealed'), OLD];
    expect(computeWeekHighlights(records, NEXT_RESET)).toEqual({ kind: 'none' });
  });

  it('a board tied at full marks names nobody — there is no 鸽王 kind at all', () => {
    const result = computeWeekHighlights([onTime(3, '阿杰'), onTime(2, '小红'), OLD], NEXT_RESET);
    expect(result).toEqual({ kind: 'all-clean' });
    expect(JSON.stringify(result)).not.toContain('鸽王');
  });
});
