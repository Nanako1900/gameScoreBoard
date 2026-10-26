// D1 data-access layer: users, roles, profiles, score application, weekly heal.
// Case (records) logic lives in worker/cases.ts; sessions in worker/sessions.ts.
//
// PREPARED STATEMENTS ONLY — every value is bound with `?`, never concatenated.
// Column names in dynamic SET/WHERE clauses are static literals. All boolean
// outputs convert D1's 0/1 integers to real booleans.

import {
  BASE_SCORE,
  MAX_SCORE,
  MIN_SCORE,
  WEEKLY_HEAL,
  clampScore,
} from '../shared/scoring';
import type {
  HistoryPoint,
  PublicUser,
  RecordItem,
  ScoreEventRow,
  User,
  UserRow,
} from './types';
import { ApiError } from './errors';
import { listRecords } from './cases';
import { weekStartLocal } from './time';
import type { OAuthProfile } from './oauth';

export { ApiError };

// --- Mappers -----------------------------------------------------------------

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.display_name ?? row.username,
    oauth_username: row.username,
    avatar_url: row.avatar_url,
    is_participant: row.is_participant === 1,
    is_judge: row.is_judge === 1,
    is_admin: row.is_admin === 1,
    score: row.score,
    created_at: row.created_at,
  };
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.display_name ?? row.username,
    avatar_url: row.avatar_url,
    is_participant: row.is_participant === 1,
    is_judge: row.is_judge === 1,
    score: row.score,
    created_at: row.created_at,
  };
}

// --- User reads --------------------------------------------------------------

export async function getUserById(db: D1Database, id: string): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
}

export async function requireParticipant(db: D1Database, id: string): Promise<UserRow> {
  const row = await getUserById(db, id);
  if (!row) throw new ApiError(400, '选手不存在');
  if (row.is_participant !== 1) throw new ApiError(400, '该用户不是上榜选手');
  return row;
}

export async function getLeaderboard(db: D1Database): Promise<PublicUser[]> {
  const rows = await db
    .prepare(
      // created_at, id: a total order. Without it, ties came back in D1's
      // incidental insertion order and in no defined order at all on PostgreSQL.
      `SELECT * FROM users WHERE is_participant = 1
        ORDER BY score DESC, COALESCE(display_name, username) ASC, created_at ASC, id ASC`,
    )
    .all<UserRow>();
  return rows.results.map(toPublicUser);
}

/** True if `url` is exactly a stored user avatar — lets the avatar proxy serve
 *  any avatar the OAuth provider actually issued, without hard-coding its host. */
export async function avatarUrlExists(db: D1Database, url: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS ok FROM users WHERE avatar_url = ? LIMIT 1')
    .bind(url)
    .first<{ ok: number }>();
  return row !== null;
}

// --- Score application -------------------------------------------------------

/** A SQL condition (plus its binds) that gates every statement of a mutation. */
export interface RowGuard {
  sql: string;
  binds: readonly unknown[];
}

const ALWAYS: RowGuard = { sql: '1 = 1', binds: [] };

/** `expr` clamped into MIN_SCORE..MAX_SCORE — a plain CASE, valid in SQLite and PostgreSQL. */
function clampSql(expr: string): string {
  return `(CASE WHEN ${expr} > ${MAX_SCORE} THEN ${MAX_SCORE} WHEN ${expr} < ${MIN_SCORE} THEN ${MIN_SCORE} ELSE ${expr} END)`;
}

/**
 * Statements that move one user's score by `delta` (clamped to 0..100) and log
 * it — computed in SQL from the row as it stands when the batch runs, never
 * from a score read earlier. An earlier read was a lost update waiting to
 * happen: a verdict landing between the read and the write was overwritten.
 *
 * Order matters:
 *   1. a no-op UPDATE takes the row lock on PostgreSQL, so a concurrent change
 *      to the same user waits for this batch instead of overwriting it (D1
 *      batches are serialised anyway, where it is a harmless no-op);
 *   2. the event is computed from the score as it is now;
 *   3. the score moves relatively.
 * `guard` gates every statement: if, say, the case is no longer in the
 * expected state, nothing at all happens. To store what actually landed on a
 * record, use appliedDeltaSql() in a statement placed after these.
 */
export function scoreMutation(
  db: D1Database,
  userId: string,
  delta: number,
  reason: string,
  guard: RowGuard = ALWAYS,
): D1PreparedStatement[] {
  const moved = clampSql('score + ?');
  return [
    db
      .prepare(`UPDATE users SET score = score WHERE id = ? AND ${guard.sql}`)
      .bind(userId, ...guard.binds),
    db
      .prepare(
        `INSERT INTO score_events (user_id, delta, reason, resulting_score)
         SELECT id, ${moved} - score, ?, ${moved}
           FROM users WHERE id = ? AND ${guard.sql}`,
      )
      .bind(delta, delta, delta, reason, delta, delta, delta, userId, ...guard.binds),
    db
      .prepare(
        `UPDATE users SET score = ${moved}, updated_at = datetime('now')
          WHERE id = ? AND ${guard.sql}`,
      )
      .bind(delta, delta, delta, userId, ...guard.binds),
  ];
}

/**
 * SQL for the delta the latest `reason` event of this user actually applied —
 * i.e. what scoreMutation() just landed, after clamping. Use it to keep a
 * record's delta in step with the score in the same batch.
 */
export function appliedDeltaSql(userId: string, reason: string): RowGuard {
  return {
    sql: `COALESCE((SELECT e.delta FROM score_events e
                     WHERE e.user_id = ? AND e.reason = ?
                     ORDER BY e.id DESC LIMIT 1), 0)`,
    binds: [userId, reason],
  };
}

// --- Login / roles -----------------------------------------------------------

export interface UpsertResult {
  user: User;
  isNew: boolean;
}

/** Who gets admin on login. Both lists come from env, comma-separated. */
export interface AdminGrants {
  /** ADMIN_SUBJECT_IDS — the OAuth `sub`, which the user cannot change. */
  subjectIds: readonly string[];
  /** ADMIN_USERNAMES — deprecated; consulted only while subjectIds is empty. */
  usernames: readonly string[];
}

export type AdminGrantVia = 'subject' | 'username' | null;

/**
 * Whether this login grants admin, and by which rule.
 *
 * The username rule is weak: `profile.username` falls back to the profile's
 * `name` / `nickname` (see oauth.ts), which an IdP may let users edit, so
 * anyone renaming themselves to a listed name would become admin. Setting
 * ADMIN_SUBJECT_IDS switches it off entirely.
 */
export function adminGrantVia(grants: AdminGrants, profile: OAuthProfile): AdminGrantVia {
  if (grants.subjectIds.length > 0) {
    return grants.subjectIds.includes(profile.id) ? 'subject' : null;
  }
  return grants.usernames.includes(profile.username) ? 'username' : null;
}

/**
 * Insert or update a user from an OAuth profile. Admin is granted (never
 * revoked) when `adminGrantVia` matches.
 */
export async function upsertUser(
  db: D1Database,
  profile: OAuthProfile,
  grants: AdminGrants,
): Promise<UpsertResult> {
  const grantAdmin = adminGrantVia(grants, profile) !== null;

  // Insert-or-nothing first: two first logins for the same subject at once
  // (two tabs, a double-clicked callback) both succeed — the loser simply
  // becomes a re-login instead of a UNIQUE-violation 500.
  const inserted = await db
    .prepare(
      `INSERT INTO users (id, username, avatar_url, email, is_admin)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (id) DO NOTHING`,
    )
    .bind(profile.id, profile.username, profile.avatar_url, profile.email, grantAdmin ? 1 : 0)
    .run();
  if ((inserted.meta?.changes ?? 0) > 0) {
    const created = await getUserById(db, profile.id);
    if (!created) throw new ApiError(500, '创建用户失败');
    return { user: toUser(created), isNew: true };
  }

  // Admin is only ever granted here, never revoked.
  await db
    .prepare(
      `UPDATE users SET username = ?, avatar_url = ?, email = ?,
         is_admin = CASE WHEN is_admin = 1 OR ? = 1 THEN 1 ELSE 0 END,
         updated_at = datetime('now') WHERE id = ?`,
    )
    .bind(profile.username, profile.avatar_url, profile.email, grantAdmin ? 1 : 0, profile.id)
    .run();
  const updated = await getUserById(db, profile.id);
  if (!updated) throw new ApiError(500, '更新用户失败');
  return { user: toUser(updated), isNew: false };
}

export interface RolePatch {
  is_participant?: boolean;
  is_judge?: boolean;
}

export async function updateRoles(
  db: D1Database,
  userId: string,
  patch: RolePatch,
): Promise<User> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (patch.is_participant !== undefined) {
    sets.push('is_participant = ?');
    binds.push(patch.is_participant ? 1 : 0);
  }
  if (patch.is_judge !== undefined) {
    sets.push('is_judge = ?');
    binds.push(patch.is_judge ? 1 : 0);
  }
  if (sets.length > 0) {
    sets.push("updated_at = datetime('now')");
    binds.push(userId);
    await db
      .prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...binds)
      .run();
  }
  const row = await getUserById(db, userId);
  if (!row) throw new ApiError(404, '用户不存在');
  return toUser(row);
}

function normalizeDisplayName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new ApiError(400, '显示名字不能为空');
  if (trimmed.length > 24) throw new ApiError(400, '显示名字最多 24 个字符');
  return trimmed;
}

/** Set the caller's display name; null clears it (falls back to the OAuth name). */
export async function updateDisplayName(
  db: D1Database,
  userId: string,
  displayName: string | null,
): Promise<User> {
  const value = displayName === null ? null : normalizeDisplayName(displayName);
  await db
    .prepare("UPDATE users SET display_name = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(value, userId)
    .run();
  const row = await getUserById(db, userId);
  if (!row) throw new ApiError(404, '用户不存在');
  return toUser(row);
}

// --- Profile -----------------------------------------------------------------

export interface UserProfile {
  user: PublicUser;
  records: RecordItem[];
  history: HistoryPoint[];
}

export async function getUserProfile(db: D1Database, id: string): Promise<UserProfile> {
  const row = await getUserById(db, id);
  if (!row) throw new ApiError(404, '用户不存在');
  const records = await listRecords(db, { subject: id, limit: 200 });
  const events = await db
    .prepare('SELECT * FROM score_events WHERE user_id = ? ORDER BY created_at ASC, id ASC')
    .bind(id)
    .all<ScoreEventRow>();
  const history: HistoryPoint[] = [
    { at: row.created_at, score: BASE_SCORE },
    ...events.results.map((e) => ({ at: e.created_at, score: e.resulting_score })),
  ];
  return { user: toPublicUser(row), records, history };
}

// --- Admin -------------------------------------------------------------------

export interface AdminUserPatch {
  is_participant?: boolean;
  is_judge?: boolean;
  is_admin?: boolean;
  score?: number;
  delete?: boolean;
}

export async function adminUpdateUser(
  db: D1Database,
  id: string,
  patch: AdminUserPatch,
): Promise<void> {
  const existing = await getUserById(db, id);
  if (!existing) throw new ApiError(404, '用户不存在');

  if (patch.delete) {
    await db.batch([
      db.prepare('DELETE FROM score_events WHERE user_id = ?').bind(id),
      db
        .prepare(
          `DELETE FROM ai_verdicts WHERE record_id IN
             (SELECT id FROM records WHERE subject_id = ? OR reporter_id = ?)`,
        )
        .bind(id, id),
      db.prepare('DELETE FROM records WHERE subject_id = ? OR reporter_id = ?').bind(id, id),
      db.prepare('DELETE FROM session_players WHERE user_id = ?').bind(id),
      db
        .prepare(
          'DELETE FROM session_players WHERE session_id IN (SELECT id FROM game_sessions WHERE organizer_id = ?)',
        )
        .bind(id),
      db.prepare('DELETE FROM game_sessions WHERE organizer_id = ?').bind(id),
      db.prepare('DELETE FROM users WHERE id = ?').bind(id),
    ]);
    return;
  }

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (patch.is_participant !== undefined) {
    sets.push('is_participant = ?');
    binds.push(patch.is_participant ? 1 : 0);
  }
  if (patch.is_judge !== undefined) {
    sets.push('is_judge = ?');
    binds.push(patch.is_judge ? 1 : 0);
  }
  if (patch.is_admin !== undefined) {
    sets.push('is_admin = ?');
    binds.push(patch.is_admin ? 1 : 0);
  }

  // The admin sets an absolute score; the logged delta is computed in SQL from
  // the score as it is when the batch runs (row locked first on PostgreSQL),
  // so a verdict landing meanwhile cannot make the audit trail lie.
  const statements: D1PreparedStatement[] = [];
  if (patch.score !== undefined) {
    const newScore = clampScore(patch.score);
    statements.push(
      db.prepare('UPDATE users SET score = score WHERE id = ?').bind(id),
      db
        .prepare(
          `INSERT INTO score_events (user_id, delta, reason, resulting_score)
           SELECT id, ? - score, 'admin_adjust', ? FROM users WHERE id = ?`,
        )
        .bind(newScore, newScore, id),
    );
    sets.push('score = ?');
    binds.push(newScore);
  }

  if (sets.length === 0) return;

  sets.push("updated_at = datetime('now')");
  binds.push(id);
  statements.push(db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...binds));
  await db.batch(statements);
}

// --- Weekly heal -------------------------------------------------------------

export interface WeeklyHealResult {
  week_start: string;
  affected: number;
  skipped: boolean;
}

/** Idempotent per-week: +WEEKLY_HEAL to every participant, capped at MAX_SCORE. */
export async function weeklyHeal(
  db: D1Database,
  offsetHours: number,
): Promise<WeeklyHealResult> {
  const weekStart = weekStartLocal(offsetHours);
  // Fast path: this runs on every page load (GET /api/config).
  const already = await db
    .prepare('SELECT week_start FROM weekly_heals WHERE week_start = ?')
    .bind(weekStart)
    .first<{ week_start: string }>();
  if (already) {
    return { week_start: weekStart, affected: 0, skipped: true };
  }

  // One atomic batch, set-based and relative. The ledger row is claimed first
  // with applied_at = 'pending'; every later statement only runs while that
  // claim is ours, so a second healer racing us does nothing at all. Each
  // score moves from its value as it is now — a verdict landing between the
  // check above and this batch is kept, not overwritten.
  const pending = "EXISTS (SELECT 1 FROM weekly_heals WHERE week_start = ? AND applied_at = 'pending')";
  const eligible = `is_participant = 1 AND score < ${MAX_SCORE}`;
  const healed = clampSql(`score + ${WEEKLY_HEAL}`);
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO weekly_heals (week_start, applied_at, affected) VALUES (?, 'pending', 0)
         ON CONFLICT (week_start) DO NOTHING`,
      )
      .bind(weekStart),
    // Lock every participant (PostgreSQL), so none can change mid-batch.
    db.prepare(`UPDATE users SET score = score WHERE is_participant = 1 AND ${pending}`).bind(weekStart),
    db
      .prepare(
        `UPDATE weekly_heals SET affected = (SELECT COUNT(*) FROM users WHERE ${eligible})
          WHERE week_start = ? AND applied_at = 'pending'`,
      )
      .bind(weekStart),
    db
      .prepare(
        `INSERT INTO score_events (user_id, delta, reason, resulting_score)
         SELECT id, ${healed} - score, 'weekly_heal', ${healed}
           FROM users WHERE ${eligible} AND ${pending} ORDER BY id`,
      )
      .bind(weekStart),
    db
      .prepare(`UPDATE users SET score = ${healed}, updated_at = datetime('now') WHERE ${eligible} AND ${pending}`)
      .bind(weekStart),
    db
      .prepare(`UPDATE weekly_heals SET applied_at = datetime('now') WHERE week_start = ? AND applied_at = 'pending'`)
      .bind(weekStart),
  ]);
  if ((results[0]?.meta?.changes ?? 0) === 0) {
    return { week_start: weekStart, affected: 0, skipped: true };
  }
  const row = await db
    .prepare('SELECT affected FROM weekly_heals WHERE week_start = ?')
    .bind(weekStart)
    .first<{ affected: number }>();
  return { week_start: weekStart, affected: row?.affected ?? 0, skipped: false };
}
