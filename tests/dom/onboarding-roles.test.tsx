import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IdentityForm } from '../../src/components/IdentityForm';
import type { User } from '../../src/types';

const BASE: User = {
  id: 'u1',
  username: 'Nanako',
  oauth_username: 'Nanako',
  avatar_url: null,
  is_participant: true,
  is_judge: false,
  is_admin: false,
  score: 100,
  created_at: '2026-10-01 00:00:00',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function radios(me: User) {
  render(<IdentityForm me={me} onSaved={() => {}} />);
  const group = within(screen.getByRole('radiogroup', { name: '选择身份' }));
  return {
    player: group.getByRole('radio', { name: /上榜选手/ }),
    judge: group.getByRole('radio', { name: /^裁判/ }),
    both: group.getByRole('radio', { name: /两者都要/ }),
  };
}

describe('IdentityForm roles', () => {
  it('locks the judge choices for someone an admin has not appointed', () => {
    const { player, judge, both } = radios(BASE);
    expect(player).toBeEnabled();
    expect(judge).toBeDisabled();
    expect(both).toBeDisabled();
    expect(screen.getAllByText(/裁判资格由管理员授予/)).toHaveLength(2);
  });

  it.each([
    ['a judge', { ...BASE, is_judge: true }],
    ['an admin', { ...BASE, is_admin: true }],
  ])('keeps them open for %s', (_who, me) => {
    const { judge, both } = radios(me);
    expect(judge).toBeEnabled();
    expect(both).toBeEnabled();
  });
});

describe('IdentityForm saves', () => {
  function stubSave() {
    const posts: Array<{ path: string; body: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const path = url.replace(/^https?:\/\/[^/]+/, '');
        if (init?.method === 'POST') posts.push({ path, body: JSON.parse(String(init.body ?? '{}')) });
        const body = path === '/api/me/roles' ? { user: BASE } : path === '/api/me/display-name' ? { user: BASE } : {};
        const status = path === '/api/me/discord' ? 404 : 200;
        return { ok: status === 200, status, text: async () => JSON.stringify(body) };
      }),
    );
    return posts;
  }

  it('a player who is not a judge saves as a player only', async () => {
    const posts = stubSave();
    const user = userEvent.setup();
    render(<IdentityForm me={BASE} onSaved={() => {}} />);
    await user.click(screen.getByRole('button', { name: '确认' }));
    await waitFor(() => expect(posts.find((p) => p.path === '/api/me/roles')).toBeDefined());
    expect(posts.find((p) => p.path === '/api/me/roles')?.body).toEqual({ is_participant: true, is_judge: false });
    expect(posts.map((p) => p.path)).toEqual(['/api/me/display-name', '/api/me/roles']);
  });

  it('warns a judge who is about to step down', async () => {
    stubSave();
    const user = userEvent.setup();
    render(<IdentityForm me={{ ...BASE, is_judge: true, is_participant: true }} onSaved={() => {}} />);
    expect(screen.queryByText(/需要管理员重新授予/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /上榜选手/ }));
    expect(screen.getByText(/需要管理员重新授予/)).toBeInTheDocument();
  });
});


describe('IdentityForm names and failures', () => {
  it('requires a nonempty custom name and enforces the existing input length', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    render(<IdentityForm me={BASE} onSaved={() => {}} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: /自定义/ }));
    expect(screen.getByRole('textbox', { name: '自定义显示名字' })).toHaveAttribute('maxlength', '24');
    await user.click(screen.getByRole('button', { name: '确认' }));
    expect(screen.getByRole('alert')).toHaveTextContent('请输入自定义名字，或选择使用 Nanako 名字');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps edits and allows retry when the name request fails', async () => {
    const onSaved = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, text: async () => JSON.stringify({ error: '系统维护中' }) })));
    const { container } = render(<IdentityForm me={BASE} onSaved={onSaved} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: /自定义/ }));
    await user.type(screen.getByRole('textbox', { name: '自定义显示名字' }), '新名字');
    await user.click(screen.getByRole('button', { name: '确认' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('系统维护中');
    expect(screen.getByRole('textbox', { name: '自定义显示名字' })).toHaveValue('新名字');
    expect(screen.getByRole('button', { name: '确认' })).toBeEnabled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(container.querySelector('style, [style]')).toBeNull();
  });
});
