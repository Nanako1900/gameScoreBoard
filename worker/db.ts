// D1 data-access layer: users, roles, profiles, score application, weekly heal.
// Case (records) logic lives in worker/cases.ts; sessions in worker/sessions.ts.
//
// PREPARED STATEMENTS ONLY — every value is bound with `?`, never concatenated.
// Column names in dynamic SET/WHERE clauses are static literals. All boolean
// outputs convert D1's 0/1 integers to real booleans.

import {
  BASE_SCORE,
  MAX_SCORE,
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
      'SELECT * FROM users WHERE is_participant = 1 ORDER BY score DESC, COALESCE(display_name, username) ASC',
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

export interface ScoreMutation {
  statements: D1PreparedStatement[];
  /** Delta that actually landed after clamping to 0..100. */
  applied: number;
  newScore: number;
}

/**
 * Build the statements that move a user's score and log the audit event.
 *
 * Read-modify-write on `oldScore`, matching the pattern used since v1: the read
 * happens outside the batch, so two verdicts landing on the same player in the
 * same millisecond could interleave. Acceptable for a friends-sized board, and
 * the audit trail stays self-consistent because `resulting_score` records what
 * this write actually stored.
 */
export function scoreMutation(
  db: D1Database,
  userId: string,
  oldScore: number,
  delta: number,
  reason: string,
): ScoreMutation {
  const newScore = clampScore(oldScore + delta);
  const applied = newScore - oldScore;
  return {
    applied,
    newScore,
    statements: [
      db
        .prepare("UPDATE users SET score = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(newScore, userId),
      db
        .prepare(
          `INSERT INTO score_events (user_id, delta, reason, resulting_score)
           VALUES (?, ?, ?, ?)`,
        )
        .bind(userId, applied, reason, newScore),
    ],
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
  const existing = await getUserById(db, profile.id);
  const grantAdmin = adminGrantVia(grants, profile) !== null;

  if (!existing) {
    await db
      .prepare(
        `INSERT INTO users (id, username, avatar_url, email, is_admin)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(profile.id, profile.username, profile.avatar_url, profile.email, grantAdmin ? 1 : 0)
      .run();
    const created = await getUserById(db, profile.id);
    if (!created) throw new ApiError(500, '创建用户失败');
    return { user: toUser(created), isNew: true };
  }

  const isAdmin = existing.is_admin === 1 || grantAdmin ? 1 : 0;
  await db
    .prepare(
      `UPDATE users SET username = ?, avatar_url = ?, email = ?, is_admin = ?,
         updated_at = datetime('now') WHERE id = ?`,
    )
    .bind(profile.username, profile.avatar_url, profile.email, isAdmin, profile.id)
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

  let scoreEvent: D1PreparedStatement | null = null;
  if (patch.score !== undefined) {
    const newScore = clampScore(patch.score);
    const applied = newScore - existing.score;
    sets.push('score = ?');
    binds.push(newScore);
    scoreEvent = db
      .prepare(
        `INSERT INTO score_events (user_id, delta, reason, resulting_score)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(id, applied, 'admin_adjust', newScore);
  }

  if (sets.length === 0) return;

  sets.push("updated_at = datetime('now')");
  binds.push(id);
  const statements: D1PreparedStatement[] = [
    db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...binds),
  ];
  if (scoreEvent) statements.push(scoreEvent);
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
  const already = await db
    .prepare('SELECT week_start FROM weekly_heals WHERE week_start = ?')
    .bind(weekStart)
    .first<{ week_start: string }>();
  if (already) {
    return { week_start: weekStart, affected: 0, skipped: true };
  }

  const participants = await db
    .prepare('SELECT id, score FROM users WHERE is_participant = 1')
    .all<{ id: string; score: number }>();

  const statements: D1PreparedStatement[] = [];
  let affected = 0;
  for (const p of participants.results) {
    const newScore = Math.min(MAX_SCORE, p.score + WEEKLY_HEAL);
    if (newScore === p.score) continue;
    const delta = newScore - p.score;
    statements.push(
      db
        .prepare("UPDATE users SET score = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(newScore, p.id),
    );
    statements.push(
      db
        .prepare(
          `INSERT INTO score_events (user_id, delta, reason, resulting_score)
           VALUES (?, ?, ?, ?)`,
        )
        .bind(p.id, delta, 'weekly_heal', newScore),
    );
    affected += 1;
  }
  statements.push(
    db
      .prepare('INSERT INTO weekly_heals (week_start, affected) VALUES (?, ?)')
      .bind(weekStart, affected),
  );

  await db.batch(statements);
  return { week_start: weekStart, affected, skipped: false };
}
