// 每周周报：统计 + 惰性生成 + 幂等落库。
//
// Every figure here comes out of SQL. worker/ai/report.ts only turns these into a
// paragraph — see the iron rule at the top of that file. Keeping the arithmetic
// on this side is what makes the report trustworthy enough to show on the front
// page without anyone auditing it.

import { VIOLATION_MAP } from '../shared/scoring';
import type { Env } from './types';
import { ApiError } from './errors';
import { loadAiConfig } from './ai/config';
import { fallbackNarrative, writeNarrative, type ReportStats } from './ai/report';
import { weekStartLocal, weekStartUtcSql } from './time';

const DAY_MS = 86_400_000;

/**
 * Last week's report is written from Monday 10:30 on (board time), not at
 * midnight: a case filed late on Sunday has had the morning to be answered and
 * judged, so it counts in the week it belongs to — and a report pushed to the
 * channel (P8) does not wake anyone up.
 */
export const REPORT_DUE_AFTER_MS = (10 * 60 + 30) * 60_000;

/** Is it past Monday 10:30 in the board's week? */
export function reportDue(offsetHours: number, now = Date.now()): boolean {
  const local = now + offsetHours * 3_600_000;
  const daysSinceMonday = (new Date(local).getUTCDay() + 6) % 7;
  const sinceMidnight = ((local % DAY_MS) + DAY_MS) % DAY_MS;
  return daysSinceMonday * DAY_MS + sinceMidnight >= REPORT_DUE_AFTER_MS;
}

export interface WeeklyReport {
  week_start: string;
  stats: ReportStats;
  narrative: string;
  source: 'ai' | 'fallback';
  created_at: string;
}

interface ReportRow {
  week_start: string;
  stats_json: string;
  narrative: string;
  source: string;
  created_at: string;
}

/** Local Monday of the week BEFORE the current one — the week being reported on. */
export function previousWeekStart(offsetHours: number): string {
  const current = weekStartLocal(offsetHours);
  const ms = Date.parse(`${current}T00:00:00Z`) - 7 * DAY_MS;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Sqlite-datetime bounds (UTC) for a local week starting at `weekStart`. */
function weekBounds(weekStart: string, offsetHours: number): { from: string; to: string } {
  const localMidnightUtc = Date.parse(`${weekStart}T00:00:00Z`) - offsetHours * 3_600_000;
  const fmt = (ms: number): string =>
    new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
  return { from: fmt(localMidnightUtc), to: fmt(localMidnightUtc + 7 * DAY_MS) };
}

interface NamedDelta {
  name: string;
  delta: number;
}

async function firstRow<T>(
  db: D1Database,
  sql: string,
  binds: unknown[],
): Promise<T | null> {
  return db
    .prepare(sql)
    .bind(...binds)
    .first<T>();
}

/**
 * Compute the week's figures. Read-only; safe to call for any past week.
 *
 * Note every aggregate excludes `weekly_heal` events — the automatic +15 would
 * otherwise dominate "本周之星" and make the award meaningless — and an admin's
 * direct score corrections, which are no one's doing that week.
 */
export async function computeStats(
  db: D1Database,
  weekStart: string,
  offsetHours: number,
): Promise<ReportStats> {
  const { from, to } = weekBounds(weekStart, offsetHours);
  const weekEnd = new Date(Date.parse(`${weekStart}T00:00:00Z`) + 6 * DAY_MS)
    .toISOString()
    .slice(0, 10);

  const sessions = await firstRow<{ played: number }>(
    db,
    `SELECT COUNT(*) AS played FROM game_sessions
      WHERE status = 'settled' AND starts_at >= ? AND starts_at < ?`,
    [new Date(Date.parse(from + 'Z')).toISOString(), new Date(Date.parse(to + 'Z')).toISOString()],
  );

  const cases = await firstRow<{ filed: number; total: number; absent: number }>(
    db,
    `SELECT COUNT(*) AS filed,
            COALESCE(SUM(CASE WHEN delta < 0 THEN delta ELSE 0 END), 0) AS total,
            COALESCE(SUM(CASE WHEN statement IS NULL AND verdict_source IN ('ai','fallback')
                              THEN 1 ELSE 0 END), 0) AS absent
       FROM records
      WHERE created_at >= ? AND created_at < ? AND status IN ('decided','appealed')`,
    [from, to],
  );

  const collapsed = await firstRow<{ n: number }>(
    db,
    `SELECT COUNT(DISTINCT session_id) AS n FROM records
      WHERE session_id IS NOT NULL AND type = 'no_show_group'
        AND created_at >= ? AND created_at < ? AND status IN ('decided','appealed')`,
    [from, to],
  );

  // Net score movement per player, ignoring the automatic weekly heal.
  const movers = await db
    .prepare(
      `SELECT COALESCE(u.display_name, u.username) AS name, SUM(e.delta) AS delta
         FROM score_events e JOIN users u ON u.id = e.user_id
        WHERE e.created_at >= ? AND e.created_at < ? AND e.reason NOT IN ('weekly_heal', 'admin_adjust')
        GROUP BY u.id HAVING SUM(e.delta) != 0
        ORDER BY delta DESC, u.id ASC`,
    )
    .bind(from, to)
    .all<NamedDelta>();
  const ranked = movers.results;
  const star = ranked.length > 0 && ranked[0].delta > 0 ? ranked[0] : null;
  const last = ranked.length > 0 ? ranked[ranked.length - 1] : null;
  const pigeon = last && last.delta < 0 ? last : null;

  // 「最会说话奖」: among sentenced penalties, who ended furthest ABOVE the anchor.
  // The anchor lives in shared/scoring.ts, not the DB, so the comparison is done
  // in JS over a small candidate set rather than faked in SQL.
  const sentenced = await db
    .prepare(
      `SELECT COALESCE(u.display_name, u.username) AS name, r.type AS type, r.delta AS delta
         FROM records r JOIN users u ON u.id = r.subject_id
        WHERE r.created_at >= ? AND r.created_at < ?
          AND r.status IN ('decided','appealed')
          AND r.verdict_source IN ('ai','fallback')
          AND r.delta < 0`,
    )
    .bind(from, to)
    .all<{ name: string; type: string; delta: number }>();

  let bestTalker: ReportStats['bestTalker'] = null;
  let harshest: NamedDelta | null = null;
  for (const row of sentenced.results) {
    const def = VIOLATION_MAP[row.type];
    if (!def) continue;
    const saved = row.delta - def.base; // positive = judged lighter than the anchor
    if (saved > 0 && (bestTalker === null || saved > bestTalker.savedBy)) {
      bestTalker = { name: row.name, savedBy: saved };
    }
    if (harshest === null || row.delta < harshest.delta) {
      harshest = { name: row.name, delta: row.delta };
    }
  }

  const organizer = await firstRow<{ name: string; count: number }>(
    db,
    `SELECT COALESCE(u.display_name, u.username) AS name, COUNT(*) AS count
       FROM game_sessions g JOIN users u ON u.id = g.organizer_id
      WHERE g.status = 'settled' AND g.starts_at >= ? AND g.starts_at < ?
      GROUP BY u.id ORDER BY count DESC, name ASC, u.id ASC LIMIT 1`,
    [new Date(Date.parse(from + 'Z')).toISOString(), new Date(Date.parse(to + 'Z')).toISOString()],
  );

  const attendance = await firstRow<{ shown: number; marked: number }>(
    db,
    `SELECT COALESCE(SUM(CASE WHEN sp.attendance IN ('on_time','late') THEN 1 ELSE 0 END), 0) AS shown,
            COUNT(sp.attendance) AS marked
       FROM session_players sp JOIN game_sessions g ON g.id = sp.session_id
      WHERE g.starts_at >= ? AND g.starts_at < ?`,
    [new Date(Date.parse(from + 'Z')).toISOString(), new Date(Date.parse(to + 'Z')).toISOString()],
  );

  const upcoming = await firstRow<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM game_sessions
      WHERE status = 'open' AND starts_at >= ?`,
    [new Date().toISOString()],
  );

  return {
    weekStart,
    weekEnd,
    sessionsPlayed: sessions?.played ?? 0,
    sessionsCollapsed: collapsed?.n ?? 0,
    casesFiled: cases?.filed ?? 0,
    totalPenalty: cases?.total ?? 0,
    absentVerdicts: cases?.absent ?? 0,
    attendanceRate:
      attendance && attendance.marked > 0 ? attendance.shown / attendance.marked : null,
    upcomingNextWeek: upcoming?.n ?? 0,
    star: star ? { name: star.name, delta: star.delta } : null,
    pigeon: pigeon ? { name: pigeon.name, delta: pigeon.delta } : null,
    bestTalker,
    harshest,
    topOrganizer: organizer ? { name: organizer.name, count: organizer.count } : null,
  };
}

/** Was there anything at all worth writing about? */
export function hadActivity(stats: ReportStats): boolean {
  return (
    stats.casesFiled > 0 ||
    stats.sessionsPlayed > 0 ||
    stats.star !== null ||
    stats.pigeon !== null
  );
}

function toReport(row: ReportRow): WeeklyReport {
  return {
    week_start: row.week_start,
    stats: JSON.parse(row.stats_json) as ReportStats,
    narrative: row.narrative,
    source: row.source === 'ai' ? 'ai' : 'fallback',
    created_at: row.created_at,
  };
}

export async function getReport(
  db: D1Database,
  weekStart: string,
): Promise<WeeklyReport | null> {
  const row = await db
    .prepare('SELECT * FROM weekly_reports WHERE week_start = ?')
    .bind(weekStart)
    .first<ReportRow>();
  return row ? toReport(row) : null;
}

export async function getLatestReport(db: D1Database): Promise<WeeklyReport | null> {
  const row = await db
    .prepare('SELECT * FROM weekly_reports ORDER BY week_start DESC LIMIT 1')
    .first<ReportRow>();
  return row ? toReport(row) : null;
}

/**
 * Generate last week's report if it does not exist yet — once it is due
 * (Monday 10:30, see REPORT_DUE_AFTER_MS).
 *
 * Idempotent the same way `weeklyHeal` is: `week_start` is the primary key, and
 * the row is claimed with `INSERT … ON CONFLICT DO NOTHING` BEFORE the AI call. Claiming first
 * means a burst of Monday-morning visitors produces exactly one narrative
 * request, not one per visitor.
 */
export async function ensureWeeklyReport(
  db: D1Database,
  env: Env,
  offsetHours: number,
  now = Date.now(),
): Promise<WeeklyReport | null> {
  const weekStart = previousWeekStart(offsetHours);
  const existing = await getReport(db, weekStart);
  if (existing) return existing;
  if (!reportDue(offsetHours, now)) return null;

  const stats = await computeStats(db, weekStart, offsetHours);
  // Nothing happened at all — a card full of zeros is worse than no card, and on
  // a fresh install it would be the very first thing a visitor sees. An admin can
  // still force one via regenerateReport.
  if (!hadActivity(stats)) return null;

  // Claim the slot with the deterministic text first. If another request beat us
  // to it, changes = 0 and we skip the AI call entirely.
  const claimed = await db
    .prepare(
      `INSERT INTO weekly_reports (week_start, stats_json, narrative, source)
       VALUES (?, ?, ?, 'fallback')
       ON CONFLICT (week_start) DO NOTHING`,
    )
    .bind(weekStart, JSON.stringify(stats), fallbackNarrative(stats))
    .run();
  if ((claimed.meta?.changes ?? 0) === 0) {
    return getReport(db, weekStart);
  }

  const cfg = await loadAiConfig(db, env);
  const result = await writeNarrative(cfg, stats);
  if (result.source === 'ai') {
    await db
      .prepare("UPDATE weekly_reports SET narrative = ?, source = 'ai' WHERE week_start = ?")
      .bind(result.narrative, weekStart)
      .run();
  } else if (result.error) {
    console.error(`weekly report ${weekStart} fell back to template`, result.error);
  }
  return getReport(db, weekStart);
}

/** Admin re-roll: recompute the stats and ask for a fresh paragraph. */
export async function regenerateReport(
  db: D1Database,
  env: Env,
  weekStart: string,
  offsetHours: number,
): Promise<WeeklyReport> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    throw new ApiError(400, '周起始日格式应为 YYYY-MM-DD');
  }
  const stats = await computeStats(db, weekStart, offsetHours);
  const cfg = await loadAiConfig(db, env);
  const result = await writeNarrative(cfg, stats);
  await db
    .prepare(
      `INSERT INTO weekly_reports (week_start, stats_json, narrative, source)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(week_start) DO UPDATE SET
         stats_json = excluded.stats_json,
         narrative  = excluded.narrative,
         source     = excluded.source,
         created_at = datetime('now')`,
    )
    .bind(weekStart, JSON.stringify(stats), result.narrative, result.source)
    .run();
  const saved = await getReport(db, weekStart);
  if (!saved) throw new ApiError(500, '生成周报失败');
  return saved;
}

export { weekStartUtcSql };
