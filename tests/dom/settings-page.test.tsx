import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { bootRouter, useLocation } from '../../src/lib/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../../src/api';
import { communityApi } from '../../src/community-api';
import { App } from '../../src/App';
import { SettingsPage } from '../../src/components/SettingsPage';
import { DiscordNotificationSettings } from '../../src/components/DiscordNotificationSettings';
import { ToastProvider } from '../../src/components/Toast';
import type { DiscordLinkInfo } from '../../src/api';
import type { DiscordLinkRead } from '../../src/lib/discordLinkState';
import type { Config, User } from '../../src/types';

const ME: User = { id: 'settings-owner', username: '玩家甲', oauth_username: '玩家甲', avatar_url: null,
  is_admin: false, is_judge: false, is_participant: true, score: 98, created_at: '2026-10-01 00:00:00' };
const ADMIN = { ...ME, is_admin: true };
const CFG: Config = { violations: [], tiers: [], weeklyHeal: 5, statementWindowHours: 12, aiEnabled: false,
  maxBatchSubjects: 5, nextResetAt: '2099-11-01T16:00:00Z', boardTzOffsetHours: 8 };
const BOUND: DiscordLinkInfo = { discord_username: 'self-only', linked_at: '2026-10-01 00:00:00', notify_dm: true, dm_ok: true };
const READ: DiscordLinkRead = { loading: false, value: BOUND };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const wrap = (child: React.ReactNode) => <ToastProvider>{child}</ToastProvider>;
function page(me: User | null = ME, tab: 'profile' | 'discord' | 'members' | 'ai' = 'profile', discord = READ) {
  return wrap(<SettingsPage me={me} config={CFG} tab={tab} discord={discord} onDiscordChanged={vi.fn()} onSaved={vi.fn()} onChanged={vi.fn()} />);
}
beforeEach(() => {
  vi.spyOn(communityApi, 'overview').mockRejectedValue(new api.ApiError('Not found', 404));
  vi.spyOn(api, 'updateAiConfig').mockResolvedValue({ ok: true, enabled: true, prompt_version: 'new' });
  vi.spyOn(api, 'setDiscordNotify').mockResolvedValue(BOUND);
  vi.spyOn(api, 'resendWelcome').mockResolvedValue({ ok: true });
  vi.spyOn(api, 'getAdminUsers').mockResolvedValue({ users: [], truncated: false });
  vi.spyOn(api, 'getAiConfig').mockResolvedValue({ enabled: true, base_url: 'https://example.test/v1', model: 'safe-model', temperature: .2,
    prompt: '', classify_prompt: '', report_prompt: '', prompt_version: 'v1', has_api_key: false, disabled_reason: null,
    recent: { total: 0, fallbackRate: 0, clampRate: 0, avgLatencyMs: 0 } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('a single settings center', () => {
  it('lets a visitor sign in and retains the settings destination', () => {
    window.history.replaceState(null, '', '/settings/profile'); render(page(null));
    expect(screen.getByRole('heading', { name: '登录后修改设置' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '用 Nanako 账号登录' })).toHaveAttribute('href', '/auth/login');
    expect(screen.queryByRole('navigation', { name: '设置分类' })).not.toBeInTheDocument();
  });
  it('shows only personal groups to a member, with direct destinations instead of the wizard', () => {
    render(page()); const nav = screen.getByRole('navigation', { name: '设置分类' });
    expect(within(nav).getAllByRole('link').map(link => link.textContent)).toEqual(['个人资料', 'Discord 与通知']);
    expect(within(nav).getByRole('link', { name: '个人资料' })).toHaveAttribute('href', '/settings/profile');
    expect(within(nav).getByRole('link', { name: 'Discord 与通知' })).toHaveAttribute('href', '/settings/discord');
    expect(screen.queryByTestId('welcome-step-1')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /用 Nanako 名字/ })).toBeInTheDocument();
  });
  it('places all administrator groups in the same navigation', async () => {
    render(page(ADMIN, 'members')); const nav = screen.getByRole('navigation', { name: '设置分类' });
    expect(within(nav).getAllByRole('link').map(link => link.textContent)).toEqual(['个人资料', 'Discord 与通知', '成员与权限', 'AI 模型与密钥']);
    expect(within(nav).getByRole('link', { name: '成员与权限' })).toHaveAttribute('aria-current', 'page');
    await screen.findByText('还没有账号');
  });
  it.each([null, ME, { ...ME, is_judge: true }])('does not fetch administrator settings for an unauthorized viewer: %o', me => {
    render(page(me, 'ai')); expect(screen.getByRole('heading', { name: '这页不存在' })).toBeInTheDocument();
    expect(api.getAiConfig).not.toHaveBeenCalled();
    expect(screen.queryByRole('navigation', { name: '设置分类' })).not.toBeInTheDocument();
  });
  it('silently omits unsupported Discord settings, while a pending read is not unsupported', () => {
    const view = render(page(ME, 'profile', { loading: false, value: undefined }));
    expect(screen.queryByRole('link', { name: 'Discord 与通知' })).not.toBeInTheDocument();
    view.rerender(page(ME, 'profile', { loading: true, value: undefined }));
    expect(screen.getByRole('link', { name: 'Discord 与通知' })).toBeInTheDocument();
  });
  it('keeps the binding nickname private and includes the unchanged voice notice', () => {
    render(page(ME, 'discord'));
    expect(screen.getByText('@self-only')).toBeInTheDocument();
    expect(screen.getByText(/绑定后，你在本服务器语音频道的进出时间会被记录/)).toHaveTextContent('保存 90 天');
    expect(screen.queryByText(/channel_id|discord_user_id|email/)).not.toBeInTheDocument();
  });
});

describe('shared notification settings', () => {
  it('requires an explicit save in settings and reports dirty independently', async () => {
    const changed = vi.fn(), dirty = vi.fn();
    render(wrap(<DiscordNotificationSettings ownerId={ME.id} discord={READ} onChanged={changed} onDirtyChange={dirty} />));
    const user = userEvent.setup(); await user.click(screen.getByRole('switch', { name: '允许机器人私信' }));
    expect(api.setDiscordNotify).not.toHaveBeenCalled(); expect(dirty).toHaveBeenLastCalledWith(true);
    expect(screen.queryByRole('button', { name: '再发一次欢迎私信' })).not.toBeInTheDocument();
    vi.mocked(api.setDiscordNotify).mockResolvedValueOnce({ ...BOUND, notify_dm: false });
    await user.click(screen.getByRole('button', { name: '保存通知设置' }));
    await waitFor(() => expect(changed).toHaveBeenCalledWith({ ...BOUND, notify_dm: false }));
    expect(api.setDiscordNotify).toHaveBeenCalledExactlyOnceWith(false);
    expect(dirty).toHaveBeenLastCalledWith(false);
  });
  it('preserves an unsaved notification choice across a background refresh', async () => {
    const dirty = vi.fn(); const changed = vi.fn();
    const notification = (discord: DiscordLinkRead) => wrap(<DiscordNotificationSettings ownerId={ME.id} discord={discord} onChanged={changed} onDirtyChange={dirty} />);
    const view = render(notification(READ)); const user = userEvent.setup();
    await user.click(screen.getByRole('switch', { name: '允许机器人私信' }));
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    view.rerender(notification({ loading: true, value: undefined }));
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('button', { name: '保存通知设置' })).toBeDisabled();
    view.rerender(notification(READ));
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(dirty).toHaveBeenLastCalledWith(true);
  });
  it('does not send a notification change without a binding', () => {
    render(wrap(<DiscordNotificationSettings ownerId={ME.id} discord={{ loading: false, value: null }} onChanged={vi.fn()} />));
    expect(screen.getByText('先绑定 Discord，再修改私信设置。')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument(); expect(api.setDiscordNotify).not.toHaveBeenCalled();
  });
  it('resends the existing welcome message, describes its server limit and preserves a 429 response', async () => {
    vi.mocked(api.resendWelcome).mockRejectedValueOnce(new api.ApiError('24 小时内最多手动重发 3 次', 429));
    render(wrap(<DiscordNotificationSettings ownerId={ME.id} discord={READ} onChanged={vi.fn()} />));
    await userEvent.setup().click(screen.getByRole('button', { name: '再发一次欢迎私信' }));
    expect(api.resendWelcome).toHaveBeenCalledOnce(); expect(await screen.findByRole('alert')).toHaveTextContent('24 小时内最多手动重发 3 次');
    expect(screen.queryByRole('button', { name: '测试私信' })).not.toBeInTheDocument();
  });
  it('does not treat a failed send as permission to complete onboarding', () => {
    render(wrap(<DiscordNotificationSettings ownerId={ME.id} discord={{ loading: false, value: { ...BOUND, dm_ok: false } }} onChanged={vi.fn()} />));
    expect(screen.getByText(/上次私信没送到/)).toBeInTheDocument();
  });
  it('hides an unsupported mutation instead of leaving a dead save action', async () => {
    vi.mocked(api.setDiscordNotify).mockResolvedValueOnce(undefined);
    render(wrap(<DiscordNotificationSettings ownerId={ME.id} discord={READ} onChanged={vi.fn()} />));
    const user = userEvent.setup(); await user.click(screen.getByRole('switch', { name: '允许机器人私信' }));
    await user.click(screen.getByRole('button', { name: '保存通知设置' }));
    await waitFor(() => expect(screen.queryByRole('switch')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: '保存通知设置' })).not.toBeInTheDocument();
  });
  it('ignores a notification response from an unmounted owner', async () => {
    const result = deferred<DiscordLinkInfo | undefined>(); vi.mocked(api.setDiscordNotify).mockReturnValueOnce(result.promise);
    const changed = vi.fn(); const view = render(wrap(<DiscordNotificationSettings ownerId={ME.id} discord={READ} onChanged={changed} />));
    const user = userEvent.setup(); await user.click(screen.getByRole('switch', { name: '允许机器人私信' }));
    await user.click(screen.getByRole('button', { name: '保存通知设置' })); view.unmount();
    await act(async () => result.resolve({ ...BOUND, notify_dm: false })); expect(changed).not.toHaveBeenCalled();
  });

});


function RoutedSettings({ me = ME }: { me?: User }): JSX.Element {
  useState(bootRouter);
  const location = useLocation();
  const tab = location.route.name === 'settings' ? location.route.tab : 'profile';
  const [link, setLink] = useState<DiscordLinkRead['value']>(BOUND);
  return <ToastProvider><SettingsPage me={me} config={CFG} tab={tab} discord={{ loading: false, value: link }}
    onDiscordChanged={setLink} onSaved={vi.fn()} onChanged={vi.fn()} /></ToastProvider>;
}

describe('settings departure protection integration', () => {
  it('keeps identity edits while cancelling a group change, then discards them before leaving', async () => {
    window.history.replaceState(null, '', '/settings/profile'); render(<RoutedSettings />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: /自定义/ }));
    await user.type(screen.getByRole('textbox', { name: '自定义显示名字' }), '尚未保存');
    await user.click(screen.getByRole('link', { name: 'Discord 与通知' }));
    expect(window.location.pathname).toBe('/settings/profile');
    expect(screen.getByRole('group', { name: '还有未保存的修改' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(screen.getByRole('textbox', { name: '自定义显示名字' })).toHaveValue('尚未保存');
    await user.click(screen.getByRole('link', { name: 'Discord 与通知' }));
    await user.click(screen.getByRole('button', { name: '放弃修改并离开' }));
    await waitFor(() => expect(window.location.pathname).toBe('/settings/discord'));
    expect(screen.getByText('@self-only')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: '个人资料' }));
    expect(screen.getByRole('radio', { name: /用 Nanako 名字/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByDisplayValue('尚未保存')).not.toBeInTheDocument();
  });
  it('clears a typed credential when leaving AI settings after confirmation', async () => {
    const base = await api.getAiConfig();
    vi.mocked(api.getAiConfig).mockResolvedValue({ ...base, has_api_key: true, can_update_api_key: true, api_key_source: 'database' });
    window.history.replaceState(null, '', '/settings/ai'); render(<RoutedSettings me={ADMIN} />);
    const user = userEvent.setup(); await screen.findByLabelText('模型');
    await user.click(screen.getByRole('button', { name: '更换 API Key' }));
    const password = screen.getByLabelText('新 API Key'); await user.type(password, 'synthetic-design-test');
    await user.click(screen.getByRole('link', { name: '个人资料' }));
    await user.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(password).toHaveValue('synthetic-design-test');
    await user.click(screen.getByRole('link', { name: '个人资料' }));
    await user.click(screen.getByRole('button', { name: '放弃修改并离开' }));
    await waitFor(() => expect(window.location.pathname).toBe('/settings/profile'));
    expect(password).toHaveValue('');
    expect(api.updateAiConfig).not.toHaveBeenCalled();
  });
  it('clears credentials immediately while a confirmed logout is still pending', async () => {
    const base = await api.getAiConfig();
    vi.mocked(api.getAiConfig).mockResolvedValue({ ...base, has_api_key: true, can_update_api_key: true, api_key_source: 'database' });
    const logout = deferred<{ ok: true }>(); vi.spyOn(api, 'logout').mockReturnValue(logout.promise);
    const routes: Record<string, unknown> = { '/api/config': CFG, '/api/me': { user: ADMIN, pending: { statements: 0, appeals: 0 } },
      '/api/leaderboard': { participants: [] }, '/api/records?limit=50': { records: [] }, '/api/report/latest': { report: null }, '/api/me/discord': { link: BOUND } };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const body = routes[String(input)]; const status = body === undefined ? 404 : 200;
      return { ok: status === 200, status, text: async () => JSON.stringify(body ?? {}) } as Response;
    }));
    window.history.replaceState(null, '', '/settings/ai'); const view = render(<App />);
    const user = userEvent.setup(); await screen.findByLabelText('模型');
    await user.click(screen.getByRole('button', { name: '更换 API Key' }));
    const password = screen.getByLabelText('新 API Key'); await user.type(password, 'synthetic-logout-test');
    await user.click(screen.getByRole('button', { name: ME.username }));
    await user.click(screen.getByRole('button', { name: '退出登录' }));
    await user.click(screen.getByRole('button', { name: '放弃修改并离开' }));
    expect(api.logout).toHaveBeenCalledOnce();
    expect(password).toHaveValue(''); expect(screen.queryByLabelText('新 API Key')).not.toBeInTheDocument();
    expect(screen.getByText('正在离开…')).toBeInTheDocument();
    view.unmount();
  });
  it('removes private AI fields and cancels the pending departure immediately on lost permission', async () => {
    window.history.replaceState(null, '', '/settings/ai'); const view = render(<RoutedSettings me={ADMIN} />);
    await screen.findByLabelText('模型'); fireEvent.change(screen.getByLabelText('模型'), { target: { value: 'private-unsaved' } });
    await userEvent.setup().click(screen.getByRole('link', { name: '个人资料' }));
    expect(screen.getByRole('group', { name: '还有未保存的修改' })).toBeInTheDocument();
    view.rerender(<RoutedSettings me={ME} />);
    expect(screen.getByRole('heading', { name: '这页不存在' })).toBeInTheDocument();
    expect(screen.queryByDisplayValue('private-unsaved')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '还有未保存的修改' })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/settings/ai');
  });
});
