import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import type { AdminUserRow, User } from '../../src/types';
import { useDesktopViewport } from './viewport';

const ADMIN: User = { id: 'admin', username: '管理', oauth_username: 'admin', avatar_url: null,
  is_admin: true, is_judge: true, is_participant: false, score: 100, created_at: '2026-10-01 00:00:00' };
const PERSON: AdminUserRow = { id: 'member/a', username: '不上榜账号', avatar_url: null, is_admin: false,
  is_judge: false, is_participant: false, score: 55, created_at: '2026-10-01 00:00:00' };
function json(data: unknown, status = 200): Response { return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(data) } as Response; }
function backend() {
  let person = PERSON;
  const calls: Array<{ path: string; method: string; body?: unknown }> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input); const method = init?.method ?? 'GET';
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body)); calls.push({ path, method, body });
    if (path === '/api/admin/users/member%2Fa' && method === 'POST') { person = { ...person, ...body }; return json({ ok: true }); }
    if (path === '/api/admin/users') return json({ users: [person], truncated: false });
    if (path === '/api/config') return json({ violations: [], tiers: [], weeklyHeal: 15, statementWindowHours: 12, aiEnabled: false,
      maxBatchSubjects: 8, nextResetAt: '2099-11-01T16:00:00Z', boardTzOffsetHours: 8 });
    if (path === '/api/me') return json({ user: ADMIN, pending: { statements: 0, appeals: 0 } });
    if (path === '/api/leaderboard') return json({ participants: [] });
    if (path.startsWith('/api/records')) return json({ records: [] });
    if (path === '/api/report/latest') return json({ report: null });
    return json({ error: 'Not found' }, 404);
  }));
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe('members page inside App', () => {
  it.each(['judge', 'score'] as const)('refreshes records, board and me after a member %s change', async (operation) => {
    useDesktopViewport(); const calls = backend(); window.history.replaceState(null, '', '/admin/members');
    const { container } = render(<App />); const user = userEvent.setup(); await screen.findByText('不上榜账号');
    expect(document.querySelector('.app__main')).toHaveAttribute('hidden'); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '设置' })).toHaveFocus();
    const account = screen.getByRole('listitem', { name: '不上榜账号的账号' });
    if (operation === 'judge') await user.click(within(account).getByRole('button', { name: '设为裁判' }));
    else {
      await user.click(within(account).getByRole('button', { name: '调整分数' })); const input = within(account).getByRole('spinbutton', { name: '调整分数' });
      await user.clear(input); await user.type(input, '75'); await user.click(within(account).getByRole('button', { name: '改分' }));
      await user.click(within(account).getByRole('button', { name: '确认改分' }));
    }
    for (const path of ['/api/admin/users', '/api/records?limit=50', '/api/leaderboard', '/api/me']) {
      await waitFor(() => expect(calls.filter(call => call.path === path && call.method === 'GET').length, path).toBeGreaterThan(1));
    }
    expect(calls.filter(call => call.method === 'POST')).toEqual([{ path: '/api/admin/users/member%2Fa', method: 'POST', body: operation === 'judge' ? { is_judge: true } : { score: 75 } }]);
    expect(document.querySelector('.toasts')).toHaveTextContent(operation === 'judge' ? '已设为裁判' : '已调整分数');
    expect(container.querySelector('.settings-page style, .settings-page [style]')).toBeNull();
  });
});
