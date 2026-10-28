import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../../src/api';
import { AdminPage } from '../../src/components/AdminPage';
import { MemberList } from '../../src/components/MemberList';
import { ToastProvider } from '../../src/components/Toast';
import type { AdminUserRow, AdminUsersResponse, Config, User } from '../../src/types';

const ADMIN: User = { id: 'admin', username: '管理员甲', oauth_username: 'admin', avatar_url: null,
  is_admin: true, is_judge: true, is_participant: false, score: 100, created_at: '2026-10-01 00:00:00' };
const CONFIG = { boardTzOffsetHours: 8 } as Config;
const PEOPLE: AdminUserRow[] = [
  { id: 'visitor/a', username: 'Alice游客', avatar_url: 'https://images.example/a.png', is_participant: false,
    is_judge: false, is_admin: false, score: 55, created_at: '2026-10-26 23:30:00' },
  { id: 'judge', username: '裁判乙', avatar_url: null, is_participant: true,
    is_judge: true, is_admin: false, score: 80, created_at: '2026-10-01 00:00:00' },
  { id: ADMIN.id, username: ADMIN.username, avatar_url: null, is_participant: false,
    is_judge: true, is_admin: true, score: 100, created_at: ADMIN.created_at },
];
const listing = (users = PEOPLE, truncated = false): AdminUsersResponse => ({ users, truncated });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
const row = (name: string) => screen.getByRole('listitem', { name: `${name}的账号` });
function legacyPage(me: User | null = ADMIN, onChanged = vi.fn(), tab: 'members' | 'voice' = 'members') {
  return <ToastProvider><AdminPage me={me} config={CONFIG} tab={tab} onChanged={onChanged} /></ToastProvider>;
}
// Inline score compatibility belongs to the reusable list; the page links to the shared tool.
function page(me: User | null = ADMIN, onChanged = vi.fn(), tab: 'members' | 'voice' = 'members') {
  return me?.is_admin && tab === 'members'
    ? <ToastProvider><MemberList key={me.id} ownerId={me.id} offsetHours={CONFIG.boardTzOffsetHours} onChanged={onChanged} /></ToastProvider>
    : legacyPage(me, onChanged, tab);
}
const toastText = () => document.querySelector('.toasts')?.textContent ?? '';
beforeEach(() => {
  vi.spyOn(api, 'getAdminUsers').mockResolvedValue(listing());
  vi.spyOn(api, 'setJudge').mockResolvedValue({ ok: true });
  vi.spyOn(api, 'setScore').mockResolvedValue({ ok: true });
  vi.spyOn(api, 'getVoiceDay').mockResolvedValue({ date: '2026-10-27', users: [], gaps: [], retention_days: 90 });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('member management list', () => {
  it('shows unlisted accounts, role badges, plain scores and board-time registration dates without inline styles', async () => {
    const { container } = render(page()); await screen.findByText('Alice游客');
    expect(within(row('Alice游客')).getByText('55')).toBeInTheDocument();
    expect(within(row('Alice游客')).getByText('2026-10-27 07:30')).toHaveAttribute('datetime', '2026-10-26T23:30:00.000Z');
    expect(within(row('裁判乙')).getByText('上榜')).toBeInTheDocument();
    expect(within(row('裁判乙')).getByText('裁判')).toBeInTheDocument();
    expect(within(row('管理员甲')).getByText('管理员')).toBeInTheDocument();
    expect(container.querySelector('style, [style]')).toBeNull();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /删除|授予管理员|上榜开关/ })).not.toBeInTheDocument();
  });
  it('filters by effective name on the client, with whitespace and case ignored', async () => {
    render(page()); await screen.findByText('Alice游客');
    await userEvent.setup().type(screen.getByRole('searchbox', { name: '按名字搜索' }), ' ALICE ');
    expect(screen.getByText('Alice游客')).toBeInTheDocument(); expect(screen.queryByText('裁判乙')).not.toBeInTheDocument();
    expect(api.getAdminUsers).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '没有这个名字' } });
    expect(screen.getByText('没有匹配的账号')).toBeInTheDocument();
  });
  it('makes the five-hundred-account cap and local search scope visible', async () => {
    vi.mocked(api.getAdminUsers).mockResolvedValue(listing(PEOPLE, true)); render(page());
    expect(await screen.findByText(/仅显示最新 500 个账号/)).toBeInTheDocument();
    expect(screen.getByText(/搜索仅限当前列表/)).toBeInTheDocument();
  });
  it('proxies image avatars and falls back to a letter after an image error', async () => {
    render(page()); await screen.findByText('Alice游客');
    const avatar = row('Alice游客').querySelector('img')!;
    expect(avatar).toHaveAttribute('src', '/api/avatar?u=https%3A%2F%2Fimages.example%2Fa.png');
    expect(avatar).toHaveAttribute('width', '40'); expect(avatar).toHaveAttribute('height', '40');
    fireEvent.error(avatar); expect(row('Alice游客').querySelector('img')).toBeNull();
    expect(within(row('Alice游客')).getByText('A')).toHaveAttribute('aria-hidden', 'true');
  });
  it.each([['Alice游客', 'visitor/a', true, '已设为裁判'], ['裁判乙', 'judge', false, '已取消裁判资格']] as const)
    ('changes the judge role for %s, refreshes the list and reports success', async (name, id, on, message) => {
      const changed = vi.fn(); render(page(ADMIN, changed)); await screen.findByText(name);
      vi.mocked(api.getAdminUsers).mockResolvedValue(listing(PEOPLE.map(person => person.id === id ? { ...person, is_judge: on } : person)));
      await userEvent.setup().click(within(row(name)).getByRole('button', { name: on ? '设为裁判' : '取消裁判资格' }));
      await waitFor(() => expect(api.getAdminUsers).toHaveBeenCalledTimes(2));
      expect(api.setJudge).toHaveBeenCalledExactlyOnceWith(id, on); expect(changed).toHaveBeenCalledOnce();
      expect(toastText()).toContain(message);
      expect(await within(await screen.findByRole('listitem', { name: `${name}的账号` })).findByRole('button', { name: on ? '取消裁判资格' : '设为裁判' })).toBeInTheDocument();
    });
  it('hides only self-dismissal and still lets a non-judge admin appoint themselves', async () => {
    const view = render(page()); await screen.findByText('管理员甲');
    expect(within(row('管理员甲')).queryByRole('button', { name: '取消裁判资格' })).not.toBeInTheDocument();
    expect(within(row('裁判乙')).getByRole('button', { name: '取消裁判资格' })).toBeInTheDocument();
    view.unmount(); vi.mocked(api.getAdminUsers).mockResolvedValue(listing(PEOPLE.map(person => person.id === ADMIN.id ? { ...person, is_judge: false } : person)));
    render(page()); await screen.findByText('管理员甲');
    await userEvent.setup().click(within(row('管理员甲')).getByRole('button', { name: '设为裁判' }));
    expect(api.setJudge).toHaveBeenCalledExactlyOnceWith(ADMIN.id, true);
  });
  it('reuses the existing two-step score form before posting and refreshes after confirmation', async () => {
    const user = userEvent.setup(); const changed = vi.fn(); render(page(ADMIN, changed)); await screen.findByText('Alice游客');
    await user.click(within(row('Alice游客')).getByRole('button', { name: '调整分数' }));
    const input = within(row('Alice游客')).getByRole('spinbutton', { name: '调整分数' });
    await user.clear(input); await user.type(input, '75'); await user.click(within(row('Alice游客')).getByRole('button', { name: '改分' }));
    const confirm = within(row('Alice游客')).getByRole('button', { name: '确认改分' }); expect(confirm).toHaveFocus();
    expect(within(row('Alice游客')).getByText(/私信通知本人/)).toBeInTheDocument(); expect(api.setScore).not.toHaveBeenCalled();
    vi.mocked(api.getAdminUsers).mockResolvedValue(listing(PEOPLE.map(person => person.id === 'visitor/a' ? { ...person, score: 75 } : person)));
    await user.click(confirm); await screen.findByText('75');
    expect(api.setScore).toHaveBeenCalledExactlyOnceWith('visitor/a', 75); expect(api.getAdminUsers).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenCalledOnce(); expect(toastText()).toContain('已调整分数');
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });
  it('preserves the score draft and reports a failed write without a success toast or list reload', async () => {
    vi.mocked(api.setScore).mockRejectedValue(new api.ApiError('操作冲突，请重试', 409));
    const user = userEvent.setup(); render(page()); await screen.findByText('Alice游客');
    await user.click(within(row('Alice游客')).getByRole('button', { name: '调整分数' }));
    const input = within(row('Alice游客')).getByRole('spinbutton'); fireEvent.change(input, { target: { value: '75' } });
    await user.click(within(row('Alice游客')).getByRole('button', { name: '改分' })); await user.click(within(row('Alice游客')).getByRole('button', { name: '确认改分' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('操作冲突，请重试');
    expect(within(row('Alice游客')).getByRole('spinbutton')).toHaveValue(75); expect(api.getAdminUsers).toHaveBeenCalledOnce();
    expect(toastText()).not.toContain('已调整分数');
  });
  it('distinguishes a saved change from a failed list refresh', async () => {
    const changed = vi.fn(); render(page(ADMIN, changed)); await screen.findByText('Alice游客');
    vi.mocked(api.getAdminUsers).mockRejectedValueOnce(new api.ApiError('暂时读不到', 500));
    await userEvent.setup().click(within(row('Alice游客')).getByRole('button', { name: '设为裁判' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('修改已保存，成员列表刷新失败');
    expect(changed).toHaveBeenCalledOnce(); expect(toastText()).toContain('已设为裁判');
    expect(screen.queryByRole('button', { name: '设为裁判' })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: '重试' })); expect(await screen.findByText('Alice游客')).toBeInTheDocument();
  });
  it('shows only loading state before the private account list is ready', async () => {
    const pending = deferred<AdminUsersResponse>(); vi.mocked(api.getAdminUsers).mockReturnValueOnce(pending.promise);
    render(page()); expect(screen.getByText('正在读取成员列表…')).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: '调整分数' })).not.toBeInTheDocument();
    await act(async () => pending.resolve(listing())); expect(screen.getByText('Alice游客')).toBeInTheDocument();
  });
  it('retries ordinary read failures without showing stale write controls', async () => {
    vi.mocked(api.getAdminUsers).mockRejectedValueOnce(new api.ApiError('服务暂时不可用', 500)); render(page());
    expect(await screen.findByRole('alert')).toHaveTextContent('服务暂时不可用'); expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: '重试' })); expect(await screen.findByText('Alice游客')).toBeInTheDocument();
  });
  it('renders a useful empty result and escapes a hostile account name', async () => {
    vi.mocked(api.getAdminUsers).mockResolvedValueOnce(listing([])); const view = render(page());
    expect(await screen.findByText('还没有账号')).toBeInTheDocument(); view.unmount();
    vi.mocked(api.getAdminUsers).mockResolvedValue(listing([{ ...PEOPLE[0], username: '<img src=x onerror=alert(1)>', avatar_url: null, created_at: 'invalid' }]));
    const { container } = render(page()); expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull(); expect(screen.getByText('注册时间未知')).toBeInTheDocument();
  });
  it.each([403, 404])('silently removes the whole entry on read status %s', async (status) => {
    vi.mocked(api.getAdminUsers).mockRejectedValueOnce(new api.ApiError('PRIVATE_BACKEND_DETAIL', status)); render(page());
    await screen.findByRole('heading', { name: '这页不存在' }); expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '管理' })).not.toBeInTheDocument(); expect(screen.queryByText('PRIVATE_BACKEND_DETAIL')).not.toBeInTheDocument();
  });
  it.each([403, 404])('conceals existing controls when a write returns status %s', async (status) => {
    vi.mocked(api.setJudge).mockRejectedValueOnce(new api.ApiError('PRIVATE_BACKEND_DETAIL', status)); render(page()); await screen.findByText('Alice游客');
    await userEvent.setup().click(within(row('Alice游客')).getByRole('button', { name: '设为裁判' }));
    await screen.findByRole('heading', { name: '这页不存在' }); expect(screen.queryByText('Alice游客')).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument(); expect(toastText()).toBe('');
  });
  it.each([null, { ...ADMIN, is_admin: false }, { ...ADMIN, is_admin: false, is_judge: false }])('refuses a non-admin before reading accounts: %o', (me) => {
    render(legacyPage(me)); expect(screen.getByRole('heading', { name: '这页不存在' })).toBeInTheDocument();
    expect(api.getAdminUsers).not.toHaveBeenCalled(); expect(screen.queryByRole('navigation', { name: '管理' })).not.toBeInTheDocument();
  });
  it('keeps legacy members in settings and legacy voice in tools without a second management navigation', async () => {
    const view = render(legacyPage()); await screen.findByText('Alice游客');
    const nav = screen.getByRole('navigation', { name: '设置分类' });
    expect(within(nav).getByRole('link', { name: '成员与权限' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'AI 模型与密钥' })).toHaveAttribute('href', '/settings/ai');
    expect(within(nav).queryByRole('link', { name: '语音记录' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '管理' })).not.toBeInTheDocument();
    expect(within(row('Alice游客')).getByRole('link', { name: '调整分数' })).toHaveAttribute('href', '/tools/score?user=visitor%2Fa');
    expect(within(row('Alice游客')).queryByRole('button', { name: '调整分数' })).not.toBeInTheDocument();
    view.rerender(legacyPage({ ...ADMIN, is_admin: false }, vi.fn(), 'voice'));
    await screen.findByText('没有保存的语音记录，不代表没来');
    expect(screen.getByRole('heading', { name: '语音记录', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回裁判工具' })).toHaveAttribute('href', '/tools');
    expect(screen.queryByRole('navigation', { name: '设置分类' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '管理' })).not.toBeInTheDocument();
  });
});

describe('private member response isolation', () => {
  it.each(['success', 'denial'] as const)('ignores a previous account’s late read %s', async (result) => {
    const old = deferred<AdminUsersResponse>(); vi.mocked(api.getAdminUsers).mockReturnValueOnce(old.promise).mockResolvedValue(listing([{ ...PEOPLE[0], username: '新账号的数据' }]));
    const view = render(<MemberList ownerId="first" offsetHours={8} />); view.rerender(<MemberList ownerId="second" offsetHours={8} />);
    expect(await screen.findByText('新账号的数据')).toBeInTheDocument();
    await act(async () => { if (result === 'success') old.resolve(listing([{ ...PEOPLE[0], username: '旧账号的数据' }])); else old.reject(new api.ApiError('private', 403)); });
    expect(screen.queryByText('旧账号的数据')).not.toBeInTheDocument(); expect(screen.getByText('新账号的数据')).toBeInTheDocument();
  });
  it('keeps the newest read when StrictMode replays setup while the first read is pending', async () => {
    const old = deferred<AdminUsersResponse>(); vi.mocked(api.getAdminUsers).mockReturnValueOnce(old.promise).mockResolvedValue(listing([{ ...PEOPLE[0], username: '最新读取' }]));
    render(<StrictMode><MemberList ownerId="same" offsetHours={8} /></StrictMode>); await screen.findByText('最新读取');
    await act(async () => old.resolve(listing([{ ...PEOPLE[0], username: '过期读取' }])));
    expect(screen.queryByText('过期读取')).not.toBeInTheDocument(); expect(api.getAdminUsers).toHaveBeenCalledTimes(2);
  });
  it('conceals the previous account immediately and ignores its late successful write without reloading or toasting', async () => {
    const written = deferred<{ ok: boolean }>(); const next = deferred<AdminUsersResponse>(); const changed = vi.fn();
    vi.mocked(api.setJudge).mockReturnValue(written.promise); const view = render(page(ADMIN, changed)); await screen.findByText('Alice游客');
    await userEvent.setup().click(within(row('Alice游客')).getByRole('button', { name: '设为裁判' }));
    vi.mocked(api.getAdminUsers).mockReturnValue(next.promise); view.rerender(page({ ...ADMIN, id: 'new-admin' }, changed));
    expect(screen.queryByText('Alice游客')).not.toBeInTheDocument(); await act(async () => written.resolve({ ok: true }));
    expect(changed).not.toHaveBeenCalled(); expect(toastText()).toBe(''); expect(api.getAdminUsers).toHaveBeenCalledTimes(2);
    await act(async () => next.resolve(listing([{ ...PEOPLE[0], username: '新成员范围' }]))); expect(screen.getByText('新成员范围')).toBeInTheDocument();
  });
  it('removes the list immediately on role loss and ignores a late write', async () => {
    const written = deferred<{ ok: boolean }>(); const changed = vi.fn(); vi.mocked(api.setJudge).mockReturnValue(written.promise);
    const view = render(page(ADMIN, changed)); await screen.findByText('Alice游客');
    await userEvent.setup().click(within(row('Alice游客')).getByRole('button', { name: '设为裁判' }));
    view.rerender(page({ ...ADMIN, is_admin: false }, changed)); expect(screen.getByRole('heading', { name: '这页不存在' })).toBeInTheDocument();
    await act(async () => written.resolve({ ok: true })); expect(changed).not.toHaveBeenCalled(); expect(api.getAdminUsers).toHaveBeenCalledOnce(); expect(toastText()).toBe('');
  });
  it('does not report an old write after the member page unmounts', async () => {
    const written = deferred<{ ok: boolean }>(); const changed = vi.fn(); vi.mocked(api.setJudge).mockReturnValue(written.promise);
    const view = render(<ToastProvider><MemberList ownerId={ADMIN.id} onChanged={changed} /></ToastProvider>); await screen.findByText('Alice游客');
    await userEvent.setup().click(within(row('Alice游客')).getByRole('button', { name: '设为裁判' })); view.rerender(<ToastProvider><p>已离开</p></ToastProvider>);
    await act(async () => written.resolve({ ok: true })); expect(changed).not.toHaveBeenCalled(); expect(toastText()).toBe(''); expect(api.getAdminUsers).toHaveBeenCalledOnce();
  });
});

describe('central score destination', () => {
  it('can send a member to the shared score tool without opening a second inline editor', async () => {
    render(<ToastProvider><MemberList ownerId={ADMIN.id} scoreTo={id => `/tools/score?user=${encodeURIComponent(id)}`} /></ToastProvider>);
    const member = await screen.findByRole('listitem', { name: 'Alice游客的账号' });
    expect(within(member).getByRole('link', { name: '调整分数' })).toHaveAttribute('href', '/tools/score?user=visitor%2Fa');
    expect(within(member).queryByRole('button', { name: '调整分数' })).not.toBeInTheDocument();
    expect(within(member).getByRole('button', { name: '设为裁判' })).toBeInTheDocument();
  });
});
