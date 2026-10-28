import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultCommunitySettings } from '../../shared/community';
import { ApiError } from '../../src/api';
import { communityApi, type CommunityAdminData } from '../../src/community-api';
import { CommunityAdminPage } from '../../src/components/CommunityAdminPage';
import { Link } from '../../src/components/Link';
import { bootRouter, navigate, requestNavigation, useLocation } from '../../src/lib/router';
import type { User } from '../../src/types';

const ADMIN = { id: 'community-admin', username: '管理员', is_admin: true } as User;
const QUESTION = '还有未保存的社区设置';
const departed = vi.fn();
const data = (): CommunityAdminData => ({ settings: defaultCommunitySettings(), version: 2,
  runtime: { ready: true, appliedVersion: 2, syncedAt: null, problem: null } });
const operation = { ref: '3265bc08-259a-439f-9882-451464413270', kind: 'settings.apply', status: 'succeeded' as const,
  error: null, result: null, roomRef: null, createdAt: '2026-10-28T00:00:00Z', finishedAt: null };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function Frame({ me = ADMIN }: { me?: User }): JSX.Element {
  const location = useLocation();
  return <><nav aria-label="主导航"><Link to="/board">信誉榜</Link></nav>
    <button onClick={() => requestNavigation(departed)}>退出账号</button>
    {location.pathname === '/settings/community' ? <CommunityAdminPage me={me} /> : <p>其他页面</p>}
  </>;
}
async function start() {
  bootRouter(); act(() => navigate('/settings/community'));
  const view = render(<Frame />);
  await screen.findByRole('button', { name: '保存社区设置' });
  return view;
}
function edit() { fireEvent.change(screen.getByRole('textbox', { name: '社区 AI 提示词' }), { target: { value: '尚未保存的私人配置' } }); }
async function askToLeave() {
  await userEvent.setup().click(screen.getByRole('link', { name: '信誉榜' }));
  await screen.findByRole('group', { name: QUESTION });
  expect(window.location.pathname).toBe('/settings/community');
}
beforeEach(() => {
  vi.spyOn(communityApi, 'admin').mockResolvedValue(data());
  vi.spyOn(communityApi, 'resources').mockResolvedValue({ resources: [] });
  vi.spyOn(communityApi, 'operations').mockResolvedValue({ operations: [] });
  vi.spyOn(communityApi, 'audit').mockResolvedValue({ audit: [] });
  vi.spyOn(communityApi, 'save').mockImplementation(async settings => ({ ...data(), settings, operation }));
  vi.spyOn(window, 'confirm').mockReturnValue(false);
});
afterEach(() => { vi.restoreAllMocks(); departed.mockReset(); });

describe('community administrator uses the shared page leave guard', () => {
  it('allows clean navigation from the main header without confirmation', async () => {
    await start();
    await userEvent.setup().click(screen.getByRole('link', { name: '信誉榜' }));
    expect(window.location.pathname).toBe('/board');
    expect(screen.queryByRole('group', { name: QUESTION })).not.toBeInTheDocument();
  });
  it('protects header navigation and keeps the draft when departure is canceled', async () => {
    await start(); edit(); await askToLeave();
    await userEvent.setup().click(screen.getByRole('button', { name: '继续编辑' }));
    expect(screen.getByRole('textbox', { name: '社区 AI 提示词' })).toHaveValue('尚未保存的私人配置');
    await askToLeave();
    await userEvent.setup().click(screen.getByRole('button', { name: '放弃修改并离开' }));
    expect(window.location.pathname).toBe('/board');
    expect(window.confirm).not.toHaveBeenCalled();
  });
  it('uses the shared confirmation before opening the centralized model settings', async () => {
    await start(); edit();
    await userEvent.setup().click(screen.getByRole('link', { name: '管理模型与密钥' }));
    await screen.findByRole('group', { name: QUESTION });
    await userEvent.setup().click(screen.getByRole('button', { name: '放弃修改并离开' }));
    expect(window.location.pathname).toBe('/settings/ai');
    expect(window.confirm).not.toHaveBeenCalled();
  });
  it('clears the editor as soon as logout is confirmed even while logout is pending', async () => {
    await start(); edit();
    await userEvent.setup().click(screen.getByRole('button', { name: '退出账号' }));
    await screen.findByRole('group', { name: QUESTION });
    await userEvent.setup().click(screen.getByRole('button', { name: '放弃修改并离开' }));
    expect(departed).toHaveBeenCalledOnce();
    expect(screen.getByRole('status')).toHaveTextContent('正在离开');
    expect(screen.queryByRole('textbox', { name: '社区 AI 提示词' })).not.toBeInTheDocument();
    const requests = vi.mocked(communityApi.admin).mock.calls.length;
    fireEvent.focus(window);
    await act(async () => {});
    expect(communityApi.admin).toHaveBeenCalledTimes(requests);
  });
  it('cancels a pending departure when administrator access is revoked', async () => {
    const view = await start(); edit(); await askToLeave();
    view.rerender(<Frame me={{ ...ADMIN, is_admin: false }} />);
    expect(screen.queryByRole('textbox', { name: '社区 AI 提示词' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: QUESTION })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/settings/community');
    await userEvent.setup().click(screen.getByRole('button', { name: '退出账号' }));
    expect(departed).toHaveBeenCalledOnce();
  });
  it('cancels a pending departure and clears fields when the backend revokes access', async () => {
    await start(); edit(); await askToLeave();
    vi.mocked(communityApi.admin).mockRejectedValue(new ApiError('无权访问', 403));
    fireEvent.focus(window);
    await waitFor(() => expect(screen.queryByRole('textbox', { name: '社区 AI 提示词' })).not.toBeInTheDocument());
    expect(screen.queryByRole('group', { name: QUESTION })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/settings/community');
    await userEvent.setup().click(screen.getByRole('button', { name: '退出账号' }));
    expect(departed).toHaveBeenCalledOnce();
  });
  it('ignores a save response that completes after confirmed departure', async () => {
    await start(); edit();
    const save = deferred<Awaited<ReturnType<typeof communityApi.save>>>();
    vi.mocked(communityApi.save).mockReturnValue(save.promise);
    await userEvent.setup().click(screen.getByRole('button', { name: '保存社区设置' }));
    await userEvent.setup().click(screen.getByRole('button', { name: '退出账号' }));
    await screen.findByRole('group', { name: QUESTION });
    await userEvent.setup().click(screen.getByRole('button', { name: '放弃修改并离开' }));
    await act(async () => save.resolve({ ...data(), operation }));
    expect(screen.getByRole('status')).toHaveTextContent('正在离开');
    expect(screen.queryByRole('textbox', { name: '社区 AI 提示词' })).not.toBeInTheDocument();
    expect(screen.queryByText('已执行，请查看最新状态')).not.toBeInTheDocument();
  });
});
