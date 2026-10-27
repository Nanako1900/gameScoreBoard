// P2-1 (spec §8 B2-1): invite more people after a session was created.
//
// POST /api/sessions/:id/invite { user_ids } → { session, added, skipped }.
// New people land in `invited`; a row already there — a yes, a no, an
// unanswered invitation — is never touched (the answer is theirs). On
// PostgreSQL each inserted row is an INSERT the session_players_outbox trigger
// turns into one dm.session.invited (0005_sessions.sql), under the
// dispatcher's allowances; D1 sends nothing, as today.

import { MAX_SESSION_ROSTER } from '../shared/attendance';
import type { InviteResult, User } from './types';
import { ApiError } from './errors';
import {
  getSessionDetail,
  getSessionRow,
  normalizeInvites,
  requireOrganizer,
  type SessionJoinRow,
} from './sessions';
import { parseSqlUtc } from './time';

/** Who may invite, and when: the caller first, then the session (session-update's order). */
function assertCanInvite(row: SessionJoinRow, caller: User): void {
  requireOrganizer(row, caller);
  if (row.status !== 'open') throw new ApiError(400, '已取消 / 已结算的约局不能再叫人');
  if (parseSqlUtc(row.starts_at) <= Date.now()) throw new ApiError(400, '约局已开始，不能再叫人');
}

/** The ids asked for: an array, not empty, then normalizeInvites (strings, distinct, ≤ MAX_INVITES, no organizer). */
function requestedIds(raw: unknown, organizerId: string): string[] {
  // normalizeInvites reads a missing list as "nobody" (creating a session may omit it); here it is required.
  if (!Array.isArray(raw)) throw new ApiError(400, 'user_ids 必须是数组');
  if (raw.length === 0) throw new ApiError(400, '至少选一个人');
  return normalizeInvites(raw, organizerId, 'user_ids');
}

/** The friendly roster check, with the count in the message; the INSERTs hold it again. */
async function assertRosterRoom(db: D1Database, id: number, ids: readonly string[]): Promise<void> {
  const present = await db
    .prepare('SELECT user_id FROM session_players WHERE session_id = ?')
    .bind(id)
    .all<{ user_id: string }>();
  const inIt = new Set(present.results.map((r) => r.user_id));
  const fresh = ids.filter((userId) => !inIt.has(userId)).length;
  if (inIt.size + fresh > MAX_SESSION_ROSTER) {
    throw new ApiError(400, `这局最多 ${MAX_SESSION_ROSTER} 人，已经有 ${inIt.size} 人了`);
  }
}

/** One INSERT per person, in one batch: still open, still room, unknown ids and existing rows skipped. */
async function insertInvites(db: D1Database, id: number, ids: readonly string[]): Promise<number> {
  const results = await db.batch([
    // PostgreSQL: take the session's row lock first (as setRsvp does); D1 serialises batches.
    db.prepare('UPDATE game_sessions SET status = status WHERE id = ?').bind(id),
    ...ids.map((userId) =>
      db
        .prepare(
          `INSERT INTO session_players (session_id, user_id, rsvp)
           SELECT ?, u.id, 'invited' FROM users u
            WHERE u.id = ?
              AND EXISTS (SELECT 1 FROM game_sessions WHERE id = ? AND status = 'open')
              AND (SELECT COUNT(*) FROM session_players WHERE session_id = ?) < ?
           ON CONFLICT (session_id, user_id) DO NOTHING`,
        )
        .bind(id, userId, id, id, MAX_SESSION_ROSTER),
    ),
  ]);
  return results.slice(1).reduce((sum, r) => sum + (r.meta?.changes ?? 0), 0);
}

export async function inviteToSession(
  db: D1Database,
  caller: User,
  id: number,
  rawUserIds: unknown,
): Promise<InviteResult> {
  const row = await getSessionRow(db, id);
  assertCanInvite(row, caller);
  const ids = requestedIds(rawUserIds, row.organizer_id);
  if (ids.length === 0) {
    return { session: await getSessionDetail(db, id, caller.id), added: 0, skipped: 0 };
  }
  await assertRosterRoom(db, id, ids);
  const added = await insertInvites(db, id, ids);
  return { session: await getSessionDetail(db, id, caller.id), added, skipped: ids.length - added };
}
