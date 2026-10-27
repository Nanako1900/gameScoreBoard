// 本周之星 from the loaded feed (spec §5 #1). Pure — tests/unit/week-stars.test.ts.
//
// The feed is only the newest CORE_FEED_LIMIT records, so a busy week can be
// cut off part-way. Naming anyone from a truncated week would be guessing; the
// row is hidden unless the feed reaches back past the week's start. P4 swaps
// this for the API's week_* fields and drops the threshold.
import { affectsScore } from '@shared/scoring';
import type { RecordItem, UserRef } from '../types';
import { WEEK_STAR_MIN_ON_TIME } from './constants';
import { inWeek, weekStartOf } from './feedStats';
import { parseTimestamp } from './time';

export interface WeekStar {
  user: UserRef;
  onTime: number;
}

export type WeekHighlightsResult =
  | { kind: 'hidden' }
  | { kind: 'stars'; stars: readonly WeekStar[] }
  | { kind: 'all-clean' }
  | { kind: 'none' };

/** The oldest record in the feed predates the week, so the whole week is in it. */
function coversWholeWeek(records: readonly RecordItem[], weekStart: number): boolean {
  const times = records
    .map((r) => parseTimestamp(r.created_at))
    .filter((at) => !Number.isNaN(at));
  return times.length > 0 && !Number.isNaN(weekStart) && Math.min(...times) < weekStart;
}

/** On-time bonuses per subject, in the order each subject first appears in the feed. */
function countOnTime(decided: readonly RecordItem[]): readonly WeekStar[] {
  return decided
    .filter((r) => r.type === 'on_time_bonus')
    .reduce<readonly WeekStar[]>((acc, r) => {
      const at = acc.findIndex((s) => s.user.id === r.subject.id);
      return at === -1
        ? [...acc, { user: r.subject, onTime: 1 }]
        : acc.map((s, i) => (i === at ? { ...s, onTime: s.onTime + 1 } : s));
    }, []);
}

/**
 * Stars: ≥ WEEK_STAR_MIN_ON_TIME decided 守约守时 this week and no decided
 * penalty this week. Score plays no part, so a low score can still win. Ties
 * are all listed — most bonuses first, then feed order, never by name.
 */
export function computeWeekHighlights(
  records: readonly RecordItem[],
  nextResetAt: string,
): WeekHighlightsResult {
  const weekStart = weekStartOf(nextResetAt);
  if (!coversWholeWeek(records, weekStart)) {
    return { kind: 'hidden' };
  }
  const decided = records.filter((r) => affectsScore(r.status) && inWeek(r, weekStart));
  const penalized = new Set(decided.filter((r) => r.delta < 0).map((r) => r.subject.id));
  // Array.prototype.sort is stable, so equal counts keep their feed order.
  const stars = [...countOnTime(decided)]
    .filter((s) => s.onTime >= WEEK_STAR_MIN_ON_TIME && !penalized.has(s.user.id))
    .sort((a, b) => b.onTime - a.onTime);
  if (stars.length > 0) {
    return { kind: 'stars', stars };
  }
  return penalized.size === 0 ? { kind: 'all-clean' } : { kind: 'none' };
}
