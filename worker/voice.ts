// Read the same private evidence through the D1 facade on both backends.
// Read coverage around the segment query: later checkpoints cannot certify
// earlier missing rows, and a concurrent cleanup cannot leave revoked coverage.
import { VOICE_RETENTION_DAYS } from '../shared/voice';
import { intersectVoiceCoverage } from '../shared/voiceCoverage';
import { firstAvailableVoiceDate, voiceDays, voiceRangeBounds, type CoverageRow, type VoiceSegmentRow } from '../shared/voiceDays';
import type { VoiceDayResponse, VoiceDayUser, VoiceHistoryResponse, VoiceUserRef } from '../shared/voiceApi';
import { ApiError } from './errors';
import { NUL_MESSAGE } from './http';
import { parseSqlUtc, toSqlUtc } from './time';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
interface Range { from: string; to: string; start: string; end: string }
interface RosterRow extends VoiceSegmentRow { user_id: string; username: string; avatar_url: string | null }

function boardDate(now: string, offsetHours: number): string {
  return toSqlUtc(new Date(parseSqlUtc(now) + offsetHours * HOUR_MS)).slice(0, 10);
}
function checkedRange(from: string, to: string, offsetHours: number, now: string): Range {
  let bounds: { start: string; end: string };
  try { bounds = voiceRangeBounds(from, to, offsetHours); }
  catch (error) {
    if (error instanceof RangeError) throw new ApiError(400, `语音记录日期无效：${error.message}`);
    throw error;
  }
  if (parseSqlUtc(bounds.start) < parseSqlUtc(now) - VOICE_RETENTION_DAYS * DAY_MS) {
    throw new ApiError(400, `语音记录只保留 ${VOICE_RETENTION_DAYS} 天，请从 ${firstAvailableVoiceDate(now, offsetHours)} 起查询`);
  }
  return { from, to, ...bounds };
}
function historyRange(from: string | undefined, to: string | undefined, offsetHours: number, now: string): Range {
  const last = to ?? boardDate(now, offsetHours);
  // Validate an explicit end before deriving its default start: Date.parse
  // alone normalizes impossible dates such as February 30.
  try { voiceRangeBounds(last, last, offsetHours); }
  catch (error) {
    if (error instanceof RangeError) throw new ApiError(400, `语音记录日期无效：${error.message}`);
    throw error;
  }
  const first = from ?? new Date(Date.parse(`${last}T00:00:00Z`) - 6 * DAY_MS).toISOString().slice(0, 10);
  return checkedRange(first, last, offsetHours, now);
}
async function readCoverage(db: D1Database, range: Range): Promise<CoverageRow[]> {
  const rows = await db.prepare(`SELECT started_at, last_seen_at FROM voice_coverage
    WHERE started_at < ? AND last_seen_at >= ? ORDER BY started_at, last_seen_at`)
    .bind(range.end, range.start).all<CoverageRow>();
  return rows.results;
}

export async function getVoiceHistory(db: D1Database, userId: string, from: string | undefined,
  to: string | undefined, offsetHours: number, now: string): Promise<VoiceHistoryResponse> {
  // The public URL guard already rejects %00; keep direct bot/shared calls
  // from aliasing a PG identifier when its adapter removes a literal NUL.
  if (userId.includes('\u0000')) throw new ApiError(400, NUL_MESSAGE);
  const range = historyRange(from, to, offsetHours, now);
  const user = await db.prepare('SELECT id, COALESCE(display_name, username) AS username, avatar_url FROM users WHERE id = ?')
    .bind(userId).first<VoiceUserRef>();
  if (!user) throw new ApiError(404, '用户不存在');
  const before = await readCoverage(db, range);
  const rows = await db.prepare(`SELECT channel_name, joined_at, left_at, start_reason, end_reason
    FROM voice_sessions WHERE user_id = ? AND joined_at < ? AND COALESCE(left_at, ?) > ?
    ORDER BY joined_at, id`).bind(userId, range.end, now, range.start).all<VoiceSegmentRow>();
  const coverage = intersectVoiceCoverage(before, await readCoverage(db, range));
  const result = voiceDays({ segments: rows.results, coverage, from: range.from, to: range.to, offsetHours, now });
  return { user, ...result, retention_days: VOICE_RETENTION_DAYS };
}

export async function getVoiceDay(db: D1Database, date: string | undefined, offsetHours: number, now: string): Promise<VoiceDayResponse> {
  const selected = date ?? boardDate(now, offsetHours);
  const range = checkedRange(selected, selected, offsetHours, now);
  const before = await readCoverage(db, range);
  const rows = await db.prepare(`SELECT s.user_id, COALESCE(u.display_name, u.username) AS username, u.avatar_url,
      s.channel_name, s.joined_at, s.left_at, s.start_reason, s.end_reason
    FROM voice_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.joined_at < ? AND COALESCE(s.left_at, ?) > ? ORDER BY s.joined_at, s.id`)
    .bind(range.end, now, range.start).all<RosterRow>();
  const coverage = intersectVoiceCoverage(before, await readCoverage(db, range));
  const grouped = new Map<string, RosterRow[]>();
  for (const row of rows.results) {
    const group = grouped.get(row.user_id) ?? [];
    group.push(row); grouped.set(row.user_id, group);
  }
  const gaps = voiceDays({ segments: [], coverage, from: selected, to: selected, offsetHours, now }).gaps;
  const currentObserved = range.start <= now && now < range.end
    && coverage.some((row) => row.started_at <= now && now <= row.last_seen_at);
  const users: VoiceDayUser[] = [];
  for (const group of grouped.values()) {
    const day = voiceDays({ segments: group, coverage: [], from: selected, to: selected, offsetHours, now }).days[0];
    // The DB read can include a join after our fixed now; the pure function
    // ignores it and it must not create an empty roster entry either.
    if (day.segments.length === 0) continue;
    const first = group[0];
    const hasOpen = day.segments.some((row) => row.left_at === null);
    users.push({ user: { id: first.user_id, username: first.username, avatar_url: first.avatar_url },
      first_join: day.first_join, total_min: day.total_min, has_open_segment: hasOpen,
      in_voice_now: hasOpen && currentObserved });
  }
  users.sort((a, b) => {
    if (a.first_join !== b.first_join) {
      if (a.first_join === null) return 1;
      if (b.first_join === null) return -1;
      return a.first_join < b.first_join ? -1 : 1;
    }
    return a.user.id < b.user.id ? -1 : a.user.id > b.user.id ? 1 : 0;
  });
  return { date: selected, users, gaps, retention_days: VOICE_RETENTION_DAYS };
}
