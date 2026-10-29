import { describe, expect, it } from 'vitest';
import type { VoiceHistoryResponse } from '../../shared/voiceApi';
import type { VoiceDaySegment } from '../../shared/voiceDays';
import { VOICE_EMPTY_NOTICE, VOICE_MINUTE_NOTE, VOICE_GAP_EXPLANATION, voiceInterval, VOICE_GAP_NOTICE, voiceDayLabel, voiceDuration, voiceSegmentNotes, voiceTime } from '../../shared/voicePresentation';
import { LIMITS } from '../src/discord/render';
import { renderVoiceHistory } from '../src/discord/voice';

const NOTICE = '这些时段没有完整记录，没有记录不代表没来。';
const EXPLANATION = '未覆盖表示缺少完整证据，也可能来自记录清理或尚未持久化的心跳尾段。';
const FULL = '完整记录请在网页查看';
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
    expect(voiceDuration(155)).toBe('2小时35分钟');
    expect(voiceDuration(30)).toBe('30分钟'); expect(voiceDuration(0)).toBe('0分钟');
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
    expect(out).toContain('首次进入 20:14:00'); expect(out).toContain('累计 2小时35分钟');
    expect(out).toContain('20:14:00 – 22:49:00'); expect(out).toContain('开黑一号');
    expect(out).toContain('北京时间'); expect(out).toContain('90 天');
    expect(out).not.toContain('private-nanako-id'); expect(out).not.toContain(FULL); limits(history());
  });
  it('separates period, newest-first day headings, summary, channel and second-precise interval', () => {
    const data = history({ days: [
      { date: '2025-12-31', first_join: null, total_min: 0, segments: [] },
      { date: '2026-01-01', first_join: '2026-01-01 12:14:10', total_min: 155,
        segments: [segment({ joined_at: '2026-01-01 12:14:10', left_at: '2026-01-01 14:49:30' })] },
    ] });
    const before = JSON.stringify(data);const embed = renderVoiceHistory(data, 8);const body = embed.description ?? '';
    expect(body).toMatch(/^查询区间：2025-12-31 — 2026-01-01\n时间：北京时间/);
    expect(body.indexOf('**01-01 周四**')).toBeLessThan(body.indexOf('**12-31 周三**'));
    expect(body).toContain('**01-01 周四**\n累计 2小时35分钟 · 首次进入 20:14:10\n• 开黑一号\n  20:14:10 – 22:49:30');
    expect(embed.footer?.text).toContain(VOICE_MINUTE_NOTE);
    expect(embed.footer?.text).toContain(VOICE_EMPTY_NOTICE);
    expect(JSON.stringify(data)).toBe(before);limits(data);
  });

  it.each([false, true])('keeps a real sub-minute segment distinct from an empty day, open=%s', (open) => {
    const data = history({ days: [{ date: '2026-10-27', first_join: '2026-10-27 12:14:10', total_min: 0,
      segments: [segment({ joined_at: '2026-10-27 12:14:10', left_at: open ? null : '2026-10-27 12:14:30', end_reason: open ? null : 'left' })] }] });
    const body = renderVoiceHistory(data, 8).description ?? '';
    expect(body).toContain('累计 0分钟 · 首次进入 20:14:10');
    expect(body).toContain('• 开黑一号\n  20:14:10 – ' + (open ? '尚未记录离开' : '20:14:30'));
    expect(body).not.toContain('无保存记录');
    if (open) expect(body).toContain('时长按查询时刻估算');
    limits(data);
  });

  it('keeps every empty date brief without inventing zero-minute visits or arrival times', () => {
    const data = history({ days: [27, 28, 29].map(date => ({ date: `2026-10-${date}`, first_join: null, total_min: 0, segments: [] })) });
    const embed = renderVoiceHistory(data, 8);const body = embed.description ?? '';
    for (const date of data.days) expect(body).toContain('**' + voiceDayLabel(date.date) + '**\n无保存记录');
    expect(body).not.toMatch(/累计 0分钟|首次进入/);
    expect(embed.footer?.text).toContain(VOICE_EMPTY_NOTICE);limits(data);
  });

  it('uses unknown-first-arrival text for a noncontinued record with no recorded first join', () => {
    const data = history();data.days[0].first_join = null;
    expect(renderVoiceHistory(data, 8).description).toContain('首次进入时间未记录');
    expect(renderVoiceHistory(data, 8).description).not.toContain('接上一天');
  });

  it('keeps second-level gap boundaries visible even inside one minute', () => {
    const data = history({ gaps: [{ from: '2026-10-27 02:00:10', to: '2026-10-27 02:00:30' }] });
    expect(text(data)).toContain('10-27 10:00:10 – 10-27 10:00:30');
    expect(voiceTime('2026-10-27 00:30:15', -3.5, true, true)).toBe('10-26 21:00:15');
  });
  it('marks cross-midnight continuation without inventing a first join that day', () => {
    const data = history({ days: [{ date: '2026-10-27', first_join: null, total_min: 30,
      segments: [segment({ joined_at: '2026-10-26 15:30:00', left_at: '2026-10-26 16:30:00', continued: true })] }] });
    const out = text(data);
    expect(out).not.toContain('首次进入 23:30'); expect(out).toContain('累计 30分钟'); expect(out).toContain('接上一天');
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
    expect(text(data)).toContain(NOTICE); expect(text(data)).toContain(VOICE_EMPTY_NOTICE);
    expect(text(data)).toContain('无保存记录');
    expect(renderVoiceHistory(data, 8).description).toContain(EXPLANATION);
    expect(text(data)).toContain('10-27 00:00'); expect(text(data)).toContain('10-28 00:00');
  });
  it('escapes user/channel text and never copies private source identifiers', () => {
    const data = history(); data.user.username = '@everyone [点击](https://evil.example)\n<@123456789012345678>';
    data.days[0].segments[0].channel_name = '@here **开黑** [点击](https://evil.example)\n**伪造日期**';
    Object.assign(data, { discord_user_id: '987654321987654321' });
    Object.assign(data.days[0].segments[0], { discord_user_id: '987654321987654321', channel_id: '876543219876543219' });
    const out = text(data);
    expect(out).not.toMatch(/@everyone|@here|<@|\]\(https|:\/\//);
    expect(renderVoiceHistory(data, 8).title).not.toContain('\n');
    expect(renderVoiceHistory(data, 8).description).not.toContain('\n**伪造日期**');
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
    data.gaps = [{ from: '2026-10-27 02:00:10', to: '2026-10-27 02:00:30' }];
    const out = text(data);
    expect(renderVoiceHistory(data, 8).description).toContain(EXPLANATION);
    expect(out).not.toContain('明细频道'); expect(out).toContain('10-27 周二'); expect(out).toContain('累计 2小时35分钟');
    for (const note of ['接上一天', '机器人上线时已在语音里', '之后机器人离线，离开时间不确定']) expect(out).toContain(note);
    expect(out).toContain(FULL);
    expect(renderVoiceHistory(data, 8).footer?.text).toContain('已省略 100 条分日段明细。');
    limits(data);
  });
  it('retains every date and exact gap-omission count when the gap list alone exceeds the budget', () => {
    const data = history({ days: Array.from({ length: 14 }, (_, index) => ({
      date: `2026-10-${String(index + 1).padStart(2, '0')}`, first_join: null, total_min: index === 0 ? 0 : 20,
      segments: index === 0 ? [] : [segment({ continued: true, start_reason: 'bot_online', end_reason: 'bot_offline' }), segment({ left_at: null, end_reason: null })],
    })), gaps: Array.from({ length: 500 }, (_, index) => {
      const from = new Date(Date.parse('2026-10-27T00:00:00Z') + index * 2_000).toISOString().slice(0, 19).replace('T', ' ');
      const to = new Date(Date.parse('2026-10-27T00:00:01Z') + index * 2_000).toISOString().slice(0, 19).replace('T', ' ');
      return { from, to };
    }) });
    const embed = renderVoiceHistory(data, 8);const body = embed.description ?? '';
    for (const day of data.days) expect(body).toContain('**' + voiceDayLabel(day.date) + '**');
    expect(embed.footer?.text).toContain('已省略 26 条分日段明细。');
    const shown = body.split('\n').filter(line => /^• \d{2}-\d{2} /.test(line));
    const omitted = Number(/另 (\d+) 段未覆盖时段未展开/.exec(body)?.[1]);
    expect(shown.length).toBeGreaterThan(0);expect(omitted).toBeGreaterThan(0);
    expect(shown.length + omitted).toBe(data.gaps.length);
    expect(shown).toEqual(data.gaps.slice(0, shown.length).map(gap => '• ' + voiceInterval(gap.from, gap.to, 8)));
    for (const fixed of [VOICE_EMPTY_NOTICE, VOICE_MINUTE_NOTE, VOICE_GAP_NOTICE, VOICE_GAP_EXPLANATION,
      '接上一天', '机器人上线时已在语音里', '之后机器人离线，离开时间不确定', '尚未记录离开', '时长按查询时刻估算', FULL]) expect(text(data)).toContain(fixed);
    expect(body).not.toMatch(/其余 \d+ 行|已覆盖|无其他/);limits(data);
  });

  it('still preserves warnings and qualifications when even summary/gap output requires truncation', () => {
    const data = history(); data.days = Array.from({ length: 14 }, (_, index) => ({
      date: `2026-10-${String(index + 1).padStart(2, '0')}`, first_join: null, total_min: 20,
      segments: [segment({ continued: true, start_reason: 'bot_online', end_reason: 'bot_offline' }), segment({ left_at: null, end_reason: null })],
    }));
    data.gaps = Array.from({ length: 500 }, () => ({ from: '2026-10-26 16:00:00', to: '2026-10-27 16:00:00' }));
    const out = text(data);
    for (const note of [NOTICE, FULL, '接上一天', '机器人上线时已在语音里', '之后机器人离线，离开时间不确定', '尚未记录离开', '时长按查询时刻估算']) expect(out).toContain(note);
    expect(renderVoiceHistory(data, 8).footer?.text).toContain(EXPLANATION);
    expect(out).toMatch(/另 \d+ 段未覆盖时段未展开/); limits(data);
  });
});
