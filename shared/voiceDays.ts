// Pure UTC arithmetic. Dates belong to the board's fixed offset; persisted
// timestamps are second-resolution UTC text, never the host's local clock.
import { VOICE_RANGE_MAX_DAYS, type VoiceEndReason, type VoiceStartReason } from './voice';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

export interface VoiceSegmentRow {
  channel_name: string;
  joined_at: string;
  left_at: string | null;
  start_reason: VoiceStartReason;
  end_reason: VoiceEndReason | null;
}
export interface CoverageRow { started_at: string; last_seen_at: string }
export interface VoiceDaySegment extends VoiceSegmentRow { continued: boolean }
export interface VoiceDay { date: string; first_join: string | null; total_min: number; segments: VoiceDaySegment[] }
export interface VoiceGap { from: string; to: string }

function sqlUtc(ms: number): string {
  const iso = new Date(ms).toISOString();
  if (!/^\d{4}-/.test(iso)) throw new RangeError('语音时间超出可表示范围');
  return iso.slice(0, 19).replace('T', ' ');
}

function calendarDate(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError('日期应为 YYYY-MM-DD');
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) throw new RangeError('日期不存在');
  return ms;
}

function timestamp(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) throw new RangeError('语音时间应为 UTC 文本');
  const ms = Date.parse(value.replace(' ', 'T') + 'Z');
  if (!Number.isFinite(ms) || sqlUtc(ms) !== value) throw new RangeError('语音时间不存在');
  return ms;
}

/** Inclusive board dates become the UTC [start, end) used by both SQL and math. */
export function voiceRangeBounds(from: string, to: string, offsetHours: number): { start: string; end: string } {
  const first = calendarDate(from);
  const last = calendarDate(to);
  const count = (last - first) / DAY_MS + 1;
  if (count < 1 || count > VOICE_RANGE_MAX_DAYS) throw new RangeError(`一次最多查询 ${VOICE_RANGE_MAX_DAYS} 天，且结束日期不能早于开始日期`);
  if (!Number.isFinite(offsetHours)) throw new RangeError('榜单时区无效');
  const shift = offsetHours * HOUR_MS;
  return { start: sqlUtc(first - shift), end: sqlUtc(last + DAY_MS - shift) };
}

interface ParsedSegment { row: VoiceSegmentRow; start: number; end: number }
interface Span { start: number; end: number }

/** Copy only the declared public fields, even if a DB caller supplied more. */
function publicSegment(row: VoiceSegmentRow, continued: boolean): VoiceDaySegment {
  return { channel_name: row.channel_name, joined_at: row.joined_at, left_at: row.left_at,
    start_reason: row.start_reason, end_reason: row.end_reason, continued };
}

function uncovered(coverage: readonly CoverageRow[], start: number, end: number): VoiceGap[] {
  if (end <= start) return [];
  const spans: Span[] = [];
  for (const row of coverage) {
    const from = timestamp(row.started_at);
    const to = timestamp(row.last_seen_at);
    if (to < from) throw new RangeError('覆盖时段结束早于开始');
    const clipped = { start: Math.max(start, from), end: Math.min(end, to) };
    if (clipped.end > clipped.start) spans.push(clipped);
  }
  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  const gaps: VoiceGap[] = [];
  let cursor = start;
  for (const span of spans) {
    if (span.start > cursor) gaps.push({ from: sqlUtc(cursor), to: sqlUtc(span.start) });
    cursor = Math.max(cursor, span.end);
  }
  if (cursor < end) gaps.push({ from: sqlUtc(cursor), to: sqlUtc(end) });
  return gaps;
}

export function voiceDays(input: {
  segments: readonly VoiceSegmentRow[];
  coverage: readonly CoverageRow[];
  from: string;
  to: string;
  offsetHours: number;
  now: string;
}): { days: VoiceDay[]; gaps: VoiceGap[] } {
  const bounds = voiceRangeBounds(input.from, input.to, input.offsetHours);
  const start = timestamp(bounds.start);
  const end = timestamp(bounds.end);
  const now = timestamp(input.now);
  const rows: ParsedSegment[] = [];
  for (const row of input.segments) {
    const joined = timestamp(row.joined_at);
    const persistedLeft = row.left_at === null ? null : timestamp(row.left_at);
    if (persistedLeft !== null && persistedLeft < joined) throw new RangeError('语音段结束早于进入');
    // The caller fixes now before its DB read. A concurrent join/leave may
    // already be in that later read; never count observations past the snapshot.
    if (joined > now) continue;
    rows.push({ row, start: joined, end: Math.min(persistedLeft ?? now, now) });
  }
  rows.sort((a, b) => a.start - b.start || a.end - b.end
    || (a.row.channel_name < b.row.channel_name ? -1 : a.row.channel_name > b.row.channel_name ? 1 : 0));

  const days: VoiceDay[] = [];
  const firstDate = calendarDate(input.from);
  for (let dayStart = start, index = 0; dayStart < end; dayStart += DAY_MS, index += 1) {
    const dayEnd = Math.min(end, dayStart + DAY_MS);
    let totalMs = 0;
    let firstJoin: string | null = null;
    const segments: VoiceDaySegment[] = [];
    for (const segment of rows) {
      // The same strict overlap predicate as SQL. A zero-second visit inside
      // the day is still evidence; one ending at midnight belongs to yesterday.
      if (segment.start >= dayEnd || segment.end <= dayStart) continue;
      const continued = segment.start < dayStart;
      segments.push(publicSegment(segment.row, continued));
      totalMs += Math.max(0, Math.min(segment.end, dayEnd) - Math.max(segment.start, dayStart));
      if (!continued && firstJoin === null) firstJoin = segment.row.joined_at;
    }
    days.push({ date: new Date(firstDate + index * DAY_MS).toISOString().slice(0, 10),
      first_join: firstJoin, total_min: Math.floor(totalMs / MINUTE_MS), segments });
  }

  // Deliberately no heartbeat grace: only committed intervals prove coverage.
  // A recorder failure can leave a fresh row behind, so freshness is not proof
  // that events after last_seen_at were successfully persisted.
  return { days, gaps: uncovered(input.coverage, start, Math.min(end, now)) };
}
