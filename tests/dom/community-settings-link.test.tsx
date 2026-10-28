import { act, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/api';
import { communityApi } from '../../src/community-api';
import { CommunitySettingsLink } from '../../src/components/CommunitySettingsLink';
import { SettingsPage } from '../../src/components/SettingsPage';
import { ToastProvider } from '../../src/components/Toast';
import type { CommunityOverview } from '../../shared/community';
import type { Config, User } from '../../src/types';

const ADMIN: User = { id: 'community-settings-admin', username: '管理员甲', oauth_username: '管理员甲', avatar_url: null,
  is_admin: true, is_judge: false, is_participant: true, score: 98, created_at: '2026-10-01 00:00:00' };
const CFG: Config = { violations: [], tiers: [], weeklyHeal: 5, statementWindowHours: 12, aiEnabled: false,
  maxBatchSubjects: 5, nextResetAt: '2099-11-01T16:00:00Z', boardTzOffsetHours: 8 };
const overview = (isAdmin = true, enabled = true) => ({ settings: { enabled }, me: { isAdmin } }) as CommunityOverview;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => { vi.spyOn(communityApi, 'overview').mockResolvedValue(overview()); });
afterEach(() => { vi.restoreAllMocks(); });

describe('community administration in the shared settings navigation', () => {
  it.each([null, { ...ADMIN, is_admin: false }, { ...ADMIN, is_admin: false, is_judge: true }])('does not request or expose community administration to %o', me => {
    render(<CommunitySettingsLink me={me} />);
    expect(communityApi.overview).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: '社区管理' })).not.toBeInTheDocument();
  });
  it('renders a compact administrator link without duplicating the community introduction', async () => {
    const view = render(<CommunitySettingsLink me={ADMIN} />);
    expect(await screen.findByRole('link', { name: '社区管理' })).toHaveAttribute('href', '/settings/community');
    expect(view.container.querySelector('aside,h1,h2,p')).toBeNull();
    expect(screen.queryByText('相聚，从这里开始')).not.toBeInTheDocument();
  });
  it('does not expose a link when the backend denies community administration', async () => {
    vi.mocked(communityApi.overview).mockResolvedValue(overview(false));
    const view = render(<CommunitySettingsLink me={ADMIN} />);
    await waitFor(() => expect(communityApi.overview).toHaveBeenCalledOnce());
    expect(view.container).toBeEmptyDOMElement();
  });
  it('keeps configuration reachable when the community setting is disabled for members', async () => {
    vi.mocked(communityApi.overview).mockResolvedValue(overview(true, false));
    render(<CommunitySettingsLink me={ADMIN} />);
    expect(await screen.findByRole('link', { name: '社区管理' })).toHaveAttribute('href', '/settings/community');
  });
  it.each([404, 503])('silently omits an unavailable community module (%s)', async status => {
    vi.mocked(communityApi.overview).mockRejectedValue(new ApiError('暂不可用', status));
    const view = render(<CommunitySettingsLink me={ADMIN} />);
    await waitFor(() => expect(communityApi.overview).toHaveBeenCalledOnce());
    expect(view.container).toBeEmptyDOMElement();
  });
  it('removes the link immediately when administrator permission is lost', async () => {
    const view = render(<CommunitySettingsLink me={ADMIN} />);
    await screen.findByRole('link', { name: '社区管理' });
    view.rerender(<CommunitySettingsLink me={{ ...ADMIN, is_admin: false }} />);
    expect(screen.queryByRole('link', { name: '社区管理' })).not.toBeInTheDocument();
  });
  it('ignores the previous account response after the settings owner changes', async () => {
    const first = deferred<CommunityOverview>(), second = deferred<CommunityOverview>();
    vi.mocked(communityApi.overview).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const view = render(<CommunitySettingsLink me={ADMIN} />);
    view.rerender(<CommunitySettingsLink me={{ ...ADMIN, id: 'another-admin' }} />);
    await act(async () => first.resolve(overview()));
    expect(screen.queryByRole('link', { name: '社区管理' })).not.toBeInTheDocument();
    await act(async () => second.resolve(overview(false)));
    expect(screen.queryByRole('link', { name: '社区管理' })).not.toBeInTheDocument();
  });
  it('adds community administration after all existing administrator settings groups', async () => {
    render(<ToastProvider><SettingsPage me={ADMIN} config={CFG} tab="profile" discord={{ loading: false, value: null }}
      onDiscordChanged={vi.fn()} onSaved={vi.fn()} onChanged={vi.fn()} /></ToastProvider>);
    const nav = screen.getByRole('navigation', { name: '设置分类' });
    await within(nav).findByRole('link', { name: '社区管理' });
    expect(within(nav).getAllByRole('link').map(link => link.textContent)).toEqual([
      '个人资料', 'Discord 与通知', '成员与权限', 'AI 模型与密钥', '社区管理',
    ]);
    expect(screen.queryByText('相聚，从这里开始')).not.toBeInTheDocument();
  });
});
