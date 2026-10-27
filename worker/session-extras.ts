// Batch reads for session lists: one query per page of sessions, never one per
// session (no N+1). Every function here takes the ids of a whole page and
// answers for all of them at once with a bound `IN (…)` list.
//
// Reads only — nothing in this module writes.

import { GOING_PREVIEW_MAX } from '../shared/attendance';
import type { RecordActor, SessionPlayer } from './types';
import { isSelfRsvp, type SelfRsvp } from '../shared/attendance';
import { ATTENDANCES, isAttendance } from '../shared/attendance';
import type { AttendanceSummary } from './types';

/** `?, ?, …` for `count` values. Built from the count only — the values stay bound. */
function holes(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

// --- P2-6: going_preview -------------------------------------------------------

interface GoingPreviewRow {
  session_id: number;
  user_id: string;
  username: string;
  avatar_url: string | null;
}

function toPreviewMap(rows: readonly GoingPreviewRow[]): Map<number, RecordActor[]> {
  const out = new Map<number, RecordActor[]>();
  for (const r of rows) {
    const list = out.get(r.session_id) ?? [];
    if (list.length >= GOING_PREVIEW_MAX) continue;
    out.set(r.session_id, [...list, { id: r.user_id, username: r.username, avatar_url: r.avatar_url }]);
  }
  return out;
}

/**
 * For each session: up to GOING_PREVIEW_MAX people whose answer is 来, earliest
 * answer first (ties by user id). Names and avatars only — never a score.
 * A session nobody is coming to has no entry. No ids, no query.
 */
export async function goingPreviews(
  db: D1Database,
  sessionIds: readonly number[],
): Promise<Map<number, RecordActor[]>> {
  if (sessionIds.length === 0) return new Map();
  const rows = await db
    .prepare(
      `SELECT sp.session_id, sp.user_id,
              COALESCE(u.display_name, u.username) AS username, u.avatar_url
         FROM session_players sp
         JOIN users u ON u.id = sp.user_id
        WHERE sp.rsvp = 'going' AND sp.session_id IN (${holes(sessionIds.length)})
        ORDER BY sp.session_id ASC, sp.rsvp_at ASC, sp.user_id ASC`,
    )
    .bind(...sessionIds)
    .all<GoingPreviewRow>();
  return toPreviewMap(rows.results);
}

function byAnswerTime(a: SessionPlayer, b: SessionPlayer): number {
  if (a.rsvp_at !== b.rsvp_at) return a.rsvp_at < b.rsvp_at ? -1 : 1;
  if (a.user.id === b.user.id) return 0;
  return a.user.id < b.user.id ? -1 : 1;
}

/**
 * The same preview, from a roster already loaded (the detail page): same filter,
 * same order, same cut as goingPreviews — and no query.
 */
export function previewOfPlayers(players: readonly SessionPlayer[]): RecordActor[] {
  return players
    .filter((p) => p.rsvp === 'going')
    .sort(byAnswerTime)
    .slice(0, GOING_PREVIEW_MAX)
    .map((p) => ({ id: p.user.id, username: p.user.username, avatar_url: p.user.avatar_url }));
}

// --- P2-3 ---

/** What a move left behind for one person: what they had said, and to which time. */
export interface InviteContext {
  prev_rsvp: SelfRsvp | null;
  prev_starts_at: string | null;
}

/** The caller's own context in each of `sessionIds` (rows they are not in are simply absent). */
export async function inviteContexts(
  db: D1Database,
  callerId: string,
  sessionIds: number[],
): Promise<Map<number, InviteContext>> {
  if (sessionIds.length === 0) return new Map();
  // holes() is P2-6's private helper in this file: placeholders from the count only.
  const rows = await db
    .prepare(
      `SELECT session_id, prev_rsvp, prev_starts_at FROM session_players
        WHERE user_id = ? AND session_id IN (${holes(sessionIds.length)})`,
    )
    .bind(callerId, ...sessionIds)
    .all<{ session_id: number; prev_rsvp: string | null; prev_starts_at: string | null }>();
  return new Map(
    rows.results.map((r) => [
      r.session_id,
      {
        prev_rsvp: r.prev_rsvp !== null && isSelfRsvp(r.prev_rsvp) ? r.prev_rsvp : null,
        prev_starts_at: r.prev_starts_at,
      },
    ]),
  );
}

/** A session nobody has been roll-called in: all five kinds, zero each. */
export const NO_ATTENDANCE: Readonly<AttendanceSummary> = Object.freeze(
  Object.fromEntries(ATTENDANCES.map((a) => [a, 0])) as AttendanceSummary,
);

/** Roll-call counts per session: every id gets all five keys, zeros included. One GROUP BY for the page. */
export async function attendanceSummaries(
  db: D1Database,
  sessionIds: number[],
): Promise<Map<number, AttendanceSummary>> {
  const out = new Map<number, AttendanceSummary>(sessionIds.map((id) => [id, { ...NO_ATTENDANCE }]));
  if (sessionIds.length === 0) return out;
  const rows = await db
    .prepare(
      `SELECT session_id, attendance, COUNT(*) AS n FROM session_players
        WHERE session_id IN (${holes(sessionIds.length)}) AND attendance IS NOT NULL
        GROUP BY session_id, attendance`,
    )
    .bind(...sessionIds)
    .all<{ session_id: number; attendance: string; n: number }>();
  for (const r of rows.results) {
    const before = out.get(r.session_id);
    if (before && isAttendance(r.attendance)) out.set(r.session_id, { ...before, [r.attendance]: Number(r.n) });
  }
  return out;
}
