// One private embed. Keep the evidence summary when detail is too long;
// only complete gap entries are omitted at the final reduction.
import { boardTzLabel } from '../../../shared/boardTime';
import type { VoiceHistoryResponse } from '../../../shared/voiceApi';
import type { VoiceDay, VoiceDaySegment } from '../../../shared/voiceDays';
import {
  VOICE_EMPTY_NOTICE,
  VOICE_GAP_EXPLANATION,
  VOICE_GAP_NOTICE,
  VOICE_MINUTE_NOTE,
  voiceDayLabel,
  voiceDaysRecentFirst,
  voiceDuration,
  voiceFirstJoinText,
  voiceHistoryPeriod,
  voiceInterval,
  voiceSegmentNotes,
} from '../../../shared/voicePresentation';
import { VOICE_UNKNOWN_CHANNEL } from '../../../shared/voice';
import { GOLD, RED, LIMITS, fitLines, safeLine } from './render';
import type { BotEmbed } from './types';

const COMPLETE = '完整记录请在网页查看';
const NAME_MAX = 64;
const CHANNEL_MAX = 256;

function summary(day: VoiceDay, offsetHours: number): string {
  const heading = `**${voiceDayLabel(day.date)}**`;
  return `${heading}\n${day.segments.length === 0 ? '无保存记录'
    : `累计 ${voiceDuration(day.total_min)} · ${voiceFirstJoinText(day, offsetHours)}`}`;
}

function notes(segments: readonly VoiceDaySegment[]): string[] {
  return [...new Set(segments.flatMap(voiceSegmentNotes))];
}

function segmentBlock(segment: VoiceDaySegment, day: VoiceDay, offsetHours: number): string {
  // The range already marks an unclosed segment. Other qualifications remain
  // on their own line instead of competing with the channel and timestamps.
  const qualifications = voiceSegmentNotes(segment).filter(note => note !== '尚未记录离开');
  const channel = safeLine(segment.channel_name, CHANNEL_MAX) || VOICE_UNKNOWN_CHANNEL;
  return [
    `• ${channel}`,
    `  ${voiceInterval(segment.joined_at, segment.left_at, offsetHours, day.date)}`,
    ...(qualifications.length > 0 ? [`  说明：${qualifications.join('；')}`] : []),
  ].join('\n');
}

export function renderVoiceHistory(history: VoiceHistoryResponse, offsetHours: number): BotEmbed {
  const days = voiceDaysRecentFirst(history.days);
  const detailed = days.map(day => [summary(day, offsetHours), ...day.segments.map(segment => segmentBlock(segment, day, offsetHours))].join('\n'));
  const compact = days.map(day => {
    // The first-arrival text already says 接上一天 for a continuation-only day.
    const qualifications = notes(day.segments).filter(note => note !== voiceFirstJoinText(day, offsetHours));
    return [summary(day, offsetHours), ...(qualifications.length > 0 ? [`说明：${qualifications.join('；')}`] : [])].join('\n');
  });
  const gaps = history.gaps.map(gap => `• ${voiceInterval(gap.from, gap.to, offsetHours)}`);
  const heading = `查询区间：${voiceHistoryPeriod(history.days)}\n时间：${boardTzLabel(offsetHours)}`;
  const body = (dayBlocks: string[], gapLines: readonly string[], warnings = true): string => [
    heading,
    dayBlocks.join('\n\n'),
    ...(gaps.length > 0 ? [
      `**未覆盖时段 · ${gaps.length} 段**`,
      ...(warnings ? [VOICE_GAP_NOTICE, VOICE_GAP_EXPLANATION] : []),
      gapLines.join('\n'),
    ] : []),
  ].filter(Boolean).join('\n\n');
  const baseFooter = `保留 ${history.retention_days} 天 · ${VOICE_MINUTE_NOTE}\n${VOICE_EMPTY_NOTICE}`;
  const title = `语音记录 · ${safeLine(history.user.username, NAME_MAX) || '未命名玩家'}`;
  const embed: BotEmbed = { title, color: gaps.length > 0 ? RED : GOLD };
  const budget = (footer: string): number => Math.min(LIMITS.embedDescription, LIMITS.embedTotal - title.length - footer.length);

  const full = body(detailed, gaps);
  if (full.length <= budget(baseFooter)) return { ...embed, description: full, footer: { text: baseFooter } };

  const segmentCount = days.reduce((total, day) => total + day.segments.length, 0);
  const omission = segmentCount > 0 ? `已省略 ${segmentCount} 条分日段明细。` : '';
  const compactFooter = [baseFooter, omission, COMPLETE].filter(Boolean).join('\n');
  const condensed = body(compact, gaps);
  if (condensed.length <= budget(compactFooter)) return { ...embed, description: condensed, footer: { text: compactFooter } };

  // The command permits 1–14 dates: all day summaries and their qualifications
  // fit before this bounded list. Keep every fixed warning outside that list.
  const finalFooter = [baseFooter, omission, ...(gaps.length > 0 ? [VOICE_GAP_NOTICE, VOICE_GAP_EXPLANATION] : []), COMPLETE]
    .filter(Boolean).join('\n');
  const prefix = body(compact, [], false);
  const visibleGaps = fitLines(gaps, budget(finalFooter) - prefix.length - 2,
    count => `另 ${count} 段未覆盖时段未展开。`);
  return { ...embed, description: `${prefix}\n\n${visibleGaps}`, footer: { text: finalFooter } };
}
