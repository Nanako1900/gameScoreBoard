import { StrictMode, createRef } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IdentityForm, type IdentityFormHandle } from '../../src/components/IdentityForm';
import { writeDraft } from '../../src/lib/drafts';
import type { User } from '../../src/types';

const ME: User = { id: 'a', username: 'Nanako', oauth_username: 'Nanako', avatar_url: null,
  is_participant: true, is_judge: false, is_admin: false, score: 100, created_at: '2026-10-01 00:00:00' };
const UNLISTED: User = { ...ME, is_participant: false };
interface Call { path: string; body: Record<string, unknown> }
const json = (status: number, body: unknown): Response => ({ ok: status >= 200 && status < 300, status,
  text: async () => JSON.stringify(body) }) as Response;
function saves(next: User = ME): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ path: String(input), body: JSON.parse(String(init?.body ?? '{}')) });
    return json(200, { user: next });
  }));
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe('IdentityForm settings presentation', () => {
  it('uses ordinary settings copy while retaining the name source and length', async () => {
    const { container } = render(<IdentityForm mode="settings" me={ME} onSaved={() => {}} />);
    expect(screen.getByRole('heading', { name: '个人资料' })).toBeInTheDocument();
    expect(screen.queryByText(/欢迎，|头像菜单/)).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('radio', { name: /自定义/ }));
    expect(screen.getByRole('textbox', { name: '自定义显示名字' })).toHaveAttribute('maxlength', '24');
    expect(screen.getByRole('button', { name: '保存资料' })).toBeInTheDocument();
    expect(container.querySelector('style, [style]')).toBeNull();
  });

  it('keeps an unlisted account unlisted when only the display name changes', async () => {
    const saved = { ...UNLISTED, username: '新名字' };
    const calls = saves(saved); const dirty = vi.fn();
    render(<IdentityForm mode="settings" me={UNLISTED} onSaved={() => {}} onDirtyChange={dirty} />);
    expect(screen.getByRole('checkbox', { name: '作为成员上榜' })).not.toBeChecked();
    expect(dirty).toHaveBeenLastCalledWith(false);
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: /自定义/ }));
    await user.type(screen.getByRole('textbox', { name: '自定义显示名字' }), '新名字');
    await user.click(screen.getByRole('button', { name: '保存资料' }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls).toEqual([
      { path: '/api/me/display-name', body: { display_name: '新名字' } },
      { path: '/api/me/roles', body: { is_participant: false, is_judge: false } },
    ]);
    await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false));
  });

  it('lets a member return to the saved participation choice without remaining dirty', async () => {
    const dirty = vi.fn(); render(<IdentityForm mode="settings" me={UNLISTED} onSaved={() => {}} onDirtyChange={dirty} />);
    const user = userEvent.setup(); const checkbox = screen.getByRole('checkbox', { name: '作为成员上榜' });
    await user.click(checkbox); expect(dirty).toHaveBeenLastCalledWith(true);
    await user.click(checkbox); expect(dirty).toHaveBeenLastCalledWith(false);
  });

  it('retains judge relinquishment and existing admin self-selection without a retired bonus claim', async () => {
    const user = userEvent.setup(); const calls = saves({ ...ME, is_judge: false });
    const view = render(<IdentityForm mode="settings" me={{ ...ME, is_judge: true }} onSaved={() => {}} />);
    const judge = screen.getByRole('checkbox', { name: '保留裁判身份' });
    expect(judge).toBeChecked(); await user.click(judge);
    expect(screen.getByText(/需要管理员重新授予/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '保存资料' }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].body).toEqual({ is_participant: true, is_judge: false });
    view.unmount();
    render(<IdentityForm mode="settings" me={{ ...ME, is_admin: true }} onSaved={() => {}} />);
    expect(screen.getByRole('checkbox', { name: '作为裁判' })).toBeEnabled();
    expect(screen.queryByText(/记录违约或守约|结算分数/)).not.toBeInTheDocument();
  });

  it('keeps onboarding as the default with its existing three choices and confirm action', () => {
    render(<IdentityForm me={{ ...ME, is_judge: true }} onSaved={() => {}} />);
    expect(screen.getByRole('heading', { name: '设置你的显示名字与身份' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^裁判/ })).toBeEnabled();
    expect(screen.getByRole('radio', { name: /两者都要/ })).toBeInTheDocument();
    expect(screen.queryByText(/记录违约或守约|结算分数/)).not.toBeInTheDocument();
  });
});

describe('IdentityForm dirty state and drafts', () => {
  it('compares restored fields with saved data and becomes clean after a successful save', async () => {
    writeDraft('onboarding', undefined, { choice: 'participant', useNanako: false, customName: '草稿名字' });
    const dirty = vi.fn(), onSaved = vi.fn(); saves({ ...ME, username: '草稿名字' });
    render(<IdentityForm mode="settings" me={ME} onSaved={onSaved} onDirtyChange={dirty} />);
    expect(screen.getByRole('textbox', { name: '自定义显示名字' })).toHaveValue('草稿名字');
    expect(dirty).toHaveBeenLastCalledWith(true);
    await userEvent.setup().click(screen.getByRole('button', { name: '保存资料' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false));
    expect(sessionStorage.getItem('edg.draft.onboarding')).toBeNull();
  });

  it('preserves ordinary input and dirty state after a failed save', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(503, { error: '稍后再试' })));
    const dirty = vi.fn(); render(<IdentityForm mode="settings" me={ME} onSaved={() => {}} onDirtyChange={dirty} />);
    const user = userEvent.setup(); await user.click(screen.getByRole('radio', { name: /自定义/ }));
    await user.type(screen.getByRole('textbox', { name: '自定义显示名字' }), '尚未保存');
    await user.click(screen.getByRole('button', { name: '保存资料' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('稍后再试');
    expect(screen.getByRole('textbox', { name: '自定义显示名字' })).toHaveValue('尚未保存');
    expect(screen.getByRole('button', { name: '保存资料' })).toBeEnabled();
    expect(dirty).toHaveBeenLastCalledWith(true);
  });

  it('reports through the newest callback without replaying unchanged dirty state', async () => {
    const first = vi.fn(), second = vi.fn();
    const view = render(<IdentityForm mode="settings" me={ME} onSaved={() => {}} onDirtyChange={first} />);
    expect(first).toHaveBeenCalledExactlyOnceWith(false);
    view.rerender(<IdentityForm mode="settings" me={ME} onSaved={() => {}} onDirtyChange={second} />);
    expect(second).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole('radio', { name: /自定义/ }));
    expect(second).toHaveBeenLastCalledWith(true);
    expect(first).toHaveBeenCalledTimes(1);
    view.unmount(); expect(second).toHaveBeenLastCalledWith(false);
  });

  it('discards local fields and the onboarding draft without sending a request', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    writeDraft('onboarding', undefined, { choice: 'participant', useNanako: false, customName: '旧草稿' });
    const ref = createRef<IdentityFormHandle>(); const dirty = vi.fn();
    render(<IdentityForm ref={ref} mode="settings" me={ME} onSaved={() => {}} onDirtyChange={dirty} />);
    expect(screen.getByRole('textbox', { name: '自定义显示名字' })).toHaveValue('旧草稿');
    act(() => ref.current?.discardChanges?.());
    expect(screen.getByRole('radio', { name: /用 Nanako 名字/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(dirty).toHaveBeenLastCalledWith(false);
    expect(sessionStorage.getItem('edg.draft.onboarding')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps an unlisted settings choice in memory without writing none into the old draft shape', async () => {
    const ref = createRef<IdentityFormHandle>();
    render(<IdentityForm ref={ref} mode="settings" me={UNLISTED} onSaved={() => {}} />);
    act(() => ref.current?.saveBeforeBind());
    expect(sessionStorage.getItem('edg.draft.onboarding')).toBeNull();
  });

  it('updates its clean baseline when server data changes, while retaining later edits', async () => {
    const dirty = vi.fn(); const view = render(<IdentityForm mode="settings" me={ME} onSaved={() => {}} onDirtyChange={dirty} />);
    const newer = { ...ME, username: '服务器名字' };
    view.rerender(<IdentityForm mode="settings" me={newer} onSaved={() => {}} onDirtyChange={dirty} />);
    await waitFor(() => expect(screen.getByRole('textbox', { name: '自定义显示名字' })).toHaveValue('服务器名字'));
    expect(dirty).toHaveBeenLastCalledWith(false);
    const user = userEvent.setup(); await user.clear(screen.getByRole('textbox', { name: '自定义显示名字' }));
    await user.type(screen.getByRole('textbox', { name: '自定义显示名字' }), '继续编辑');
    view.rerender(<IdentityForm mode="settings" me={{ ...newer, username: '继续编辑' }} onSaved={() => {}} onDirtyChange={dirty} />);
    await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false));
    expect(screen.getByRole('textbox', { name: '自定义显示名字' })).toHaveValue('继续编辑');
  });
});

describe('IdentityForm account isolation', () => {
  it('replaces fields immediately and ignores a previous account request', async () => {
    let release!: (response: Response) => void;
    const delayed = new Promise<Response>(resolve => { release = resolve; });
    const fetch = vi.fn(() => delayed); vi.stubGlobal('fetch', fetch);
    const saved = vi.fn(); const dirty = vi.fn();
    const view = render(<IdentityForm mode="settings" me={ME} onSaved={saved} onDirtyChange={dirty} />);
    const user = userEvent.setup(); await user.click(screen.getByRole('radio', { name: /自定义/ }));
    await user.type(screen.getByRole('textbox', { name: '自定义显示名字' }), '前一个人的内容');
    await user.click(screen.getByRole('button', { name: '保存资料' }));
    expect(fetch).toHaveBeenCalledTimes(1);
    view.rerender(<IdentityForm mode="settings" me={{ ...ME, id: 'b', username: '账号乙', oauth_username: '账号乙' }} onSaved={saved} onDirtyChange={dirty} />);
    expect(screen.queryByDisplayValue('前一个人的内容')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /用 Nanako 名字.*账号乙/ })).toHaveAttribute('aria-checked', 'true');
    await act(async () => release(json(200, { user: ME })));
    expect(fetch).toHaveBeenCalledTimes(1); expect(saved).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '保存资料' })).toBeEnabled();
    expect(dirty).toHaveBeenLastCalledWith(false);
  });

  it('claims a compatible legacy draft for its first account before a same-tab account switch', () => {
    writeDraft('onboarding', undefined, { choice: 'participant', useNanako: false, customName: '旧版账号甲草稿' });
    const view = render(<IdentityForm mode="settings" me={ME} onSaved={() => {}} />);
    expect(screen.getByRole('textbox', { name: '自定义显示名字' })).toHaveValue('旧版账号甲草稿');
    view.rerender(<IdentityForm mode="settings" me={{ ...ME, id: 'b', username: '账号乙', oauth_username: '账号乙' }} onSaved={() => {}} />);
    expect(screen.queryByDisplayValue('旧版账号甲草稿')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /用 Nanako 名字.*账号乙/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('does not restore a newly saved bind draft into a different account', async () => {
    const ref = createRef<IdentityFormHandle>();
    const view = render(<IdentityForm ref={ref} mode="settings" me={ME} onSaved={() => {}} />);
    const user = userEvent.setup(); await user.click(screen.getByRole('radio', { name: /自定义/ }));
    await user.type(screen.getByRole('textbox', { name: '自定义显示名字' }), '只属于账号甲');
    act(() => ref.current?.saveBeforeBind()); view.unmount();
    render(<IdentityForm mode="settings" me={{ ...ME, id: 'b', username: '账号乙', oauth_username: '账号乙' }} onSaved={() => {}} />);
    expect(screen.queryByDisplayValue('只属于账号甲')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /用 Nanako 名字.*账号乙/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('does not clear a new account bind draft when the old roles request finishes', async () => {
    let release!: (response: Response) => void;
    const delayed = new Promise<Response>(resolve => { release = resolve; });
    const fetch = vi.fn((input: RequestInfo | URL) => String(input) === '/api/me/roles'
      ? delayed : Promise.resolve(json(200, { user: ME })));
    vi.stubGlobal('fetch', fetch);
    const ref = createRef<IdentityFormHandle>(); const saved = vi.fn(); const dirty = vi.fn();
    const view = render(<IdentityForm ref={ref} mode="settings" me={ME} onSaved={saved} onDirtyChange={dirty} />);
    const user = userEvent.setup(); await user.click(screen.getByRole('button', { name: '保存资料' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    view.rerender(<IdentityForm ref={ref} mode="settings" me={{ ...ME, id: 'b', username: '账号乙', oauth_username: '账号乙' }}
      onSaved={saved} onDirtyChange={dirty} />);
    await user.click(screen.getByRole('radio', { name: /自定义/ }));
    await user.type(screen.getByRole('textbox', { name: '自定义显示名字' }), '账号乙的绑定草稿');
    act(() => ref.current?.saveBeforeBind());
    await act(async () => release(json(200, { user: ME })));
    expect(saved).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: '自定义显示名字' })).toHaveValue('账号乙的绑定草稿');
    expect(JSON.parse(sessionStorage.getItem('edg.draft.onboarding')!).value.customName).toBe('账号乙的绑定草稿');
    expect(dirty).toHaveBeenLastCalledWith(true);
  });

  it('can save once after StrictMode replays effects', async () => {
    const calls = saves(ME), saved = vi.fn();
    render(<StrictMode><IdentityForm mode="settings" me={ME} onSaved={saved} /></StrictMode>);
    await userEvent.setup().click(screen.getByRole('button', { name: '保存资料' }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce()); expect(calls).toHaveLength(2);
  });
});
