// 预约约局: create → RSVP → roll call → settle.
//
// The module is usable end-to-end WITHOUT ever touching scores: roll call only
// records who showed up. Filing cases is a separate, explicitly opted-into step
// (`settle` with a non-empty `file` list), which is what makes the scoring
// integration "选配、不是必须".

import {
  MAX_INVITES,
  MAX_SESSION_ROSTER,
  ORGANIZER_BONUS_MIN_ATTENDEES,
  SESSION_CANCEL_REASON_MAX,
  SESSION_GAME_MAX,
  SESSION_MAX_LEAD_MS,
  SESSION_NOTE_MAX,
  SESSION_TITLE_MAX,
  draftClaim,
  isAllowedTypeOverride,
  isAttendance,
  isSelfRsvp,
  occupiesSlot,
  violationForAttendance,
  type Attendance,
  type Rsvp,
  type SessionStatus,
} from '../shared/attendance';
import {
  MAX_NARRATIVE_LEN,
  MIN_CLAIM_LEN,
  VIOLATION_MAP,
  type ViolationType,
} from '../shared/scoring';
import type {
  CaseDraft,
  Env,
  RecordItem,
  SessionDetail,
  SessionItem,
  SessionPlayer,
  SessionPlayerJoinRow,
  SessionRow,
  User,
} from './types';
import { ApiError } from './errors';
import { appliedDeltaSql, getUserById, scoreMutation } from './db';
import { fileCase } from './cases';
import { BonusCapReached, bonusCapGuard, fitsWeeklyBonusCap } from './case-limits';
import { parseSqlUtc, sqlNowMinusMinutes } from './time';
import { synthesizeTitle } from '../shared/quickTime';
import { goingPreviews, previewOfPlayers } from './session-extras';

const MAX_ROLLCALL_ENTRIES = MAX_SESSION_ROSTER;
const MAX_LATE_MINUTES = 24 * 60;

// --- Mapping -----------------------------------------------------------------

const SESSION_SELECT = `
SELECT g.*,
       COALESCE(o.display_name, o.username) AS o_username,
       o.avatar_url AS o_avatar,
       (SELECT COUNT(*) FROM session_players sp WHERE sp.session_id = g.id AND sp.rsvp = 'invited') AS c_invited,
       (SELECT COUNT(*) FROM session_players sp WHERE sp.session_id = g.id AND sp.rsvp = 'going')  AS c_going,
       (SELECT COUNT(*) FROM session_players sp WHERE sp.session_id = g.id AND sp.rsvp = 'maybe')  AS c_maybe,
       (SELECT COUNT(*) FROM session_players sp WHERE sp.session_id = g.id AND sp.rsvp = 'out')    AS c_out
FROM game_sessions g
JOIN users o ON o.id = g.organizer_id`;

export interface SessionJoinRow extends SessionRow {
  o_username: string;
  o_avatar: string | null;
  c_invited: number;
  c_going: number;
  c_maybe: number;
  c_out: number;
}

function toSessionItem(
  row: SessionJoinRow,
  myRsvp: Rsvp | null,
  preview: SessionItem['going_preview'],
): SessionItem {
  return {
    id: row.id,
    organizer: { id: row.organizer_id, username: row.o_username, avatar_url: row.o_avatar },
    title: row.title,
    game: row.game,
    starts_at: row.starts_at,
    duration_min: row.duration_min,
    capacity: row.capacity,
    note: row.note,
    status: row.status as SessionStatus,
    settled_at: row.settled_at,
    // `?? null`: a database not yet migrated (004 / 0007) has no such columns.
    cancel_reason: row.cancel_reason ?? null,
    cancelled_at: row.cancelled_at ?? null,
    created_at: row.created_at,
    counts: {
      invited: row.c_invited,
      going: row.c_going,
      maybe: row.c_maybe,
      out: row.c_out,
    },
    my_rsvp: myRsvp,
    going_preview: preview,
  };
}

function toSessionPlayer(row: SessionPlayerJoinRow): SessionPlayer {
  return {
    user: { id: row.user_id, username: row.u_username, avatar_url: row.u_avatar },
    rsvp: row.rsvp as Rsvp,
    rsvp_at: row.rsvp_at,
    attendance: row.attendance as Attendance | null,
    late_minutes: row.late_minutes,
    attendance_note: row.attendance_note,
    record_id: row.record_id,
    is_participant: row.u_is_participant === 1,
  };
}

const PLAYER_SELECT = `
SELECT sp.*,
       COALESCE(u.display_name, u.username) AS u_username,
       u.avatar_url AS u_avatar, u.score AS u_score,
       u.is_participant AS u_is_participant
FROM session_players sp
JOIN users u ON u.id = sp.user_id
WHERE sp.session_id = ?
ORDER BY sp.rsvp ASC, sp.rsvp_at ASC, sp.user_id ASC`;

// --- Reads -------------------------------------------------------------------

async function myRsvpMap(
  db: D1Database,
  callerId: string | null,
  sessionIds: number[],
): Promise<Map<number, Rsvp>> {
  if (!callerId || sessionIds.length === 0) return new Map();
  // Static placeholder list built from the row count only — values stay bound.
  const holes = sessionIds.map(() => '?').join(', ');
  const rows = await db
    .prepare(
      `SELECT session_id, rsvp FROM session_players
        WHERE user_id = ? AND session_id IN (${holes})`,
    )
    .bind(callerId, ...sessionIds)
    .all<{ session_id: number; rsvp: string }>();
  return new Map(rows.results.map((r) => [r.session_id, r.rsvp as Rsvp]));
}

export type SessionScope = 'upcoming' | 'past' | 'mine';

export async function listSessions(
  db: D1Database,
  scope: SessionScope,
  callerId: string | null,
  limit = 50,
): Promise<SessionItem[]> {
  // MUST be ISO, not the sqlite datetime format used elsewhere: `starts_at` is
  // stored as ISO, and SQL compares these as plain strings. Mixing formats
  // silently breaks the split — 'T' (0x54) sorts above ' ' (0x20), so every
  // same-day past session would read as upcoming.
  const now = new Date().toISOString();
  let where: string;
  const binds: unknown[] = [];
  if (scope === 'past') {
    where = "WHERE g.starts_at < ? AND g.status != 'cancelled'";
    binds.push(now);
  } else if (scope === 'mine') {
    if (!callerId) return [];
    where = `WHERE g.organizer_id = ?
               OR g.id IN (SELECT session_id FROM session_players WHERE user_id = ?)`;
    binds.push(callerId, callerId);
  } else {
    where = "WHERE g.starts_at >= ? AND g.status = 'open'";
    binds.push(now);
  }
  const order = scope === 'upcoming' ? 'ASC' : 'DESC';
  binds.push(Math.max(1, Math.min(100, limit)));
  const rows = await db
    .prepare(`${SESSION_SELECT} ${where} ORDER BY g.starts_at ${order}, g.id DESC LIMIT ?`)
    .bind(...binds)
    .all<SessionJoinRow>();
  const ids = rows.results.map((r) => r.id);
  const mine = await myRsvpMap(db, callerId, ids);
  const previews = await goingPreviews(db, ids);
  return rows.results.map((r) =>
    toSessionItem(r, mine.get(r.id) ?? null, previews.get(r.id) ?? []),
  );
}

export async function getSessionRow(db: D1Database, id: number): Promise<SessionJoinRow> {
  const row = await db
    .prepare(`${SESSION_SELECT} WHERE g.id = ?`)
    .bind(id)
    .first<SessionJoinRow>();
  if (!row) throw new ApiError(404, '约局不存在');
  return row;
}

export async function getSessionDetail(
  db: D1Database,
  id: number,
  callerId: string | null,
): Promise<SessionDetail> {
  const row = await getSessionRow(db, id);
  const players = await db.prepare(PLAYER_SELECT).bind(id).all<SessionPlayerJoinRow>();
  const mapped = players.results.map(toSessionPlayer);
  const mine = callerId ? mapped.find((p) => p.user.id === callerId)?.rsvp ?? null : null;
  return { ...toSessionItem(row, mine, previewOfPlayers(mapped)), players: mapped };
}

// --- Writes ------------------------------------------------------------------

export function requireOrganizer(row: SessionRow, caller: User): void {
  if (caller.is_admin) return;
  if (row.organizer_id !== caller.id) throw new ApiError(403, '只有组织者可以操作这个约局');
}

function normalizeTitle(raw: unknown): string {
  if (typeof raw !== 'string') throw new ApiError(400, '缺少标题');
  const t = raw.trim();
  if (t.length === 0) throw new ApiError(400, '标题不能为空');
  return t.slice(0, SESSION_TITLE_MAX);
}

function normalizeOptionalText(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  return t.length === 0 ? null : t.slice(0, max);
}

/** A little slack for clocks and a form left open: "now" is still fine. */
const STARTS_AT_GRACE_MS = 5 * 60_000;

function normalizeStartsAt(raw: unknown): string {
  if (typeof raw !== 'string') throw new ApiError(400, '缺少开始时间');
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) throw new ApiError(400, '开始时间格式无效');
  if (ms > Date.now() + SESSION_MAX_LEAD_MS) throw new ApiError(400, '开始时间太远了（最多 90 天）');
  // A session that "already started" could be roll-called at once, before
  // anyone had a chance to answer — or to change their answer.
  if (ms < Date.now() - STARTS_AT_GRACE_MS) throw new ApiError(400, '开始时间已经过了');
  return new Date(ms).toISOString();
}

function normalizeInt(raw: unknown, min: number, max: number, label: string): number | null {
  if (raw === undefined || raw === null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new ApiError(400, `${label}必须是数字`);
  const i = Math.round(n);
  if (i < min || i > max) throw new ApiError(400, `${label}需在 ${min}–${max} 之间`);
  return i;
}

export interface CreateSessionInput {
  /** Optional in v3 — omitted means the server synthesises it from the time. */
  title?: unknown;
  game?: unknown;
  starts_at: unknown;
  duration_min?: unknown;
  capacity?: unknown;
  note?: unknown;
  /** v3: people to invite. They land in `invited` and get a one-tap prompt. */
  invite?: unknown;
}

export { MAX_INVITES } from '../shared/attendance';
/**
 * Per organizer: sessions open at once, and sessions created per 24 hours.
 * Every session invites, posts a card and DMs reminders (Discord, P7), so
 * creating them must not be free.
 */
export const MAX_OPEN_SESSIONS = 5;
export const MAX_SESSIONS_PER_DAY = 10;

async function assertCanOrganize(db: D1Database, organizerId: string): Promise<void> {
  const open = await db
    .prepare("SELECT COUNT(*) AS n FROM game_sessions WHERE organizer_id = ? AND status = 'open' AND starts_at > ?")
    .bind(organizerId, new Date().toISOString())
    .first<{ n: number }>();
  if ((open?.n ?? 0) >= MAX_OPEN_SESSIONS) {
    throw new ApiError(429, `同时最多有 ${MAX_OPEN_SESSIONS} 个还没开的局，先取消一个或等它开完`);
  }
  const recent = await db
    .prepare('SELECT COUNT(*) AS n FROM game_sessions WHERE organizer_id = ? AND created_at >= ?')
    .bind(organizerId, sqlNowMinusMinutes(24 * 60))
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= MAX_SESSIONS_PER_DAY) {
    throw new ApiError(429, `24 小时内最多发起 ${MAX_SESSIONS_PER_DAY} 个约局，明天再约`);
  }
}

/** `field` names the list in the errors: `invite` when creating, `user_ids` for POST …/invite (P2-1). */
export function normalizeInvites(
  raw: unknown,
  organizerId: string,
  field: 'invite' | 'user_ids' = 'invite',
): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new ApiError(400, `${field} 必须是数组`);
  const ids = new Set<string>();
  for (const v of raw) {
    if (typeof v !== 'string' || v.length === 0) throw new ApiError(400, `${field} 里有无效的用户 ID`);
    if (v === organizerId) continue; // the organizer is already going
    ids.add(v);
  }
  if (ids.size > MAX_INVITES) throw new ApiError(400, `一次最多邀请 ${MAX_INVITES} 人`);
  return [...ids];
}

/**
 * Create a session.
 *
 * v3 reduces the required input to time + people. `title` is synthesised
 * server-side from `starts_at` rather than typed, which also means a tampered
 * client cannot inject arbitrary title text and every session reads consistently.
 * game / duration / capacity / note remain accepted (and PATCHable) but are no
 * longer part of the default path.
 */
export async function createSession(
  db: D1Database,
  organizer: User,
  input: CreateSessionInput,
  offsetHours: number,
): Promise<SessionDetail> {
  const startsAt = normalizeStartsAt(input.starts_at);
  const title =
    input.title === undefined || input.title === null || input.title === ''
      ? synthesizeTitle(startsAt, offsetHours)
      : normalizeTitle(input.title);
  const game = normalizeOptionalText(input.game, SESSION_GAME_MAX);
  const note = normalizeOptionalText(input.note, SESSION_NOTE_MAX);
  const duration = normalizeInt(input.duration_min, 15, 1440, '时长');
  const capacity = normalizeInt(input.capacity, 2, 50, '人数上限');
  const invites = normalizeInvites(input.invite, organizer.id);
  // The friendly check, with the right message…
  await assertCanOrganize(db, organizer.id);
  // …and the one that holds: the caps again inside the write, after taking the
  // organizer's row lock (PostgreSQL; D1 serialises batches anyway), so a
  // burst of parallel creates cannot all slip under them.
  const [, res] = await db.batch([
    db.prepare('UPDATE users SET score = score WHERE id = ?').bind(organizer.id),
    db
      .prepare(
        `INSERT INTO game_sessions (organizer_id, title, game, starts_at, duration_min, capacity, note)
         SELECT ?, ?, ?, ?, CAST(? AS INTEGER), CAST(? AS INTEGER), ?
          WHERE (SELECT COUNT(*) FROM game_sessions
                  WHERE organizer_id = ? AND status = 'open' AND starts_at > ?) < ?
            AND (SELECT COUNT(*) FROM game_sessions WHERE organizer_id = ? AND created_at >= ?) < ?`,
      )
      .bind(
        organizer.id,
        title,
        game,
        startsAt,
        duration,
        capacity,
        note,
        organizer.id,
        new Date().toISOString(),
        MAX_OPEN_SESSIONS,
        organizer.id,
        sqlNowMinusMinutes(24 * 60),
        MAX_SESSIONS_PER_DAY,
      ),
  ]);
  if ((res?.meta?.changes ?? 0) === 0) {
    throw new ApiError(429, `同时最多有 ${MAX_OPEN_SESSIONS} 个还没开的局、24 小时内最多发起 ${MAX_SESSIONS_PER_DAY} 个`);
  }
  const id = Number(res.meta?.last_row_id);
  if (!id) throw new ApiError(500, '创建约局失败');

  const statements: D1PreparedStatement[] = [
    // The organizer is in by default — they proposed it.
    db
      .prepare("INSERT INTO session_players (session_id, user_id, rsvp) VALUES (?, ?, 'going')")
      .bind(id, organizer.id),
  ];
  for (const userId of invites) {
    // ON CONFLICT DO NOTHING + a subquery guard: an unknown user id must not
    // create a dangling row, and must not fail the whole creation either.
    // (Portable: SQLite and PostgreSQL both accept this form; SQLite needs the
    // SELECT's WHERE to tell the upsert's ON apart from a join constraint.)
    statements.push(
      db
        .prepare(
          `INSERT INTO session_players (session_id, user_id, rsvp)
           SELECT ?, id, 'invited' FROM users WHERE id = ?
           ON CONFLICT (session_id, user_id) DO NOTHING`,
        )
        .bind(id, userId),
    );
  }
  await db.batch(statements);
  return getSessionDetail(db, id, organizer.id);
}

export interface InviteItem {
  session: SessionItem;
}

/**
 * Sessions where the caller has been invited but has not answered. Drives the
 * one-tap invite banner — the single most important surface for getting people to
 * open the app at all.
 */
export async function listMyInvites(
  db: D1Database,
  callerId: string,
): Promise<SessionItem[]> {
  const now = new Date().toISOString();
  const rows = await db
    .prepare(
      `${SESSION_SELECT}
        WHERE g.status = 'open' AND g.starts_at >= ?
          AND EXISTS (SELECT 1 FROM session_players sp
                       WHERE sp.session_id = g.id AND sp.user_id = ? AND sp.rsvp = 'invited')
        ORDER BY g.starts_at ASC LIMIT 20`,
    )
    .bind(now, callerId)
    .all<SessionJoinRow>();
  const previews = await goingPreviews(db, rows.results.map((r) => r.id));
  return rows.results.map((r) => toSessionItem(r, 'invited', previews.get(r.id) ?? []));
}

export async function updateSession(
  db: D1Database,
  caller: User,
  id: number,
  input: Partial<CreateSessionInput>,
): Promise<SessionDetail> {
  const row = await getSessionRow(db, id);
  requireOrganizer(row, caller);
  if (row.status !== 'open') throw new ApiError(400, '已取消 / 已结算的约局不能再修改');
  // Once it has started, attendance is what happened: moving it now would let
  // players re-answer around a roll call (or the claims quote a new title).
  if (parseSqlUtc(row.starts_at) <= Date.now()) throw new ApiError(400, '约局已开始，不能再修改');

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (input.title !== undefined) {
    sets.push('title = ?');
    binds.push(normalizeTitle(input.title));
  }
  let moved = false;
  if (input.starts_at !== undefined) {
    const startsAt = normalizeStartsAt(input.starts_at);
    // The same moment written another way (or stored the old way) is no move.
    moved = Date.parse(startsAt) !== parseSqlUtc(row.starts_at);
    sets.push('starts_at = ?');
    binds.push(startsAt);
  }
  if (input.game !== undefined) {
    sets.push('game = ?');
    binds.push(normalizeOptionalText(input.game, SESSION_GAME_MAX));
  }
  if (input.note !== undefined) {
    sets.push('note = ?');
    binds.push(normalizeOptionalText(input.note, SESSION_NOTE_MAX));
  }
  if (input.duration_min !== undefined) {
    sets.push('duration_min = ?');
    binds.push(normalizeInt(input.duration_min, 15, 1440, '时长'));
  }
  if (input.capacity !== undefined) {
    sets.push('capacity = ?');
    binds.push(normalizeInt(input.capacity, 2, 50, '人数上限'));
  }
  if (sets.length > 0) {
    binds.push(id);
    const statements = [db.prepare(`UPDATE game_sessions SET ${sets.join(', ')} WHERE id = ?`).bind(...binds)];
    if (moved) {
      // An answer to one time is not an answer to another: everyone but the
      // organizer answers again — a yes (so nobody can be roll-called for a
      // time they did not agree to: a no-show penalty needs a 'going'), and a
      // no too (a no to 20:00 is not a no to 23:00).
      statements.push(
        db
          .prepare(
            `UPDATE session_players SET rsvp = 'invited', rsvp_at = datetime('now')
              WHERE session_id = ? AND user_id <> ? AND rsvp IN ('going', 'maybe', 'out')`,
          )
          .bind(id, row.organizer_id),
      );
    }
    await db.batch(statements);
  }
  return getSessionDetail(db, id, caller.id);
}

export async function cancelSession(
  db: D1Database,
  caller: User,
  id: number,
  rawReason?: unknown,
): Promise<SessionDetail> {
  const row = await getSessionRow(db, id);
  requireOrganizer(row, caller);
  if (row.status === 'settled') throw new ApiError(400, '已结算的约局不能取消');
  // Cancelling twice is not a conflict: it is already what was asked for.
  if (row.status === 'cancelled') return getSessionDetail(db, id, caller.id);
  const reason = normalizeOptionalText(rawReason, SESSION_CANCEL_REASON_MAX);
  const res = await db
    .prepare(
      `UPDATE game_sessions SET status = 'cancelled', cancel_reason = ?, cancelled_at = datetime('now')
        WHERE id = ? AND status = 'open'`,
    )
    .bind(reason, id)
    .run();
  if ((res.meta?.changes ?? 0) === 0) throw new ApiError(409, '约局状态已变化，请刷新后重试');
  return getSessionDetail(db, id, caller.id);
}

const MOVED_MESSAGE = '约局时间已经改了，请按新的时间重新确认';

/**
 * Answer a session. `seenStartsAt` is the start time the player was shown
 * (the web and the bot's buttons send it): the answer is to that time, so if
 * the session has moved since, nothing is written and the answer is a 409 —
 * a stale page or an old invitation DM cannot sign someone up for a time they
 * never saw, nor turn down one they were never asked about.
 */
export async function setRsvp(
  db: D1Database,
  caller: User,
  id: number,
  rawRsvp: unknown,
  seenStartsAt?: unknown,
): Promise<SessionDetail> {
  // `invited` is organizer-assigned; a player may only answer going/maybe/out.
  if (typeof rawRsvp !== 'string' || !isSelfRsvp(rawRsvp)) {
    throw new ApiError(400, '无效的报名状态');
  }
  const row = await getSessionRow(db, id);
  if (row.status !== 'open') throw new ApiError(400, '这个约局已经不接受报名了');
  if (parseSqlUtc(row.starts_at) <= Date.now()) {
    throw new ApiError(400, '约局已开始，不能再改报名');
  }
  if (row.organizer_id === caller.id && rawRsvp !== 'going') {
    throw new ApiError(400, '组织者不能退出自己的局，请直接取消约局');
  }
  const seenGiven = seenStartsAt !== undefined && seenStartsAt !== null;
  if (seenGiven) {
    const seen = typeof seenStartsAt === 'string' ? parseSqlUtc(seenStartsAt) : Number.NaN;
    if (!Number.isFinite(seen)) throw new ApiError(400, '开始时间格式无效');
    if (seen !== parseSqlUtc(row.starts_at)) throw new ApiError(409, MOVED_MESSAGE);
  }
  // A time sent is checked for every answer; without one, a yes or a maybe
  // still holds only for the time read here.
  const holdTime = seenGiven || rawRsvp !== 'out';

  if (occupiesSlot(rawRsvp) && row.capacity !== null) {
    const existing = await db
      .prepare('SELECT rsvp FROM session_players WHERE session_id = ? AND user_id = ?')
      .bind(id, caller.id)
      .first<{ rsvp: string }>();
    // Only `going` counts against capacity, so inviting 8 to a 5-seat game is
    // fine — the first five to accept get the seats.
    const alreadyIn = existing !== null && occupiesSlot(existing.rsvp as Rsvp);
    if (!alreadyIn && row.c_going >= row.capacity) {
      throw new ApiError(400, '人数已满');
    }
  }

  // The check above is the friendly fast path; this is the one that holds.
  // The seat count is re-checked inside the write itself, after a no-op
  // UPDATE has taken the session's row lock on PostgreSQL (so RSVPs to one
  // session queue up instead of racing for the last seat; D1 serialises
  // batches anyway). Two players cannot both take the last seat.
  const capped = occupiesSlot(rawRsvp) && row.capacity !== null;
  // Same rule as the fast path: someone already holding a seat may re-confirm
  // even when a lowered capacity is now below the going count.
  const seatFree = capped
    ? `(EXISTS (SELECT 1 FROM session_players WHERE session_id = ? AND user_id = ? AND rsvp = 'going')
        OR (SELECT COUNT(*) FROM session_players
             WHERE session_id = ? AND rsvp = 'going' AND user_id != ?) < ?)`
    : '1 = 1';
  const seatBinds = capped ? [id, caller.id, id, caller.id, row.capacity] : [];
  // …and still holds when written (a move in between put everyone back to 'invited').
  const sameTime = holdTime ? 'AND starts_at = ?' : '';
  const timeBinds = holdTime ? [row.starts_at] : [];
  const results = await db.batch([
    db.prepare('UPDATE game_sessions SET status = status WHERE id = ?').bind(id),
    db
      .prepare(
        `INSERT INTO session_players (session_id, user_id, rsvp, rsvp_at)
         SELECT ?, ?, ?, datetime('now')
          WHERE EXISTS (SELECT 1 FROM game_sessions WHERE id = ? AND status = 'open' ${sameTime}) AND ${seatFree}
         ON CONFLICT(session_id, user_id) DO UPDATE SET
           rsvp = excluded.rsvp, rsvp_at = excluded.rsvp_at`,
      )
      .bind(id, caller.id, rawRsvp, id, ...timeBinds, ...seatBinds),
  ]);
  if ((results[1]?.meta?.changes ?? 0) === 0) {
    // Cancelled (or closed) or moved while we were checking, or the last seat went.
    const now = await getSessionRow(db, id);
    if (now.status !== 'open') throw new ApiError(400, '这个约局已经不接受报名了');
    if (now.starts_at !== row.starts_at) throw new ApiError(409, MOVED_MESSAGE);
    throw new ApiError(400, '人数已满');
  }
  return getSessionDetail(db, id, caller.id);
}

// --- Roll call ---------------------------------------------------------------

export interface RollCallEntry {
  user_id: string;
  attendance: string;
  late_minutes?: unknown;
  note?: unknown;
}

function parseRollCallEntries(raw: unknown): RollCallEntry[] {
  if (!Array.isArray(raw)) throw new ApiError(400, '缺少点名结果');
  if (raw.length > MAX_ROLLCALL_ENTRIES) throw new ApiError(400, '点名人数过多');
  return raw.map((item) => {
    if (typeof item !== 'object' || item === null) throw new ApiError(400, '点名条目格式错误');
    const rec = item as Record<string, unknown>;
    if (typeof rec.user_id !== 'string' || rec.user_id.length === 0) {
      throw new ApiError(400, '点名条目缺少 user_id');
    }
    if (typeof rec.attendance !== 'string' || !isAttendance(rec.attendance)) {
      throw new ApiError(400, '无效的出勤状态');
    }
    return {
      user_id: rec.user_id,
      attendance: rec.attendance,
      late_minutes: rec.late_minutes,
      note: rec.note,
    };
  });
}

function localLabel(iso: string, offsetHours: number): string {
  const d = new Date(parseSqlUtc(iso) + offsetHours * 3_600_000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${pad(d.getUTCHours())}:${pad(
    d.getUTCMinutes(),
  )}`;
}

export interface RollCallResult {
  session: SessionDetail;
  drafts: CaseDraft[];
}

/**
 * Record who actually showed up. Writes ONLY to session_players — not a single
 * point moves here. The returned drafts are a proposal the organizer may edit,
 * partially accept, or throw away entirely.
 */
export async function rollCall(
  db: D1Database,
  caller: User,
  id: number,
  rawEntries: unknown,
  offsetHours: number,
): Promise<RollCallResult> {
  const row = await getSessionRow(db, id);
  requireOrganizer(row, caller);
  if (row.status === 'cancelled') throw new ApiError(400, '已取消的约局不能点名');
  if (row.status === 'settled') throw new ApiError(400, '该约局已经结算过了');
  if (parseSqlUtc(row.starts_at) > Date.now()) {
    throw new ApiError(400, '约局还没开始，现在点名太早了');
  }

  const entries = parseRollCallEntries(rawEntries);
  const known = await db
    .prepare('SELECT user_id FROM session_players WHERE session_id = ?')
    .bind(id)
    .all<{ user_id: string }>();
  const knownIds = new Set(known.results.map((r) => r.user_id));

  const statements: D1PreparedStatement[] = [];
  for (const e of entries) {
    if (!knownIds.has(e.user_id)) {
      throw new ApiError(400, '只能给报名过这个约局的人点名');
    }
    const lateMinutes =
      e.attendance === 'late' ? normalizeInt(e.late_minutes, 0, MAX_LATE_MINUTES, '迟到分钟数') : null;
    statements.push(
      db
        .prepare(
          `UPDATE session_players
              SET attendance = ?, late_minutes = ?, attendance_note = ?
            WHERE session_id = ? AND user_id = ?`,
        )
        .bind(
          e.attendance,
          lateMinutes,
          normalizeOptionalText(e.note, SESSION_NOTE_MAX),
          id,
          e.user_id,
        ),
    );
  }
  if (statements.length > 0) await db.batch(statements);

  const session = await getSessionDetail(db, id, caller.id);
  return { session, drafts: buildDrafts(session, offsetHours) };
}

/** Turn recorded attendance into proposed cases. Pure derivation, no writes. */
export function buildDrafts(session: SessionDetail, offsetHours: number): CaseDraft[] {
  const label = localLabel(session.starts_at, offsetHours);
  const drafts: CaseDraft[] = [];
  for (const p of session.players) {
    if (p.attendance === null) continue;
    if (!p.is_participant) continue; // not on the board → no score to move
    const type = violationForAttendance(p.attendance, p.late_minutes);
    if (type === null) continue;
    const def = VIOLATION_MAP[type];
    if (!def) continue;
    // The organizer can't file against themselves; their bonus is handled separately.
    if (p.user.id === session.organizer.id) continue;
    // Same rule as planFilings: only a promise can be broken — or kept.
    if (p.rsvp !== 'going') continue;
    drafts.push({
      user_id: p.user.id,
      username: p.user.username,
      type,
      kind: def.kind,
      range: { min: def.min, max: def.max, base: def.base },
      suggested_claim: draftClaim(session.title, label, p.attendance, p.late_minutes),
      already_filed: p.record_id !== null,
    });
  }
  return drafts;
}

// --- Settlement --------------------------------------------------------------

export interface SettleEntry {
  user_id: string;
  type?: unknown;
  claim?: unknown;
}

function parseSettleEntries(raw: unknown): SettleEntry[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new ApiError(400, 'file 必须是数组');
  if (raw.length > MAX_ROLLCALL_ENTRIES) throw new ApiError(400, '立案条目过多');
  const seen = new Set<string>();
  return raw.map((item) => {
    if (typeof item !== 'object' || item === null) throw new ApiError(400, '立案条目格式错误');
    const rec = item as Record<string, unknown>;
    if (typeof rec.user_id !== 'string' || rec.user_id.length === 0) {
      throw new ApiError(400, '立案条目缺少 user_id');
    }
    // One attendance, one case. Settlement skips the per-day rate limits, so a
    // repeated user_id would otherwise file the same charge once per repeat.
    if (seen.has(rec.user_id)) throw new ApiError(400, '立案条目里有重复的人');
    seen.add(rec.user_id);
    return { user_id: rec.user_id, type: rec.type, claim: rec.claim };
  });
}

function organizerCanFile(env: Env): boolean {
  return (env.SESSION_ORGANIZER_CAN_FILE ?? 'true').trim().toLowerCase() !== 'false';
}

export interface SettleResult {
  session: SessionDetail;
  created: number;
  skipped: number;
}

interface PlannedFiling {
  player: SessionPlayer;
  type: ViolationType;
  claim: string;
}

/**
 * Turn the ticked drafts into concrete filings, or throw. Pure: no writes.
 *
 * Runs before anything is filed. Every input error has to surface here: a throw
 * halfway through filing leaves only the entries above it filed, and the retry
 * is refused as already settled. That includes the claim text, which is
 * normalised exactly as fileCase will check it.
 */
function planFilings(
  entries: SettleEntry[],
  players: Map<string, SessionPlayer>,
  row: SessionJoinRow,
  caller: User,
  label: string,
): PlannedFiling[] {
  const planned: PlannedFiling[] = [];
  for (const entry of entries) {
    const player = players.get(entry.user_id);
    if (!player) throw new ApiError(400, '只能给报名过这个约局的人立案');
    if (player.attendance === null) throw new ApiError(400, '请先完成点名');
    if (player.record_id !== null) continue; // already filed in a previous attempt
    if (!player.is_participant) continue;
    if (player.user.id === caller.id) continue; // never file against yourself
    // Matches buildDrafts: the organizer is never a defendant in their own roll
    // call, so an admin settling someone else's session cannot file against them
    // either — the draft list never offered it.
    if (player.user.id === row.organizer_id) continue;

    const derived = violationForAttendance(player.attendance, player.late_minutes);
    if (derived === null) continue;
    // Only for someone who said they would come. A penalty: 放鸽子 is "答应了
    // 没来" — someone merely invited (or a maybe) made no promise, and without
    // this an organizer could invite anyone, mark them absent and so file a
    // case, with its DM, against a person who never agreed to anything. And
    // the 守约 bonus is for a promise kept: a maybe risks no penalty, so it
    // earns no bonus either (else always answering 待定 farms it risk-free).
    if (player.rsvp !== 'going') continue;
    const requested =
      typeof entry.type === 'string' && entry.type.length > 0
        ? (entry.type as ViolationType)
        : derived;
    if (!isAllowedTypeOverride(derived, requested)) {
      throw new ApiError(400, '不允许把点名结果改判成其他类型');
    }

    const suggested = draftClaim(row.title, label, player.attendance, player.late_minutes);
    // Trim, cut to length, trim again — the same text fileCase's
    // normalizeNarrative will see — so a claim that is mostly whitespace falls
    // back to the draft here instead of failing over there.
    const typed =
      typeof entry.claim === 'string' ? entry.claim.trim().slice(0, MAX_NARRATIVE_LEN).trim() : '';
    const claim = typed.length >= MIN_CLAIM_LEN ? typed : suggested.slice(0, MAX_NARRATIVE_LEN);
    planned.push({ player, type: requested, claim });
  }
  return planned;
}

/**
 * Close a session. `file` lists exactly which drafts become real cases — an
 * empty list (or `skip_all`) settles the session with zero score impact.
 *
 * The violation type is ALWAYS re-derived server-side from stored attendance.
 * A client-supplied `type` is honoured only for the single legitimate human
 * re-classification: promoting a no-show to the group-wipe variant.
 */
export async function settleSession(
  db: D1Database,
  caller: User,
  id: number,
  rawFile: unknown,
  skipAll: boolean,
  env: Env,
  offsetHours: number,
): Promise<SettleResult> {
  const row = await getSessionRow(db, id);
  requireOrganizer(row, caller);
  if (row.status === 'cancelled') throw new ApiError(400, '已取消的约局不能结算');
  if (row.status === 'settled') throw new ApiError(409, '该约局已经结算过了');

  const entries = skipAll ? [] : parseSettleEntries(rawFile);
  const isOrganizer = row.organizer_id === caller.id;
  if (entries.length > 0 && !caller.is_judge && !caller.is_admin) {
    if (!isOrganizer || !organizerCanFile(env)) {
      throw new ApiError(403, '需要裁判权限才能立案，可以只记录出勤不扣分');
    }
  }

  // Claim the session BEFORE filing anything or granting the organizer bonus.
  // Settling is the only irreversible, score-moving step here, so the guard has
  // to come first — otherwise two concurrent settles would both file cases and
  // both award the bonus, and only the second would learn it lost the race.
  const claimed = await db
    .prepare(
      `UPDATE game_sessions SET status = 'settled', settled_at = datetime('now'), settled_by = ?
        WHERE id = ? AND status = 'open'`,
    )
    .bind(caller.id, id)
    .run();
  if ((claimed.meta?.changes ?? 0) === 0) throw new ApiError(409, '该约局已经结算过了');

  // Read the roster after the claim, so a roll call that landed just before it
  // still counts.
  const players = await db.prepare(PLAYER_SELECT).bind(id).all<SessionPlayerJoinRow>();
  const byId = new Map(players.results.map((p) => [p.user_id, toSessionPlayer(p)]));
  const label = localLabel(row.starts_at, offsetHours);
  let planned: PlannedFiling[];
  try {
    planned = planFilings(entries, byId, row, caller, label);
  } catch (err) {
    // Nothing has been filed yet, so handing the session back is safe — and it
    // is what lets the organizer fix the entry and retry.
    await db
      .prepare(
        `UPDATE game_sessions SET status = 'open', settled_at = NULL, settled_by = NULL
          WHERE id = ? AND status = 'settled' AND settled_by = ?`,
      )
      .bind(id, caller.id)
      .run();
    throw err;
  }

  let created = 0;
  for (const { player, type, claim } of planned) {
    // A capped 守约 bonus is skipped, not thrown: the organizer cannot fix it,
    // and throwing here would strand every filing after it. Same rule as
    // awardOrganizerBonus below.
    const def = VIOLATION_MAP[type];
    if (
      def?.kind === 'bonus' &&
      !(await fitsWeeklyBonusCap(db, player.user.id, def.base, offsetHours))
    ) {
      continue;
    }

    let record: RecordItem;
    try {
      record = await fileCase(
        db,
        caller,
        {
          subject_id: player.user.id,
          type,
          claim,
          session_id: id,
        },
      // The organizer is the only person who witnessed the session, so they may
      // file inside it even without the global judge role — bounded to this
      // session's own signed-up players, and switchable off via env.
      // `derived`: the type came from stored attendance, deterministically —
      // it never went near the AI classifier.
        { offsetHours, skipJudgeCheck: true, skipRateLimit: true, classifiedBy: 'derived' },
        env,
      );
    } catch (err) {
      // The cap filled up between the check above and the write: skip, as above.
      if (err instanceof BonusCapReached) continue;
      throw err;
    }
    await db
      .prepare('UPDATE session_players SET record_id = ? WHERE session_id = ? AND user_id = ?')
      .bind(record.id, id, player.user.id)
      .run();
    created += 1;
  }

  await awardOrganizerBonus(db, row, byId, offsetHours);

  const drafts = byId.size;
  return {
    session: await getSessionDetail(db, id, caller.id),
    created,
    skipped: Math.max(0, drafts - created),
  };
}

/**
 * Give the organizer their 组局 bonus once the session provably happened.
 *
 * Written directly rather than through `fileCase` because that (correctly)
 * refuses self-directed records. Self-dealing is bounded here by objective
 * conditions: the session must be settled, at least
 * ORGANIZER_BONUS_MIN_ATTENDEES people must actually have turned up, and the
 * weekly bonus cap still applies.
 */
async function awardOrganizerBonus(
  db: D1Database,
  row: SessionJoinRow,
  players: Map<string, SessionPlayer>,
  offsetHours: number,
): Promise<void> {
  const def = VIOLATION_MAP.organizer_bonus;
  if (!def) return;

  // Only people who said they would come count: an invitee who never replied
  // (or a maybe) could otherwise be marked present to farm this bonus.
  const attended = [...players.values()].filter(
    (p) => (p.attendance === 'on_time' || p.attendance === 'late') && p.rsvp === 'going',
  ).length;
  if (attended < ORGANIZER_BONUS_MIN_ATTENDEES) return;

  const organizer = await getUserById(db, row.organizer_id);
  if (!organizer || organizer.is_participant !== 1) return;

  // Cap reached: silently skip.
  if (!(await fitsWeeklyBonusCap(db, organizer.id, def.base, offsetHours))) return;

  const insert = await db
    .prepare(
      `INSERT INTO records
         (subject_id, reporter_id, type, delta, claim, session_id,
          verdict_source, verdict_headline, verdict_reason, status)
       VALUES (?, ?, 'organizer_bonus', 0, ?, ?, 'manual', '组局召集', '结算时由系统自动发放。', 'decided')`,
    )
    .bind(
      organizer.id,
      organizer.id,
      `组织了约局「${row.title}」，${attended} 人到场。`,
      row.id,
    )
    .run();
  const recordId = Number(insert.meta?.last_row_id);
  if (!recordId) return;

  const reason = `record:${recordId}`;
  const applied = appliedDeltaSql(organizer.id, reason);
  const results = await db.batch([
    ...scoreMutation(db, organizer.id, def.base, reason, bonusCapGuard(organizer.id, def.base, offsetHours)),
    db.prepare(`UPDATE records SET delta = ${applied.sql} WHERE id = ?`).bind(...applied.binds, recordId),
  ]);
  // Capped meanwhile by another bonus: skipped after all, like above.
  if ((results[1]?.meta?.changes ?? 0) === 0) {
    await db.prepare('DELETE FROM records WHERE id = ?').bind(recordId).run();
  }
}
