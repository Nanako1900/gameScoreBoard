import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { AdminPage } from '../../src/components/AdminPage';
import { VoiceLog } from '../../src/components/VoiceLog';
import { getVoiceDay, getVoiceHistory } from '../../src/api';
import { firstAvailableVoiceDate } from '../../shared/voiceDays';
import { VOICE_GAP_NOTICE } from '../../shared/voicePresentation';
import type { VoiceDayResponse, VoiceHistoryResponse } from '../../shared/voiceApi';
import type { User } from '../../src/types';
import { useDesktopViewport } from './viewport';

const NOW = Date.parse('2026-10-27T20:15:20Z');
const NOW_SQL = '2026-10-27 20:15:20';
const TODAY = '2026-10-28';
const JUDGE: User = { id: 'judge', username: '裁判', oauth_username: '裁判', avatar_url: null, is_judge: true,
  is_admin: false, is_participant: false, score: 100, created_at: '2026-10-01 00:00:00' };
const PERSON = { id: 'a/b', username: '甲', avatar_url: null };
const GAP = { from: '2026-10-27 20:15:00', to: NOW_SQL };
const ROSTER: VoiceDayResponse = { date: TODAY, retention_days: 90, gaps: [GAP], users: [
  { user: PERSON, first_join: '2026-10-27 20:00:00', total_min: 15, in_voice_now: true, has_open_segment: true },
  { user: { ...PERSON, id: 'b', username: '乙' }, first_join: null, total_min: 30, in_voice_now: false, has_open_segment: true },
] };
const segment = { channel_name: '开黑一号', joined_at: '2026-10-27 15:30:00', left_at: '2026-10-27 16:30:00',
  start_reason: 'bot_online' as const, end_reason: 'bot_offline' as const };
const HISTORY: VoiceHistoryResponse = { user: PERSON, retention_days: 90, gaps: [GAP], days: [
  { date: '2026-10-27', first_join: segment.joined_at, total_min: 30, segments: [{ ...segment, continued: false }] },
  { date: TODAY, first_join: null, total_min: 30, segments: [{ ...segment, continued: true }] },
] };
function json(status: number, data: unknown): Response { return { ok: status >= 200 && status < 300, status,
  text: async () => JSON.stringify(data) } as Response; }
function frozen(): void { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); }
function stubApp(me: User | null = JUDGE, voice: (path: string) => Response | Promise<Response> = (path) => json(200, path.startsWith('/api/voice/day') ? ROSTER : HISTORY)) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const path = String(input); calls.push(path);
    if (path.startsWith('/api/voice')) return Promise.resolve(voice(path));
    if (path === '/api/config') return Promise.resolve(json(200, { violations: [], tiers: [], weeklyHeal: 5, statementWindowHours: 12,
      aiEnabled: false, maxBatchSubjects: 5, nextResetAt: '2099-11-01T16:00:00Z', boardTzOffsetHours: 8 }));
    if (path === '/api/me') return Promise.resolve(json(200, { user: me, pending: { statements: 0, appeals: 0 } }));
    if (path === '/api/leaderboard') return Promise.resolve(json(200, { participants: [] }));
    if (path.startsWith('/api/records')) return Promise.resolve(json(200, { records: [] }));
    if (path === '/api/report/latest') return Promise.resolve(json(200, { report: null }));
    return Promise.resolve(json(404, {}));
  }));
  return calls;
}
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('voice API client', () => {
  it('sends encoded same-origin read queries using public DTO envelopes', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json(200, HISTORY)); vi.stubGlobal('fetch', fetch);
    await getVoiceHistory('a/b 甲', '2026-10-22', TODAY);
    await getVoiceDay(TODAY);
    expect(fetch.mock.calls[0][0]).toBe('/api/voice?user=a%2Fb+%E7%94%B2&from=2026-10-22&to=2026-10-28');
    expect(fetch.mock.calls[1][0]).toBe('/api/voice/day?date=2026-10-28');
  });
});

describe('voice management page', () => {
  it.each([null, { ...JUDGE, is_judge: false }])('shows NotFound to an unauthorized viewer without issuing voice reads: %o', async (me) => {
    const calls = stubApp(me); window.history.replaceState(null, '', '/admin/voice'); render(<App />);
    expect(await screen.findByRole('heading', { name: '这页不存在' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '管理' })).not.toBeInTheDocument();
    expect(calls.filter((path) => path.startsWith('/api/voice'))).toEqual([]);
  });
  it.each([false, true])('shows the board-date roster in a full page, desktop=%s', async (desktop) => {
    frozen(); if (desktop) useDesktopViewport();
    const calls = stubApp(); window.history.replaceState(null, '', '/admin'); const { container } = render(<App />);
    await screen.findByRole('link', { name: /甲/ });
    expect(screen.getByRole('heading', { name: '语音记录', level: 2 })).toHaveFocus();
    expect(screen.getByRole('link', { name: '返回裁判工具' })).toHaveAttribute('href', '/tools');
    expect(screen.queryByRole('navigation', { name: '管理' })).not.toBeInTheDocument();
    expect(document.querySelector('.app__main')).toHaveAttribute('hidden');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('日期')).toHaveValue(TODAY);
    expect(screen.getByLabelText('日期')).toHaveAttribute('min', firstAvailableVoiceDate(NOW_SQL, 8));
    expect(calls).toContain('/api/voice/day?date=2026-10-28');
    expect(screen.getByText('首次 04:00')).toBeInTheDocument();
    expect(screen.getByText('在语音里')).toBeInTheDocument();
    expect(screen.getByText('尚未记录离开')).toBeInTheDocument();
    expect(screen.getAllByText('时长按查询时刻估算')).toHaveLength(2);
    expect(screen.getByText(VOICE_GAP_NOTICE)).toBeInTheDocument();
    expect(within(screen.getByRole('note', { name: '未覆盖时段' })).getByText('未覆盖表示缺少完整证据，也可能来自记录清理或尚未持久化的心跳尾段。')).toBeInTheDocument();
    expect(screen.getByText('10-28 04:15:00 – 10-28 04:15:20')).toBeInTheDocument();
    expect(container.querySelector('.tools-page [style], .tools-page style')).toBeNull();
  });
  it('pushes a selected person into the URL and fetches their default seven-day history', async () => {
    frozen(); const calls = stubApp(); window.history.replaceState(null, '', '/admin/voice'); render(<App />);
    await userEvent.setup().click(await screen.findByRole('link', { name: /甲/ }));
    expect(new URLSearchParams(window.location.search).get('user')).toBe(PERSON.id);
    expect(await screen.findByRole('heading', { name: '甲的语音记录' })).toBeInTheDocument();
    expect(calls).toContain('/api/voice?user=a%2Fb&from=2026-10-22&to=2026-10-28');
    expect(screen.getByText('接上一天')).toBeInTheDocument();
    expect(screen.getAllByText('机器人上线时已在语音里')).toHaveLength(2);
    expect(screen.getAllByText('之后机器人离线，离开时间不确定')).toHaveLength(2);
  });
  it('changes date and range through user actions without a polling loop', async () => {
    frozen(); const calls = stubApp(); window.history.replaceState(null, '', '/admin/voice'); render(<App />);
    fireEvent.change(await screen.findByLabelText('日期'), { target: { value: '2026-10-27' } });
    await waitFor(() => expect(calls).toContain('/api/voice/day?date=2026-10-27'));
    expect(await screen.findAllByText('时长按查询时刻估算')).toHaveLength(2);
    await userEvent.setup().click(await screen.findByRole('link', { name: /甲/ }));
    const range = await screen.findByRole('combobox', { name: '查询范围' });
    await userEvent.setup().selectOptions(range, '14');
    await waitFor(() => expect(calls).toContain('/api/voice?user=a%2Fb&from=2026-10-15&to=2026-10-28'));
    await userEvent.setup().selectOptions(range, '31');
    await waitFor(() => expect(calls).toContain('/api/voice?user=a%2Fb&from=2026-09-28&to=2026-10-28'));
    await act(async () => { await Promise.resolve(); });
    expect(calls.filter((path) => path.startsWith('/api/voice'))).toHaveLength(5);
  });
  it('keeps an empty day distinct from a continued session and never treats no records as absence', async () => {
    frozen(); const empty = { ...HISTORY, days: [{ date: TODAY, first_join: null, total_min: 0, segments: [] }] };
    stubApp(JUDGE, () => json(200, empty)); window.history.replaceState(null, '', '/admin/voice?user=a%2Fb'); render(<App />);
    expect(await screen.findByText('没有保存的语音记录，不代表没来')).toBeInTheDocument();
    expect(screen.queryByText('接上一天')).not.toBeInTheDocument();
    expect(screen.getByText(VOICE_GAP_NOTICE)).toBeInTheDocument();
  });
  it('describes an unclosed history segment as unconfirmed, with escaped channel names', async () => {
    frozen(); const name = '<img src=x onerror=alert(1)>';
    const history = { ...HISTORY, days: [{ date: TODAY, first_join: '2026-10-27 20:00:00', total_min: 15,
      segments: [{ ...segment, channel_name: name, left_at: null, end_reason: null, continued: false }] }] };
    stubApp(JUDGE, () => json(200, history)); window.history.replaceState(null, '', '/admin/voice?user=a%2Fb'); render(<App />);
    expect(await screen.findByText('尚未记录离开')).toBeInTheDocument();
    expect(screen.getByText('时长按查询时刻估算')).toBeInTheDocument();
    expect(screen.queryByText('在语音里')).not.toBeInTheDocument();
    expect(screen.getByText(name)).toBeInTheDocument(); expect(document.querySelector('.tools-page img')).toBeNull();
  });
  it.each(['/admin/voice', '/admin/voice?user=a%2Fb'])('silently replaces unsupported reads with NotFound: %s', async (path) => {
    frozen(); stubApp(JUDGE, () => json(404, { error: 'Not found' })); window.history.replaceState(null, '', path); render(<App />);
    expect(await screen.findByRole('heading', { name: '这页不存在' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: '查询范围' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('日期')).not.toBeInTheDocument();
  });
  it('keeps a missing daily roster visibly uncertain when coverage is missing', async () => {
    frozen(); stubApp(JUDGE, () => json(200, { ...ROSTER, users: [] }));
    window.history.replaceState(null, '', '/admin/voice'); render(<App />);
    expect(await screen.findByText('没有保存的语音记录，不代表没来')).toBeInTheDocument();
    expect(screen.getByText(VOICE_GAP_NOTICE)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /甲/ })).not.toBeInTheDocument();
  });
  it('removes private results immediately when the current account loses its management role', async () => {
    frozen(); const next = deferred(); vi.stubGlobal('fetch', vi.fn(() => next.promise));
    const config = { boardTzOffsetHours: 8 } as import('../../src/types').Config;
    const view = render(<AdminPage me={JUDGE} config={config} />);
    view.rerender(<AdminPage me={{ ...JUDGE, is_judge: false }} config={config} />);
    await act(async () => next.resolve(json(200, ROSTER)));
    expect(screen.getByRole('heading', { name: '这页不存在' })).toBeInTheDocument();
    expect(screen.queryByText('甲')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '管理' })).not.toBeInTheDocument();
  });
  it('shows an ordinary read failure with retry instead of retaining private results', async () => {
    frozen(); let reads = 0;
    stubApp(JUDGE, () => ++reads === 1 ? json(503, { error: '维护中' }) : json(200, ROSTER));
    window.history.replaceState(null, '', '/admin/voice'); render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('维护中');
    await userEvent.setup().click(screen.getByRole('button', { name: '重新读取' }));
    expect(await screen.findByRole('link', { name: /甲/ })).toBeInTheDocument();
  });
});

describe('voice evidence response isolation', () => {
  it('does not let a late result for the previous person replace the current one', async () => {
    frozen(); const old = deferred();
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => String(input).includes('user=old') ? old.promise
      : Promise.resolve(json(200, { ...HISTORY, user: { ...PERSON, username: '新对象' } }))));
    const view = render(<VoiceLog ownerId="judge" userId="old" offsetHours={8} />);
    view.rerender(<VoiceLog ownerId="judge" userId="new" offsetHours={8} />);
    expect(await screen.findByRole('heading', { name: '新对象的语音记录' })).toBeInTheDocument();
    await act(async () => old.resolve(json(200, { ...HISTORY, user: { ...PERSON, username: '旧对象' } })));
    expect(screen.queryByText(/旧对象/)).not.toBeInTheDocument();
  });
  it('conceals a prior date roster before the next date response arrives', async () => {
    frozen(); let reads = 0; const next = deferred();
    vi.stubGlobal('fetch', vi.fn(() => ++reads === 1 ? Promise.resolve(json(200, ROSTER)) : next.promise));
    render(<VoiceLog ownerId="judge" userId={null} offsetHours={8} />);
    await screen.findByRole('link', { name: /甲/ });
    fireEvent.change(screen.getByLabelText('日期'), { target: { value: '2026-10-27' } });
    expect(screen.queryByRole('link', { name: /甲/ })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('正在读取语音记录');
  });
  it.each(['owner', 'person', 'range'] as const)('conceals the old evidence immediately when %s changes', async (change) => {
    frozen(); let reads = 0; const next = deferred();
    vi.stubGlobal('fetch', vi.fn(() => ++reads === 1 ? Promise.resolve(json(200, HISTORY)) : next.promise));
    const view = render(<VoiceLog ownerId="judge-a" userId="a" offsetHours={8} />);
    await screen.findByRole('heading', { name: '甲的语音记录' });
    if (change === 'range') await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: '查询范围' }), '14');
    else view.rerender(<VoiceLog ownerId={change === 'owner' ? 'judge-b' : 'judge-a'} userId={change === 'person' ? 'b' : 'a'} offsetHours={8} />);
    expect(screen.queryByText('开黑一号')).not.toBeInTheDocument();
    expect(screen.queryByText(VOICE_GAP_NOTICE)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('正在读取语音记录');
  });
});
