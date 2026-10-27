// Per-player numbers the home page derives from the loaded feed (the newest
// CORE_FEED_LIMIT records). Pure — unit-tested in tests/unit/feed-stats.test.ts.
import { affectsScore } from '@shared/scoring';
import type { RecordItem } from '../types';
import { parseTimestamp } from './time';

/** One heal week. */
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Start of the current heal week (ms): one week before the next reset. NaN if unparseable. */
export function weekStartOf(nextResetAt: string): number {
  return parseTimestamp(nextResetAt) - WEEK_MS;
}

/** Filed in the current heal week. An unparseable timestamp never counts. */
export function inWeek(record: RecordItem, weekStart: number): boolean {
  const at = parseTimestamp(record.created_at);
  return !Number.isNaN(at) && at >= weekStart;
}

/** Sum of scored deltas per subject within the current heal week. */
export function computeTrends(
  records: readonly RecordItem[],
  nextResetAt: string,
): Record<string, number> {
  const weekStart = weekStartOf(nextResetAt);
  return records
    .filter((r) => affectsScore(r.status) && inWeek(r, weekStart))
    .reduce<Record<string, number>>(
      (acc, r) => ({ ...acc, [r.subject.id]: (acc[r.subject.id] ?? 0) + r.delta }),
      {},
    );
}

/** Count of records involving each subject (from the loaded feed). */
export function computeCounts(records: readonly RecordItem[]): Record<string, number> {
  return records.reduce<Record<string, number>>(
    (acc, r) => ({ ...acc, [r.subject.id]: (acc[r.subject.id] ?? 0) + 1 }),
    {},
  );
}
