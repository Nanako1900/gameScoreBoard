// D1 data-access layer. PREPARED STATEMENTS ONLY — every value is bound with `?`,
// never concatenated. Column names in dynamic SET/WHERE clauses are static
// literals. All boolean outputs convert D1's 0/1 integers to real booleans.

import {
  BASE_SCORE,
  MAX_SCORE,
  VIOLATION_MAP,
  WEEKLY_BONUS_CAP,
  WEEKLY_HEAL,
  clampScore,
  isValidViolationType,
  type ViolationType,
} from '../shared/scoring';
import type {
  HistoryPoint,
  PublicUser,
  RecordItem,
  RecordJoinRow,
  RecordRow,
  ScoreEventRow,
  User,
  UserRow,
} from './types';
import { weekStartLocal, weekStartUtcSql } from './time';
import type { OAuthProfile } from './oauth';

/** Error carrying an HTTP status; mapped to `{ error }` responses by routes. */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

// --- Mappers -----------------------------------------------------------------

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
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
    username: row.username,
    avatar_url: row.avatar_url,
    is_participant: row.is_participant === 1,
    is_judge: row.is_judge === 1,
    score: row.score,
    created_at: row.created_at,
  };
}

function toRecordItem(row: RecordJoinRow): RecordItem {
  return {
    id: row.id,
    subject: { id: row.s_id, username: row.s_username, avatar_url: row.s_avatar },
    reporter: { id: row.p_id, username: row.p_username, avatar_url: row.p_avatar },
    type: row.type as ViolationType,
    delta: row.delta,
    note: row.note,
    status: row.status as RecordItem['status'],
    created_at: row.created_at,
  };
}

const RECORD_SELECT = `
SELECT r.id AS id, r.type AS type, r.delta AS delta, r.note AS note,
       r.status AS status, r.created_at AS created_at,
       s.id AS s_id, s.username AS s_username, s.avatar_url AS s_avatar,
       p.id AS p_id, p.username AS p_username, p.avatar_url AS p_avatar
FROM records r
JOIN users s ON s.id = r.subject_id
JOIN users p ON p.id = r.reporter_id`;

function parseSqliteUtc(value: string): number {
  // sqlite datetime('now') is 'YYYY-MM-DD HH:MM:SS' in UTC.
  return new Date(value.replace(' ', 'T') + 'Z').getTime();
}

function normalizeNote(note: string | undefined): string | null {
  if (note === undefined) return null;
  const trimmed = note.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, 500);
}

// --- User reads --------------------------------------------------------------

export async function getUserById(db: D1Database, id: string): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
}

export async function getLeaderboard(db: D1Database): Promise<PublicUser[]> {
  const rows = await db
    .prepare('SELECT * FROM users WHERE is_participant = 1 ORDER BY score DESC, username ASC')
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

// --- Login / roles -----------------------------------------------------------

export interface UpsertResult {
  user: User;
  isNew: boolean;
}

/**
 * Insert or update a user from an OAuth profile. Admin is granted (never
 * revoked) when the username appears in the ADMIN_USERNAMES list.
 */
export async function upsertUser(
  db: D1Database,
  profile: OAuthProfile,
  adminUsernames: readonly string[],
): Promise<UpsertResult> {
  const existing = await getUserById(db, profile.id);
  const grantAdmin = adminUsernames.includes(profile.username);

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

// --- Records reads -----------------------------------------------------------

export interface ListRecordsFilters {
  limit?: number;
  subject?: string;
  status?: string;
}

export async function listRecords(
  db: D1Database,
  filters: ListRecordsFilters,
): Promise<RecordItem[]> {
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (filters.subject) {
    clauses.push('r.subject_id = ?');
    binds.push(filters.subject);
  }
  if (filters.status) {
    clauses.push('r.status = ?');
    binds.push(filters.status);
  }
  const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(200, filters.limit ?? 50));
  binds.push(limit);
  const sql = `${RECORD_SELECT}${where} ORDER BY r.created_at DESC, r.id DESC LIMIT ?`;
  const rows = await db
    .prepare(sql)
    .bind(...binds)
    .all<RecordJoinRow>();
  return rows.results.map(toRecordItem);
}

export async function getRecordItemById(
  db: D1Database,
  id: number,
): Promise<RecordItem | null> {
  const row = await db
    .prepare(`${RECORD_SELECT} WHERE r.id = ?`)
    .bind(id)
    .first<RecordJoinRow>();
  return row ? toRecordItem(row) : null;
}

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

// --- Records writes ----------------------------------------------------------

export interface CreateRecordInput {
  subject_id: string;
  type: string;
  note?: string;
}

/** Create a record, apply the clamped delta, and log a score event. */
export async function createRecord(
  db: D1Database,
  reporter: User,
  input: CreateRecordInput,
  offsetHours: number,
): Promise<RecordItem> {
  if (!isValidViolationType(input.type)) {
    throw new ApiError(400, '无效的记录类型');
  }
  if (input.subject_id === reporter.id) {
    throw new ApiError(400, '不能记录自己');
  }
  const subject = await getUserById(db, input.subject_id);
  if (!subject) {
    throw new ApiError(400, '选手不存在');
  }
  if (subject.is_participant !== 1) {
    throw new ApiError(400, '该用户不是上榜选手');
  }

  const def = VIOLATION_MAP[input.type];
  const delta = def.delta;

  if (delta > 0) {
    const since = weekStartUtcSql(offsetHours);
    const agg = await db
      .prepare(
        `SELECT COALESCE(SUM(delta), 0) AS total FROM records
         WHERE subject_id = ? AND delta > 0 AND status != 'revoked' AND created_at >= ?`,
      )
      .bind(subject.id, since)
      .first<{ total: number }>();
    const current = agg?.total ?? 0;
    if (current + delta > WEEKLY_BONUS_CAP) {
      throw new ApiError(400, `本周奖励分已达上限 (${WEEKLY_BONUS_CAP})`);
    }
  }

  const oldScore = subject.score;
  const newScore = clampScore(oldScore + delta);
  const applied = newScore - oldScore;
  const note = normalizeNote(input.note);

  // Atomic: insert the record, apply the clamped score, and log the score event
  // in a single D1 batch (one transaction) so a partial failure cannot leave the
  // score and audit trail inconsistent. Inside the batch, last_insert_rowid()
  // resolves to the just-inserted record id — the UPDATE between them is not an
  // INSERT, so it does not change it. The record id is read back from the first
  // statement's meta for the response.
  const batchRes = await db.batch([
    db
      .prepare(
        `INSERT INTO records (subject_id, reporter_id, type, delta, note, status)
         VALUES (?, ?, ?, ?, ?, 'active')`,
      )
      .bind(subject.id, reporter.id, input.type, applied, note),
    db
      .prepare("UPDATE users SET score = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(newScore, subject.id),
    db
      .prepare(
        `INSERT INTO score_events (user_id, delta, reason, resulting_score)
         VALUES (?, ?, 'record:' || last_insert_rowid(), ?)`,
      )
      .bind(subject.id, applied, newScore),
  ]);
  const recordId = Number(batchRes[0]?.meta?.last_row_id);
  if (!recordId) throw new ApiError(500, '创建记录失败');

  const item = await getRecordItemById(db, recordId);
  if (!item) throw new ApiError(500, '创建记录失败');
  return item;
}

/** Subject-only dispute; sets status='disputed' with no score change. */
export async function disputeRecord(
  db: D1Database,
  caller: User,
  id: number,
): Promise<RecordItem> {
  const rec = await db.prepare('SELECT * FROM records WHERE id = ?').bind(id).first<RecordRow>();
  if (!rec) throw new ApiError(404, '记录不存在');
  if (rec.subject_id !== caller.id) throw new ApiError(403, '只能对针对自己的记录提出异议');
  if (rec.status === 'revoked') throw new ApiError(400, '记录已撤销');
  await db.prepare("UPDATE records SET status = 'disputed' WHERE id = ?").bind(id).run();
  const item = await getRecordItemById(db, id);
  if (!item) throw new ApiError(500, '更新记录失败');
  return item;
}

const REVOKE_WINDOW_MS = 15 * 60 * 1000;

/** Reporter (within 15 min) or admin revoke; reverses the applied delta. */
export async function revokeRecord(
  db: D1Database,
  caller: User,
  id: number,
): Promise<RecordItem> {
  const rec = await db.prepare('SELECT * FROM records WHERE id = ?').bind(id).first<RecordRow>();
  if (!rec) throw new ApiError(404, '记录不存在');
  if (rec.status === 'revoked') throw new ApiError(400, '记录已撤销');

  const isReporter = rec.reporter_id === caller.id;
  const withinWindow = Date.now() - parseSqliteUtc(rec.created_at) <= REVOKE_WINDOW_MS;
  if (!(caller.is_admin || (isReporter && withinWindow))) {
    throw new ApiError(403, '无权撤销此记录');
  }

  const subject = await getUserById(db, rec.subject_id);
  if (!subject) throw new ApiError(404, '选手不存在');
  const oldScore = subject.score;
  const newScore = clampScore(oldScore - rec.delta);
  const applied = newScore - oldScore;

  await db.batch([
    db.prepare("UPDATE records SET status = 'revoked' WHERE id = ?").bind(id),
    db
      .prepare("UPDATE users SET score = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(newScore, subject.id),
    db
      .prepare(
        `INSERT INTO score_events (user_id, delta, reason, resulting_score)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(subject.id, applied, `revoke:${id}`, newScore),
  ]);

  const item = await getRecordItemById(db, id);
  if (!item) throw new ApiError(500, '更新记录失败');
  return item;
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
      db.prepare('DELETE FROM records WHERE subject_id = ? OR reporter_id = ?').bind(id, id),
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

// --- Weekly heal (cron) ------------------------------------------------------

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
