import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../../src/api';
import { VoiceLog } from '../../src/components/VoiceLog';
import type { VoiceDay } from '../../shared/voiceDays';
import type { VoiceDayResponse, VoiceHistoryResponse } from '../../shared/voiceApi';
import { VOICE_EMPTY_NOTICE, VOICE_GAP_EXPLANATION, VOICE_GAP_NOTICE, VOICE_MINUTE_NOTE } from '../../shared/voicePresentation';

const PERSON = { id: 'self', username: '小明', avatar_url: null };
const SEGMENT = { channel_name: '开黑一号', joined_at: '2026-10-27 12:14:03', left_at: '2026-10-27 14:49:08',
  start_reason: 'joined' as const, end_reason: 'left' as const, continued: false };
const HISTORY: VoiceHistoryResponse = { user: PERSON, retention_days: 90, gaps: [], days: [
  { date: '2026-10-27', first_join: SEGMENT.joined_at, total_min: 155, segments: [SEGMENT] },
] };
const view = () => render(<VoiceLog ownerId="self" userId="self" offsetHours={8} />);
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.parse('2026-10-28T12:00:00Z'));
  vi.spyOn(api, 'getVoiceHistory').mockResolvedValue(HISTORY);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('voice record reading layout', () => {
  it('puts date and cumulative time before first arrival, channel and exact boundaries', async () => {
    const { container } = view();
    await screen.findByRole('heading', { name: '小明的语音记录' });
    const day = screen.getByRole('article', { name: '10-27 周二' });
    expect(day.textContent).toMatch(/10-27 周二.*累计 2小时35分钟.*首次进入 20:14:03.*开黑一号.*20:14:03 – 22:49:08/);
    expect(day.closest('details')).toBeNull();
    expect(screen.getByText(VOICE_MINUTE_NOTE)).toBeVisible();
    expect(screen.getByText('2026-10-27 — 2026-10-27')).toBeVisible();
    expect(container.querySelector('style, [style]')).toBeNull();
  });

  it('keeps every requested date, with newest days first and one empty-evidence explanation', async () => {
    const days: VoiceDay[] = [
      { date: '2026-10-25', first_join: null, total_min: 0, segments: [] },
      HISTORY.days[0],
      { date: '2026-10-26', first_join: null, total_min: 0, segments: [] },
    ];
    vi.mocked(api.getVoiceHistory).mockResolvedValue({ ...HISTORY, days });
    const { container } = view(); await screen.findByRole('heading', { name: '小明的语音记录' });
    expect(screen.getAllByRole('article').map(day => day.getAttribute('aria-label'))).toEqual(['10-27 周二', '10-26 周一', '10-25 周日']);
    expect(screen.getAllByText(VOICE_EMPTY_NOTICE)).toHaveLength(1);
    for (const date of ['10-26 周一', '10-25 周日']) {
      const day = screen.getByRole('article', { name: date });
      expect(day).toHaveClass('voice-log__day--empty');
      expect(within(day).getByText('无保存记录')).toBeVisible();
      expect(day).not.toHaveTextContent(/首次|0分钟/);
      expect(day.closest('details')).toBeNull();
    }
    expect(container.querySelectorAll('.voice-log__segments')).toHaveLength(1);
    expect(days.map(day => day.date)).toEqual(['2026-10-25', '2026-10-27', '2026-10-26']);
  });

  it('does not turn a recorded subminute visit into an empty day', async () => {
    vi.mocked(api.getVoiceHistory).mockResolvedValue({ ...HISTORY, days: [{ ...HISTORY.days[0], total_min: 0,
      segments: [{ ...SEGMENT, left_at: '2026-10-27 12:14:43' }] }] });
    view(); await screen.findByRole('heading', { name: '小明的语音记录' });
    const day = screen.getByRole('article', { name: '10-27 周二' });
    expect(day).not.toHaveClass('voice-log__day--empty');
    expect(within(day).getByText('累计 0分钟')).toBeVisible();
    expect(within(day).getByText('20:14:03 – 20:14:43')).toBeVisible();
    expect(within(day).queryByText('无保存记录')).not.toBeInTheDocument();
  });

  it('retains the previous date on continued boundaries without inventing an arrival today', async () => {
    vi.mocked(api.getVoiceHistory).mockResolvedValue({ ...HISTORY, days: [{ date: '2026-10-28', first_join: null, total_min: 30,
      segments: [{ ...SEGMENT, joined_at: '2026-10-27 15:30:12', left_at: '2026-10-27 16:30:19', continued: true,
        start_reason: 'bot_online', end_reason: 'bot_offline' }] }] });
    view(); await screen.findByRole('heading', { name: '小明的语音记录' });
    const day = screen.getByRole('article', { name: '10-28 周三' });
    expect(day).not.toHaveTextContent(/首次进入/);
    expect(within(day).getByText('10-27 23:30:12 – 00:30:19')).toBeVisible();
    expect(within(day).getAllByText('接上一天')).toHaveLength(2);
    expect(within(day).getByText('机器人上线时已在语音里')).toBeVisible();
    expect(within(day).getByText('之后机器人离线，离开时间不确定')).toBeVisible();
  });

  it('labels an open endpoint once and keeps its estimated duration qualified', async () => {
    vi.mocked(api.getVoiceHistory).mockResolvedValue({ ...HISTORY, days: [{ ...HISTORY.days[0],
      segments: [{ ...SEGMENT, left_at: null, end_reason: null }] }] });
    view(); await screen.findByRole('heading', { name: '小明的语音记录' });
    expect(screen.getAllByText(/尚未记录离开/)).toHaveLength(1);
    expect(screen.getByText('20:14:03 – 尚未记录离开')).toBeVisible();
    expect(screen.getByText('时长按查询时刻估算')).toBeVisible();
    expect(screen.queryByText('在语音里')).not.toBeInTheDocument();
  });

  it('keeps all gap warnings visible while exact boundaries use a closed native disclosure', async () => {
    const gaps = Array.from({ length: 24 }, (_, i) => ({ from: `2026-10-27 02:${String(i).padStart(2, '0')}:10`,
      to: `2026-10-27 02:${String(i).padStart(2, '0')}:30` }));
    vi.mocked(api.getVoiceHistory).mockResolvedValue({ ...HISTORY, gaps });
    const { container } = view(); await screen.findByRole('heading', { name: '小明的语音记录' });
    const note = screen.getByRole('note', { name: '未覆盖时段' });
    const heading = within(note).getByRole('heading', { name: '未覆盖时段' });
    expect(heading.parentElement?.tagName).toBe('HEADER');
    expect(within(heading.parentElement!).getByText('有 24 段未覆盖')).toBeVisible();
    expect(within(note).getByText('有 24 段未覆盖')).toBeVisible();
    expect(within(note).getByText(VOICE_GAP_NOTICE)).toBeVisible();
    expect(within(note).getByText(VOICE_GAP_EXPLANATION)).toBeVisible();
    const disclosure = within(note).getByText('查看完整未覆盖时间', { selector: 'summary' });
    expect(disclosure.closest('details')).not.toHaveAttribute('open');
    expect(within(note).getAllByRole('listitem', { hidden: true })).toHaveLength(24);
    const firstGap = within(note).getByText('10-27 10:00:10 – 10-27 10:00:30');
    expect(firstGap).not.toBeVisible();
    fireEvent.click(disclosure);
    expect(disclosure.closest('details')).toHaveAttribute('open');
    expect(firstGap).toBeVisible();
    expect(within(note).getByText('10-27 10:23:10 – 10-27 10:23:30')).toBeVisible();
    expect(container.querySelector('style, [style]')).toBeNull();
  });

  it('renders the complete long channel name as text in its own layer before the range', async () => {
    const channel = '<img src=x onerror=alert(1)>频道'.repeat(12);
    vi.mocked(api.getVoiceHistory).mockResolvedValue({ ...HISTORY, days: [{ ...HISTORY.days[0], segments: [{ ...SEGMENT, channel_name: channel }] }] });
    const { container } = view(); await screen.findByRole('heading', { name: '小明的语音记录' });
    const name = screen.getByText(channel);
    expect(name).toHaveClass('voice-log__channel');
    expect(name.nextElementSibling).toHaveTextContent('20:14:03 – 22:49:08');
    expect(container.querySelector('img, [style], style')).toBeNull();
  });

  it('preserves roster presence distinctions and seconds in a compact person summary', async () => {
    const roster: VoiceDayResponse = { date: '2026-10-28', retention_days: 90, gaps: [], users: [
      { user: PERSON, first_join: '2026-10-28 02:00:15', total_min: 60, in_voice_now: true, has_open_segment: true },
      { user: { ...PERSON, id: 'other', username: '未确认者' }, first_join: null, total_min: 15, in_voice_now: false, has_open_segment: true },
    ] };
    vi.spyOn(api, 'getVoiceDay').mockResolvedValue(roster);
    render(<VoiceLog ownerId="judge" userId={null} offsetHours={8} />);
    const person = await screen.findByRole('link', { name: /小明/ });
    expect(person.textContent).toMatch(/小明.*累计 1小时.*首次进入 10:00:15.*在语音里.*时长按查询时刻估算/);
    const uncertain = screen.getByRole('link', { name: /未确认者/ });
    expect(within(uncertain).getByText('首次进入时间未记录')).toBeVisible();
    expect(within(uncertain).queryByText('接上一天')).not.toBeInTheDocument();
    expect(within(uncertain).getByText('尚未记录离开')).toBeVisible();
    expect(within(uncertain).queryByText('在语音里')).not.toBeInTheDocument();
  });

  it('does not infer continuation from a missing first arrival in the daily roster DTO', async () => {
    vi.spyOn(api, 'getVoiceDay').mockResolvedValue({ date: '2026-10-28', retention_days: 90, gaps: [], users: [
      { user: PERSON, first_join: null, total_min: 15, in_voice_now: false, has_open_segment: false },
    ] });
    render(<VoiceLog ownerId="judge" userId={null} offsetHours={8} />);
    const person = await screen.findByRole('link', { name: /小明/ });
    expect(within(person).getByText('首次进入时间未记录')).toBeVisible();
    expect(within(person).queryByText('接上一天')).not.toBeInTheDocument();
  });
});
