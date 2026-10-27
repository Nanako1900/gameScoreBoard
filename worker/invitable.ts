// P2-2: GET /api/me/invitable — everyone the caller could invite to a session.
//
// Names and avatars only: the SELECT lists its five columns (never `u.*`) and
// joins nothing about Discord, so no score, role, email or binding can leak
// (spec §8 B2-2, contract §6.1). `last_played_with_me_at` is the caller's own
// history with each person, so the route marks the response private.
//
// The SQL must be valid on SQLite (D1) and PostgreSQL alike (contract §3.4):
// no NULLS LAST, no SELECT aliases inside ORDER BY expressions.

import type { InvitableUser } from './types';

/** Upper bound on the rows one call returns: a friend group is a few dozen people. */
export const MAX_INVITABLE = 500;

interface InvitableRow {
  id: string;
  username: string;
  avatar_url: string | null;
  is_participant: number;
  last_played_with_me_at: string | null;
}

// "Played with me" (contract §8 #9): a session that has started (starts_at is
// ISO, so it is compared with an ISO "now", never datetime('now')) and was not
// cancelled, where both of us said 来 and neither was marked 没来 / 请假. An
// unmarked attendance counts as there: most sessions never get a roll call.
// Order: who played with me (latest first), then the board, then name and id.
const INVITABLE_SQL = `
  SELECT u.id, COALESCE(u.display_name, u.username) AS username, u.avatar_url, u.is_participant,
         lp.at AS last_played_with_me_at
    FROM users u
    LEFT JOIN (
          SELECT them.user_id AS user_id, MAX(g.starts_at) AS at
            FROM session_players me
            JOIN game_sessions g      ON g.id = me.session_id
            JOIN session_players them ON them.session_id = me.session_id AND them.user_id <> me.user_id
           WHERE me.user_id = ?
             AND g.status <> 'cancelled' AND g.starts_at <= ?
             AND me.rsvp = 'going' AND them.rsvp = 'going'
             AND (me.attendance IS NULL OR me.attendance NOT IN ('no_show', 'excused'))
             AND (them.attendance IS NULL OR them.attendance NOT IN ('no_show', 'excused'))
           GROUP BY them.user_id
         ) lp ON lp.user_id = u.id
   WHERE u.id <> ?
   ORDER BY CASE WHEN lp.at IS NULL THEN 1 ELSE 0 END, lp.at DESC,
            u.is_participant DESC, COALESCE(u.display_name, u.username) ASC, u.id ASC
   LIMIT ?`;

/** Everyone but the caller, as exactly the five keys of InvitableUser. */
export async function listInvitable(db: D1Database, callerId: string): Promise<InvitableUser[]> {
  const nowIso = new Date().toISOString();
  const rows = await db
    .prepare(INVITABLE_SQL)
    .bind(callerId, nowIso, callerId, MAX_INVITABLE)
    .all<InvitableRow>();
  return rows.results.map((row) => ({
    id: row.id,
    username: row.username,
    avatar_url: row.avatar_url,
    is_participant: row.is_participant === 1,
    last_played_with_me_at: row.last_played_with_me_at,
  }));
}
