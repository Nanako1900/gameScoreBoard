import { describe, expect, it } from 'vitest';
import { computeCounts, computeTrends, WEEK_MS, weekStartOf } from '../../src/lib/feedStats';
import type { CaseStatus, RecordItem, ViolationType } from '../../src/types';

// Moved out of App.tsx unchanged in behaviour: trends count only scored
// records filed since the week's start; counts take every record in the feed.

const NEXT_RESET = '2026-11-01T16:00:00.000Z'; // Monday 00:00 in Beijing
const IN_WEEK = '2026-10-27 12:00:00'; // SQLite UTC
const LAST_WEEK = '2026-10-25 15:00:00'; // an hour before the week started

function rec(
  id: number,
  subjectId: string,
  delta: number,
  status: CaseStatus = 'decided',
  created_at = IN_WEEK,
  type: ViolationType = 'no_show',
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
    classified_by: 'ai',
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

describe('weekStartOf', () => {
  it('is one week before the next reset', () => {
    expect(weekStartOf(NEXT_RESET)).toBe(Date.parse(NEXT_RESET) - WEEK_MS);
  });

  it('is NaN for an unparseable reset', () => {
    expect(weekStartOf('soon')).toBeNaN();
  });
});

describe('computeTrends', () => {
  it('sums decided and appealed deltas filed this week', () => {
    const records = [
      rec(1, 'a', -10),
      rec(2, 'a', 2, 'appealed'),
      rec(3, 'b', 2, 'decided', IN_WEEK, 'on_time_bonus'),
    ];
    expect(computeTrends(records, NEXT_RESET)).toEqual({ a: -8, b: 2 });
  });

  it('ignores open, revoked and withdrawn cases and last week', () => {
    const records = [
      rec(1, 'a', 0, 'awaiting_statement'),
      rec(2, 'a', -10, 'revoked'),
      rec(3, 'a', -10, 'withdrawn'),
      rec(4, 'a', -10, 'decided', LAST_WEEK),
    ];
    expect(computeTrends(records, NEXT_RESET)).toEqual({});
  });
});

describe('computeCounts', () => {
  it('counts every record per subject', () => {
    const records = [rec(1, 'a', -10), rec(2, 'a', 0, 'withdrawn'), rec(3, 'b', 2, 'decided', LAST_WEEK)];
    expect(computeCounts(records)).toEqual({ a: 2, b: 1 });
  });
});
