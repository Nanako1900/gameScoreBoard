import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlayerDetail } from '../../src/components/PlayerDetail';
import type { User } from '../../src/types';

const ME: User = {
  id: 'admin',
  username: '管理员',
  oauth_username: '管理员',
  avatar_url: null,
  is_participant: true,
  is_judge: false,
  is_admin: true,
  score: 100,
  created_at: '2026-10-01 00:00:00',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

/** GET /api/users/p answers with the player's current judge flag; POSTs are recorded. */
function stubBackend(initiallyJudge: boolean) {
  let isJudge = initiallyJudge;
  const posts: Array<{ path: string; body: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body ?? '{}')) as { is_judge?: boolean };
        posts.push({ path, body });
        if (typeof body.is_judge === 'boolean') isJudge = body.is_judge;
        return { ok: true, status: 200, text: async () => '{"ok":true}' };
      }
      const user = { id: 'p', username: '选手', avatar_url: null, is_participant: true, is_judge: isJudge, score: 90, created_at: 'x' };
      return { ok: true, status: 200, text: async () => JSON.stringify({ user, records: [], history: [] }) };
    }),
  );
  return posts;
}

describe('PlayerDetail — appointing judges', () => {
  it('lets an admin appoint a judge, and dismiss one', async () => {
    const posts = stubBackend(false);
    const user = userEvent.setup();
    render(<PlayerDetail userId="p" me={ME} onClose={() => {}} />);
    await user.click(await screen.findByRole('button', { name: '设为裁判' }));
    await waitFor(() => expect(posts).toEqual([{ path: '/api/admin/users/p', body: { is_judge: true } }]));
    await user.click(await screen.findByRole('button', { name: '取消裁判资格' }));
    await waitFor(() => expect(posts[1]).toEqual({ path: '/api/admin/users/p', body: { is_judge: false } }));
  });

  it('shows no such control to anyone else', async () => {
    stubBackend(false);
    render(<PlayerDetail userId="p" me={{ ...ME, is_admin: false }} onClose={() => {}} />);
    await screen.findByRole('heading', { name: '选手' });
    expect(screen.queryByRole('button', { name: '设为裁判' })).not.toBeInTheDocument();
  });
});
