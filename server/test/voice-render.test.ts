import { describe, expect, it } from 'vitest';
import type { VoiceHistoryResponse } from '../../shared/voiceApi';
import type { VoiceDaySegment } from '../../shared/voiceDays';
import { VOICE_GAP_NOTICE, voiceDayLabel, voiceDuration, voiceSegmentNotes, voiceTime } from '../../shared/voicePresentation';
import { LIMITS } from '../src/discord/render';
import { renderVoiceHistory } from '../src/discord/voice';

const NOTICE = '这段时间机器人不在线，没有记录不代表没来。';
const FULL = '完整记录请找裁判在网页查看';
function segment(patch: Partial<VoiceDaySegment> = {}): VoiceDaySegment {
  return { channel_name: '开黑一号', joined_at: '2026-10-27 12:14:00', left_at: '2026-10-27 14:49:00',
    start_reason: 'joined', end_reason: 'left', continued: false, ...patch };
}
function history(patch: Partial<VoiceHistoryResponse> = {}): VoiceHistoryResponse {
  return { user: { id: 'private-nanako-id', username: '小明', avatar_url: null }, retention_days: 90,
    days: [{ date: '2026-10-27', first_join: '2026-10-27 12:14:00', total_min: 155, segments: [segment()] }], gaps: [], ...patch };
}
function text(value: VoiceHistoryResponse): string { return JSON.stringify(renderVoiceHistory(value, 8)); }
function limits(value: VoiceHistoryResponse): void {
  const embed = renderVoiceHistory(value, 8);
  expect(embed.title?.length ?? 0).toBeLessThanOrEqual(LIMITS.embedTitle);
  expect(embed.description?.length ?? 0).toBeLessThanOrEqual(LIMITS.embedDescription);
  expect(embed.footer?.text.length ?? 0).toBeLessThanOrEqual(LIMITS.footer);
  expect(embed.fields?.length ?? 0).toBeLessThanOrEqual(LIMITS.embedFields);
  const total = (embed.title?.length ?? 0) + (embed.description?.length ?? 0) + (embed.footer?.text.length ?? 0)
    + (embed.fields ?? []).reduce((sum, field) => sum + field.name.length + field.value.length, 0);
  expect(total).toBeLessThanOrEqual(LIMITS.embedTotal);
}

describe('shared voice presentation', () => {
  it('uses board offset and UTC weekdays, including a half-hour offset across midnight', () => {
    expect(voiceTime('2026-10-27 12:14:00', 8)).toBe('20:14');
    expect(voiceTime('2026-10-27 00:30:00', -3.5, true)).toBe('10-26 21:00');
    expect(voiceTime('2026-10-27 00:30:00', 5.5, true)).toBe('10-27 06:00');
    expect(voiceDayLabel('2026-10-27')).toBe('10-27 周二');
    expect(voiceDuration(155)).toBe('2 小时 35 分');
    expect(voiceDuration(30)).toBe('30 分'); expect(voiceDuration(0)).toBe('0 分');
    expect(VOICE_GAP_NOTICE).toBe(NOTICE);
  });
  it('retains every evidence qualification and does not claim an open row is realtime presence', () => {
    expect(voiceSegmentNotes(segment({ continued: true, start_reason: 'bot_online', end_reason: 'bot_offline' })))
      .toEqual(['接上一天', '机器人上线时已在语音里', '之后机器人离线，离开时间不确定']);
    expect(voiceSegmentNotes(segment({ left_at: null, end_reason: null }))).toEqual(['尚未记录离开', '时长按查询时刻估算']);
  });
  it('renders invalid dates as unknown instead of echoing untrusted text', () => {
    expect(voiceDayLabel('@everyone')).toBe('—');
    expect(voiceTime('<@123>', 8, true)).toBe('—');
  });
});

describe('voice history embed', () => {
  it('lists daily summaries and segments in board time', () => {
    const embed = renderVoiceHistory(history(), 8); const out = JSON.stringify(embed);
    expect(out).toContain('小明'); expect(out).toContain('10-27 周二');
    expect(out).toContain('首次 20:14'); expect(out).toContain('共 2 小时 35 分');
    expect(out).toContain('20:14–22:49'); expect(out).toContain('开黑一号');
    expect(out).toContain('北京时间'); expect(out).toContain('90 天');
    expect(out).not.toContain('private-nanako-id'); expect(out).not.toContain(FULL); limits(history());
  });
  it('keeps second-level gap boundaries visible even inside one minute', () => {
    const data = history({ gaps: [{ from: '2026-10-27 02:00:10', to: '2026-10-27 02:00:30' }] });
    expect(text(data)).toContain('10-27 10:00:10–10-27 10:00:30');
    expect(voiceTime('2026-10-27 00:30:15', -3.5, true, true)).toBe('10-26 21:00:15');
  });
  it('marks cross-midnight continuation without inventing a first join that day', () => {
    const data = history({ days: [{ date: '2026-10-27', first_join: null, total_min: 30,
      segments: [segment({ joined_at: '2026-10-26 15:30:00', left_at: '2026-10-26 16:30:00', continued: true })] }] });
    const out = text(data);
    expect(out).toContain('首次 —'); expect(out).toContain('共 30 分'); expect(out).toContain('接上一天');
    expect(out).toContain('10-26 23:30'); expect(out).toContain('00:30');
  });
  it('keeps uncertain online/offline explanations and only an estimated unclosed duration', () => {
    const closed = history(); closed.days[0].segments = [segment({ start_reason: 'bot_online', end_reason: 'bot_offline' })];
    expect(text(closed)).toContain('机器人上线时已在语音里'); expect(text(closed)).toContain('之后机器人离线，离开时间不确定');
    const open = history(); open.days[0].segments = [segment({ left_at: null, end_reason: null })];
    const out = text(open);
    expect(out.match(/尚未记录离开/g)).toHaveLength(1); expect(out).toContain('时长按查询时刻估算');
    expect(out).not.toMatch(/当前在语音里|正在语音里|确定在线/);
  });
  it('shows gaps even when the day has no records', () => {
    const data = history({ days: [{ date: '2026-10-27', first_join: null, total_min: 0, segments: [] }],
      gaps: [{ from: '2026-10-26 16:00:00', to: '2026-10-27 16:00:00' }] });
    expect(text(data)).toContain(NOTICE); expect(text(data)).toContain('共 0 分');
    expect(text(data)).toContain('10-27 00:00'); expect(text(data)).toContain('10-28 00:00');
  });
  it('escapes user/channel text and never copies private source identifiers', () => {
    const data = history(); data.user.username = '@everyone [点击](https://evil.example)\n<@123456789012345678>';
    data.days[0].segments[0].channel_name = '@here **开黑** [点击](https://evil.example)';
    Object.assign(data, { discord_user_id: '987654321987654321' });
    Object.assign(data.days[0].segments[0], { discord_user_id: '987654321987654321', channel_id: '876543219876543219' });
    const out = text(data);
    expect(out).not.toMatch(/@everyone|@here|<@|\]\(https|:\/\//);
    expect(out).not.toContain('987654321987654321'); expect(out).not.toContain('876543219876543219');
    expect(out).not.toMatch(/discord_user_id|channel_id|private-nanako-id/); limits(data);
  });
  it('preserves a legal long channel name when the full record still fits', () => {
    const data = history(); const channel = '频道'.repeat(50); data.days[0].segments[0].channel_name = channel;
    expect(renderVoiceHistory(data, 8).description).toContain(channel); limits(data);
  });
  it('drops segment detail first while retaining all daily summaries and uncertainty', () => {
    const data = history(); data.days[0].segments = Array.from({ length: 100 }, () => segment({
      channel_name: '明细频道'.repeat(40), continued: true, start_reason: 'bot_online', end_reason: 'bot_offline',
    }));
    const out = text(data);
    expect(out).not.toContain('明细频道'); expect(out).toContain('10-27 周二'); expect(out).toContain('共 2 小时 35 分');
    for (const note of ['接上一天', '机器人上线时已在语音里', '之后机器人离线，离开时间不确定']) expect(out).toContain(note);
    expect(out).toContain(FULL); limits(data);
  });
  it('still preserves warnings and qualifications when even summary/gap output requires truncation', () => {
    const data = history(); data.days = Array.from({ length: 14 }, (_, index) => ({
      date: `2026-10-${String(index + 1).padStart(2, '0')}`, first_join: null, total_min: 20,
      segments: [segment({ continued: true, start_reason: 'bot_online', end_reason: 'bot_offline' }), segment({ left_at: null, end_reason: null })],
    }));
    data.gaps = Array.from({ length: 500 }, () => ({ from: '2026-10-26 16:00:00', to: '2026-10-27 16:00:00' }));
    const out = text(data);
    for (const note of [NOTICE, FULL, '接上一天', '机器人上线时已在语音里', '之后机器人离线，离开时间不确定', '尚未记录离开', '时长按查询时刻估算']) expect(out).toContain(note);
    expect(out).toContain('省略'); limits(data);
  });
});
