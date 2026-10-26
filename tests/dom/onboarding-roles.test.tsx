import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnboardingDialog } from '../../src/components/OnboardingDialog';
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
  // The Discord card asks the backend; a 404 keeps it out of the way.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, text: async () => '{}' })));
  render(<OnboardingDialog open onClose={() => {}} me={me} onSaved={() => {}} />);
  const group = within(screen.getByRole('radiogroup', { name: '选择身份' }));
  return {
    player: group.getByRole('radio', { name: /上榜选手/ }),
    judge: group.getByRole('radio', { name: /^裁判/ }),
    both: group.getByRole('radio', { name: /两者都要/ }),
  };
}

describe('OnboardingDialog roles', () => {
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

describe('OnboardingDialog saves', () => {
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
    render(<OnboardingDialog open onClose={() => {}} me={BASE} onSaved={() => {}} />);
    await user.click(screen.getByRole('button', { name: '确认' }));
    await waitFor(() => expect(posts.find((p) => p.path === '/api/me/roles')).toBeDefined());
    expect(posts.find((p) => p.path === '/api/me/roles')?.body).toEqual({ is_participant: true, is_judge: false });
  });

  it('warns a judge who is about to step down', async () => {
    stubSave();
    const user = userEvent.setup();
    render(<OnboardingDialog open onClose={() => {}} me={{ ...BASE, is_judge: true, is_participant: true }} onSaved={() => {}} />);
    expect(screen.queryByText(/需要管理员重新授予/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /上榜选手/ }));
    expect(screen.getByText(/需要管理员重新授予/)).toBeInTheDocument();
  });
});
