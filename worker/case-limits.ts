// Write-side input validation and the per-day filing caps.
//
// Shared by cases.ts (statement / verdict) and case-filing.ts (filing), and kept
// separate from both so neither has to import the other.

import {
  MAX_NARRATIVE_LEN,
  STATEMENT_WINDOW_HOURS,
  WEEKLY_BONUS_CAP,
} from '../shared/scoring';
import type { Env } from './types';
import type { RowGuard } from './db';
import { ApiError } from './errors';
import { SCORED_STATUSES } from './case-reads';
import { sqlNowMinusMinutes, weekStartUtcSql } from './time';

/**
 * A judge may not file more than this many cases in a rolling 24h.
 * Raised for v3: one multi-subject filing counts per head, so a couple of 8-person
 * batches would otherwise exhaust the old cap of 20 in a single evening.
 */
export const MAX_CASES_PER_REPORTER_24H = 40;
/** A single player may not be hauled in more than this many times in 24h. */
export const MAX_CASES_PER_SUBJECT_24H = 5;


// --- Input validation --------------------------------------------------------

export function normalizeNote(note: string | undefined): string | null {
  if (note === undefined) return null;
  const trimmed = note.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, 500);
}

export function normalizeNarrative(raw: string, label: string, minLen: number): string {
  const trimmed = raw.trim();
  if (trimmed.length < minLen) {
    throw new ApiError(400, `${label}太短了，至少写 ${minLen} 个字说清楚发生了什么`);
  }
  if (trimmed.length > MAX_NARRATIVE_LEN) {
    throw new ApiError(400, `${label}最多 ${MAX_NARRATIVE_LEN} 个字`);
  }
  return trimmed;
}

export function statementWindowHours(env: Env): number {
  const n = Number(env.STATEMENT_WINDOW_HOURS);
  if (!Number.isFinite(n) || n <= 0 || n > 24 * 14) return STATEMENT_WINDOW_HOURS;
  return n;
}

export async function assertRateLimits(
  db: D1Database,
  reporterId: string,
  subjectId: string,
): Promise<void> {
  const since = sqlNowMinusMinutes(24 * 60);
  const byReporter = await db
    .prepare(
      // Withdrawn cases count too: filing and withdrawing still DMs the
      // subject each time, so it must not be a way around the limit.
      'SELECT COUNT(*) AS n FROM records WHERE reporter_id = ? AND created_at >= ?',
    )
    .bind(reporterId, since)
    .first<{ n: number }>();
  if ((byReporter?.n ?? 0) >= MAX_CASES_PER_REPORTER_24H) {
    throw new ApiError(429, `24 小时内最多立案 ${MAX_CASES_PER_REPORTER_24H} 次，先歇歇`);
  }
  const onSubject = await db
    .prepare(
      'SELECT COUNT(*) AS n FROM records WHERE subject_id = ? AND created_at >= ?',
    )
    .bind(subjectId, since)
    .first<{ n: number }>();
  if ((onSubject?.n ?? 0) >= MAX_CASES_PER_SUBJECT_24H) {
    throw new ApiError(429, `该选手 24 小时内已被立案 ${MAX_CASES_PER_SUBJECT_24H} 次，明天再说`);
  }
}

/** True when `delta` more bonus points still fit under this week's cap. */
export async function fitsWeeklyBonusCap(
  db: D1Database,
  subjectId: string,
  delta: number,
  offsetHours: number,
): Promise<boolean> {
  const since = weekStartUtcSql(offsetHours);
  const agg = await db
    .prepare(
      `SELECT COALESCE(SUM(delta), 0) AS total FROM records
       WHERE subject_id = ? AND delta > 0 AND status IN ${SCORED_STATUSES} AND created_at >= ?`,
    )
    .bind(subjectId, since)
    .first<{ total: number }>();
  return (agg?.total ?? 0) + delta <= WEEKLY_BONUS_CAP;
}

/**
 * The same cap as a guard for scoreMutation(): evaluated inside the write,
 * after the user row is locked, so two bonuses filed at once for one player
 * cannot both slip under it.
 */
export function bonusCapGuard(subjectId: string, delta: number, offsetHours: number): RowGuard {
  return {
    sql: `(SELECT COALESCE(SUM(delta), 0) FROM records
            WHERE subject_id = ? AND delta > 0 AND status IN ${SCORED_STATUSES} AND created_at >= ?) + ? <= ?`,
    binds: [subjectId, weekStartUtcSql(offsetHours), delta, WEEKLY_BONUS_CAP],
  };
}

/** Thrown when the week's bonus cap is reached — settlement skips these instead of failing. */
export class BonusCapReached extends ApiError {
  constructor() {
    super(400, `本周奖励分已达上限 (${WEEKLY_BONUS_CAP})`);
  }
}

export async function assertWeeklyBonusCap(
  db: D1Database,
  subjectId: string,
  delta: number,
  offsetHours: number,
): Promise<void> {
  if (!(await fitsWeeklyBonusCap(db, subjectId, delta, offsetHours))) {
    throw new BonusCapReached();
  }
}

