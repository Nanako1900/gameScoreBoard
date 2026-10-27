// One private embed. Long histories first lose detail, then whole lines; the
// coverage warning and uncertainty qualifications survive both reductions.
import { boardTzLabel } from '../../../shared/boardTime';
import type { VoiceHistoryResponse } from '../../../shared/voiceApi';
import type { VoiceDay, VoiceDaySegment } from '../../../shared/voiceDays';
import { VOICE_GAP_NOTICE, voiceDayLabel, voiceDuration, voiceSegmentNotes, voiceTime } from '../../../shared/voicePresentation';
import { VOICE_UNKNOWN_CHANNEL } from '../../../shared/voice';
import { GOLD, RED, LIMITS, fitLines, safeLine } from './render';
import type { BotEmbed } from './types';

const COMPLETE = '完整记录请找裁判在网页查看';
const NAME_MAX = 64;
const CHANNEL_MAX = 256;

function summary(day: VoiceDay, offsetHours: number): string {
  const first = day.first_join === null ? '—' : voiceTime(day.first_join, offsetHours);
  return `${voiceDayLabel(day.date)} · 首次 ${first} · 共 ${voiceDuration(day.total_min)}`;
}
function notes(segments: readonly VoiceDaySegment[]): string[] {
  return [...new Set(segments.flatMap(voiceSegmentNotes))];
}
function segmentLine(segment: VoiceDaySegment, day: VoiceDay, offsetHours: number): string {
  const at = (value: string): string => {
    const dated = voiceTime(value, offsetHours, true);
    return dated.slice(0, 5) === day.date.slice(5) ? voiceTime(value, offsetHours) : dated;
  };
  const end = segment.left_at === null ? '尚未记录离开' : at(segment.left_at);
  // The unclosed marker already forms the range's end, so say it only once.
  const qualifications = voiceSegmentNotes(segment).filter((note) => note !== '尚未记录离开');
  const channel = safeLine(segment.channel_name, CHANNEL_MAX) || VOICE_UNKNOWN_CHANNEL;
  return `  ${at(segment.joined_at)}–${end} ${channel}${qualifications.length ? `（${qualifications.join('；')}）` : ''}`;
}

export function renderVoiceHistory(history: VoiceHistoryResponse, offsetHours: number): BotEmbed {
  const daily = history.days.map((day) => summary(day, offsetHours));
  const detailed = history.days.flatMap((day, index) => [daily[index], ...day.segments.map((segment) => segmentLine(segment, day, offsetHours))]);
  const compact = history.days.map((day, index) => {
    const qualifications = notes(day.segments);
    return `${daily[index]}${qualifications.length ? `（${qualifications.join('；')}）` : ''}`;
  });
  const gaps = history.gaps.map((gap) => `${voiceTime(gap.from, offsetHours, true)}–${voiceTime(gap.to, offsetHours, true)}`);
  const body = (days: string[], warning = true): string => [days.join('\n'),
    ...(gaps.length ? ['未覆盖时段', ...(warning ? [VOICE_GAP_NOTICE] : []), gaps.join('\n')] : [])].filter(Boolean).join('\n\n');
  const footer = `保留 ${history.retention_days} 天 · 时间按${boardTzLabel(offsetHours)}`;
  const embed: BotEmbed = {
    title: `语音记录 · ${safeLine(history.user.username, NAME_MAX) || '未命名玩家'}`,
    color: gaps.length > 0 ? RED : GOLD,
    footer: { text: footer },
  };
  const full = body(detailed);
  if (full.length <= LIMITS.embedDescription) return { ...embed, description: full || '暂无可显示的分日记录。' };

  const condensed = body(compact);
  const omission = history.days.some((day) => day.segments.length > 0) ? '段明细已省略。' : '';
  if (condensed.length <= LIMITS.embedDescription) {
    return { ...embed, description: condensed, footer: { text: `${footer}\n${omission}${COMPLETE}` } };
  }
  // Reserve the footer for facts that must never disappear during truncation.
  // Its bounded, fixed vocabulary plus the short zone/retention label is well
  // below 2048 chars; title + description + footer stays below the 6000 total.
  const qualifications = notes(history.days.flatMap((day) => day.segments));
  return { ...embed,
    description: fitLines(body(compact, false).split('\n'), LIMITS.embedDescription, (count) => `…其余 ${count} 行已省略`),
    footer: { text: [footer, omission, qualifications.join('；'), ...(gaps.length ? [VOICE_GAP_NOTICE] : []), COMPLETE].filter(Boolean).join('\n') },
  };
}
