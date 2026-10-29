// Evidence wording and fixed-board-time formatting shared by the web and bot.
import type { VoiceDay, VoiceDaySegment } from './voiceDays';

export const VOICE_GAP_NOTICE = '这些时段没有完整记录，没有记录不代表没来。';
export const VOICE_EMPTY_NOTICE = '没有保存的语音记录，不代表没来';
export const VOICE_MINUTE_NOTE = '累计时长按天向下取整到分钟。';
export const VOICE_GAP_EXPLANATION = '未覆盖表示缺少完整证据，也可能来自记录清理或尚未持久化的心跳尾段。';
const HOUR_MS = 3_600_000;
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;
const pad2 = (value: number): string => String(value).padStart(2, '0');

function utcMillis(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return NaN;
  const result = Date.parse(value.replace(' ', 'T') + 'Z');
  if (!Number.isFinite(result) || new Date(result).toISOString().slice(0, 19).replace('T', ' ') !== value) return NaN;
  return result;
}

/** UTC text → the board's clock, never the viewer's or server's local zone. */
export function voiceTime(value: string, offsetHours: number, includeDate = false, includeSeconds = false): string {
  const at = new Date(utcMillis(value) + offsetHours * HOUR_MS);
  if (!Number.isFinite(offsetHours) || !Number.isFinite(at.getTime())) return '—';
  const clock = `${pad2(at.getUTCHours())}:${pad2(at.getUTCMinutes())}${includeSeconds ? `:${pad2(at.getUTCSeconds())}` : ''}`;
  return includeDate ? `${pad2(at.getUTCMonth() + 1)}-${pad2(at.getUTCDate())} ${clock}` : clock;
}

/** Input is already a board calendar date, so its weekday needs no zone shift. */
export function voiceDayLabel(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '—';
  const at = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(at.getTime()) || at.toISOString().slice(0, 10) !== date) return '—';
  return `${date.slice(5)} ${WEEKDAYS[at.getUTCDay()]}`;
}

export function voiceDuration(totalMin: number): string {
  if (!Number.isFinite(totalMin) || totalMin < 0) return '—';
  const total = Math.floor(totalMin);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return hours > 0 ? `${hours}小时${minutes > 0 ? `${minutes}分钟` : ''}` : `${total}分钟`;
}

/** These observations must stay qualified even when individual rows are omitted. */
export function voiceSegmentNotes(segment: VoiceDaySegment): string[] {
  const notes: string[] = [];
  if (segment.continued) notes.push('接上一天');
  if (segment.start_reason === 'bot_online') notes.push('机器人上线时已在语音里');
  if (segment.end_reason === 'bot_offline') notes.push('之后机器人离线，离开时间不确定');
  if (segment.left_at === null) notes.push('尚未记录离开', '时长按查询时刻估算');
  return notes;
}

/** Keep exact stored boundaries. A day context only suppresses repeated dates. */
export function voiceInterval(from: string, to: string | null, offsetHours: number, dayDate?: string): string {
  const endpoint = (value: string): string => {
    const at = new Date(utcMillis(value) + offsetHours * HOUR_MS);
    const sameDay = dayDate !== undefined && Number.isFinite(at.getTime()) && at.toISOString().slice(0, 10) === dayDate;
    return voiceTime(value, offsetHours, !sameDay, true);
  };
  return `${endpoint(from)} – ${to === null ? '尚未记录离开' : endpoint(to)}`;
}

/** A continued row does not establish a new arrival on this calendar date. */
export function voiceFirstJoinText(day: Pick<VoiceDay, 'first_join' | 'segments'>, offsetHours: number): string {
  if (day.first_join !== null) return `首次进入 ${voiceTime(day.first_join, offsetHours, false, true)}`;
  return day.segments.some(segment => segment.continued) ? '接上一天' : '首次进入时间未记录';
}

/** The API's complete calendar range, with years visible across New Year. */
export function voiceHistoryPeriod(days: readonly Pick<VoiceDay, 'date'>[]): string {
  const dates = days.map(day => day.date).filter(date => voiceDayLabel(date) !== '—').sort();
  return dates.length > 0 ? `${dates[0]} — ${dates[dates.length - 1]}` : '日期范围未知';
}

/** Presentation order only; retain empty dates and leave evidence objects untouched. */
export function voiceDaysRecentFirst(days: readonly VoiceDay[]): VoiceDay[] {
  return [...days].sort((a, b) => b.date.localeCompare(a.date));
}
