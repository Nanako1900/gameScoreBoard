import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../../src/api';
import { ToolsPage } from '../../src/components/ToolsPage';
import { ToastProvider } from '../../src/components/Toast';
import { bootRouter, navigate } from '../../src/lib/router';
import type { ToolsTab } from '../../src/lib/routes';
import type { Config, PublicUser, User, UserDetailResponse } from '../../src/types';
import type { VoiceDayResponse, VoiceHistoryResponse } from '../../shared/voiceApi';

const ADMIN: User = { id: 'admin-a', username: '管理员甲', oauth_username: 'admin', avatar_url: null, score: 100,
  is_participant: false, is_judge: false, is_admin: true, created_at: '2026-10-01 00:00:00' };
const JUDGE = { ...ADMIN, id: 'judge', username: '裁判', is_admin: false, is_judge: true };
const MEMBER = { ...ADMIN, id: 'member', is_admin: false };
const PERSON: PublicUser = { id: 'visitor/a&中', username: '不上榜的账号', avatar_url: null, score: 55,
  is_participant: false, is_judge: false, created_at: '2026-10-01 00:00:00' };
const CONFIG: Config = { violations: [], tiers: [], weeklyHeal: 5, statementWindowHours: 12, aiEnabled: false,
  maxBatchSubjects: 5, nextResetAt: '2099-11-01T16:00:00Z', boardTzOffsetHours: 8 };
const detail = (user = PERSON): UserDetailResponse => ({ user, records: [], history: [] });
const ROSTER: VoiceDayResponse = { date: '2026-10-28', retention_days: 90, gaps: [], users: [
  { user: PERSON, first_join: null, total_min: 12, in_voice_now: false, has_open_segment: true },
] };
const HISTORY: VoiceHistoryResponse = { user: PERSON, retention_days: 90, gaps: [], days: [] };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
function page(tab: ToolsTab = 'home', me: User | null = ADMIN, changed = vi.fn()) {
  return <ToastProvider><ToolsPage tab={tab} me={me} config={CONFIG} participants={[]} onChanged={changed} /></ToastProvider>;
}
function address(path: string): void { window.history.replaceState(null, '', path);bootRouter(); }
beforeEach(() => {
  vi.spyOn(api, 'getAdminUsers').mockResolvedValue({ users: [{ ...PERSON, is_admin: false }], truncated: false });
  vi.spyOn(api, 'getUserDetail').mockResolvedValue(detail());
  vi.spyOn(api, 'setScore').mockResolvedValue({ ok: true });
  vi.spyOn(api, 'getVoiceDay').mockResolvedValue(ROSTER);
  vi.spyOn(api, 'getVoiceHistory').mockResolvedValue(HISTORY);
});
afterEach(() => vi.restoreAllMocks());

describe('the role-scoped tools page', () => {
  it.each([null, MEMBER])('conceals tools and does not read private data for %o', me => {
    address('/tools');render(page('home', me));
    expect(screen.getByRole('heading', { name: '这页不存在' })).toBeInTheDocument();
    expect(api.getAdminUsers).not.toHaveBeenCalled();expect(api.getVoiceDay).not.toHaveBeenCalled();
  });
  it('gives judges filing and voice tools, while score remains administrator-only', () => {
    address('/tools');const view = render(page('home', JUDGE));
    expect(screen.getByRole('link', { name: /记一笔/ })).toHaveAttribute('href', '/tools/filing');
    expect(screen.getByRole('link', { name: /语音记录/ })).toHaveAttribute('href', '/tools/voice');
    expect(screen.queryByRole('link', { name: /人工调分/ })).not.toBeInTheDocument();
    view.rerender(page('score', JUDGE));expect(screen.getByRole('heading', { name: '这页不存在' })).toBeInTheDocument();
    expect(api.getAdminUsers).not.toHaveBeenCalled();expect(api.getUserDetail).not.toHaveBeenCalled();
  });
  it('adds administrator score and appeal destinations without duplicating settings', () => {
    address('/tools');render(page());
    expect(screen.getByRole('link', { name: /人工调分/ })).toHaveAttribute('href', '/tools/score');
    expect(screen.getByRole('link', { name: /申诉复核/ })).toHaveAttribute('href', '/cases');
    expect(screen.queryByRole('link', { name: /AI|成员与权限/ })).not.toBeInTheDocument();
  });
  it('leaves the authorized filing surface to the persistent app controller', () => {
    address('/tools/filing');const { container } = render(page('filing'));expect(container.textContent).toBe('');
  });
  it('uses the existing voice reads and new subject links without changing evidence interpretation', async () => {
    address('/tools/voice');render(page('voice', JUDGE));
    const link = await screen.findByRole('link', { name: /不上榜的账号/ });
    expect(link).toHaveAttribute('href', '/tools/voice?user=visitor%2Fa%26%E4%B8%AD');
    expect(screen.getByText('尚未记录离开')).toBeInTheDocument();
    expect(screen.queryByText('在语音里')).not.toBeInTheDocument();expect(api.getVoiceDay).toHaveBeenCalledOnce();
  });
  it('reads a query-selected voice history and preserves old management query compatibility', async () => {
    address('/admin/voice?user=visitor%2Fa%26%E4%B8%AD');render(page('voice', JUDGE));
    await screen.findByRole('heading', { name: '不上榜的账号的语音记录' });
    expect(api.getVoiceHistory).toHaveBeenCalledWith(PERSON.id, expect.any(String), expect.any(String));
    expect(api.getVoiceDay).not.toHaveBeenCalled();
  });
  it('puts the personal-history day destination in the header and switches back to the daily roster', async () => {
    address('/tools/voice?user=visitor%2Fa%26%E4%B8%AD');render(page('voice', JUDGE));
    await screen.findByRole('heading', { name: '不上榜的账号的语音记录' });
    const header = screen.getByRole('heading', { name: '语音记录', level: 2 }).closest('header')!;
    const dayLink = within(header).getByRole('link', { name: '按日汇总' });
    expect(dayLink).toHaveAttribute('href', '/tools/voice');
    expect(dayLink).toHaveClass('tools-page__back');
    expect(screen.queryByRole('link', { name: '返回裁判工具' })).not.toBeInTheDocument();
    expect(screen.queryByText('按日查看进入过语音的成员，或打开某位成员的分日明细。')).not.toBeInTheDocument();
    await userEvent.setup().click(dayLink);
    expect(await screen.findByRole('heading', { name: '当天语音记录' })).toBeInTheDocument();
    expect(api.getVoiceDay).toHaveBeenCalledOnce();
    expect(within(header).getByRole('link', { name: '返回裁判工具' })).toHaveAttribute('href', '/tools');
  });
  it('keeps the daily-roster return destination in the header without the redundant introduction', async () => {
    address('/tools/voice');render(page('voice', JUDGE));
    await screen.findByRole('heading', { name: '当天语音记录' });
    const header = screen.getByRole('heading', { name: '语音记录', level: 2 }).closest('header')!;
    expect(within(header).getByRole('link', { name: '返回裁判工具' })).toHaveAttribute('href', '/tools');
    expect(screen.queryByRole('link', { name: '按日汇总' })).not.toBeInTheDocument();
    expect(screen.queryByText('按日查看进入过语音的成员，或打开某位成员的分日明细。')).not.toBeInTheDocument();
  });
  it.each(['voice', 'score'] as const)('rejects an empty or invalid %s subject without a read', tab => {
    address(`/tools/${tab}?user=`);render(page(tab));
    expect(screen.getByRole('heading', { name: '这页不存在' })).toBeInTheDocument();
    expect(api.getVoiceHistory).not.toHaveBeenCalled();expect(api.getUserDetail).not.toHaveBeenCalled();
  });
});

describe('manual score correction', () => {
  it('chooses among all accounts, including unlisted accounts, and labels a truncated search scope', async () => {
    vi.mocked(api.getAdminUsers).mockResolvedValue({ users: [{ ...PERSON, is_admin: false }], truncated: true });
    address('/tools/score');render(page('score'));
    expect(await screen.findByRole('link', { name: /不上榜的账号/ })).toHaveAttribute('href', '/tools/score?user=visitor%2Fa%26%E4%B8%AD');
    expect(screen.getByText(/最新 500/)).toBeInTheDocument();
    await userEvent.setup().type(screen.getByRole('searchbox'), '不存在');expect(screen.getByText('没有匹配的账号')).toBeInTheDocument();
  });
  it('directly resolves a selected unlisted account and keeps the existing two-step zero-score flow', async () => {
    address('/tools/score?user=visitor%2Fa%26%E4%B8%AD');const changed = vi.fn();render(page('score', ADMIN, changed));
    const input = await screen.findByRole('spinbutton', { name: '调整分数' });
    expect(api.getUserDetail).toHaveBeenCalledWith(PERSON.id);expect(api.getAdminUsers).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '0' } });await userEvent.setup().click(screen.getByRole('button', { name: '改分' }));
    expect(api.setScore).not.toHaveBeenCalled();expect(screen.getByRole('group', { name: '确认调整分数' })).toHaveTextContent('55');
    vi.mocked(api.getUserDetail).mockResolvedValue(detail({ ...PERSON, score: 0 }));
    await userEvent.setup().click(screen.getByRole('button', { name: '确认改分' }));
    await waitFor(() => expect(changed).toHaveBeenCalledOnce());expect(api.setScore).toHaveBeenCalledExactlyOnceWith(PERSON.id, 0);
    expect(await screen.findByRole('spinbutton', { name: '调整分数' })).toHaveValue(0);
  });
  it('shows a write failure without losing the chosen score', async () => {
    vi.mocked(api.setScore).mockRejectedValue(new api.ApiError('操作冲突，请重试', 409));
    address('/tools/score?user=visitor%2Fa%26%E4%B8%AD');render(page('score'));
    const input = await screen.findByRole('spinbutton', { name: '调整分数' });fireEvent.change(input, { target: { value: '70' } });
    const user = userEvent.setup();await user.click(screen.getByRole('button', { name: '改分' }));await user.click(screen.getByRole('button', { name: '确认改分' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('操作冲突');expect(screen.getByRole('spinbutton')).toHaveValue(70);
  });
  it('distinguishes a successful write from a failed status refresh', async () => {
    address('/tools/score?user=visitor%2Fa%26%E4%B8%AD');const changed = vi.fn();render(page('score', ADMIN, changed));
    const input = await screen.findByRole('spinbutton', { name: '调整分数' });fireEvent.change(input, { target: { value: '75' } });
    vi.mocked(api.getUserDetail).mockRejectedValue(new api.ApiError('暂时不可读', 503));
    const user = userEvent.setup();await user.click(screen.getByRole('button', { name: '改分' }));await user.click(screen.getByRole('button', { name: '确认改分' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('修改已保存');expect(changed).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: '确认改分' })).not.toBeInTheDocument();
  });
  it('conceals old values before a new actor read and ignores a late old write', async () => {
    const pending = deferred<{ ok: boolean }>();vi.mocked(api.setScore).mockReturnValue(pending.promise);
    address('/tools/score?user=visitor%2Fa%26%E4%B8%AD');const changed = vi.fn();const view = render(page('score', ADMIN, changed));
    const input = await screen.findByRole('spinbutton', { name: '调整分数' });fireEvent.change(input, { target: { value: '70' } });
    const user = userEvent.setup();await user.click(screen.getByRole('button', { name: '改分' }));await user.click(screen.getByRole('button', { name: '确认改分' }));
    const next = deferred<UserDetailResponse>();vi.mocked(api.getUserDetail).mockReturnValue(next.promise);
    view.rerender(page('score', { ...ADMIN, id: 'admin-b' }, changed));expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    const reads = vi.mocked(api.getUserDetail).mock.calls.length;await act(async () => pending.resolve({ ok: true }));
    expect(changed).not.toHaveBeenCalled();expect(api.getUserDetail).toHaveBeenCalledTimes(reads);
    await act(async () => next.resolve(detail({ ...PERSON, score: 80 })));expect(await screen.findByRole('spinbutton')).toHaveValue(80);
  });
  it('turns permission failures into a private 404 and removes an outstanding leave confirmation', async () => {
    address('/tools/score?user=visitor%2Fa%26%E4%B8%AD');render(page('score'));
    const input = await screen.findByRole('spinbutton');fireEvent.change(input, { target: { value: '70' } });
    act(() => navigate('/tools'));expect(screen.getByRole('group', { name: '还有未保存的修改' })).toBeInTheDocument();
    vi.mocked(api.setScore).mockRejectedValue(new api.ApiError('无权限', 403));
    const user = userEvent.setup();await user.click(screen.getByRole('button', { name: '继续编辑' }));
    await user.click(screen.getByRole('button', { name: '改分' }));await user.click(screen.getByRole('button', { name: '确认改分' }));
    expect(await screen.findByRole('heading', { name: '这页不存在' })).toBeInTheDocument();expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });
});
