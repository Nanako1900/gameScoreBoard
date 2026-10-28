import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import type { User } from '../../src/types';
const JUDGE: User = { id: 'judge', username: '裁判', oauth_username: '裁判', avatar_url: null, is_judge: true,
  is_admin: false, is_participant: true, score: 100, created_at: '' };
function backend() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    const data = path === '/api/config' ? { violations: [], tiers: [], weeklyHeal: 5, statementWindowHours: 12, aiEnabled: false, maxBatchSubjects: 5, nextResetAt: '2099-11-01T16:00:00Z' }
      : path === '/api/me' ? { user: JUDGE, pending: { statements: 0, appeals: 0 } }
      : path === '/api/leaderboard' ? { participants: [JUDGE, { ...JUDGE, id: 'person', username: '当事人', is_judge: false }] }
      : path === '/api/report/latest' ? { report: null }
      : path.startsWith('/api/records') ? { records: [] } : null;
    return { ok: data !== null, status: data === null ? 404 : 200, text: async () => JSON.stringify(data ?? {}) } as Response;
  }));
}
afterEach(() => vi.unstubAllGlobals());
describe('filing as an ordinary destination', () => {
  it('keeps the four-link header and asks before leaving an unsent draft', async () => {
    backend(); window.history.replaceState(null, '', '/tools/filing');
    render(<App />); const user = userEvent.setup();
    await screen.findByRole('heading', { name: '记一笔' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: '主导航' });
    expect(within(nav).getAllByRole('link')).toHaveLength(4);
    await user.type(screen.getByRole('textbox', { name: /发生了什么/ }), '约好的时间迟到十五分钟');
    await user.click(within(nav).getByRole('link', { name: '案件' }));
    expect(window.location.pathname).toBe('/tools/filing');
    await user.click(screen.getByRole('button', { name: '继续写' }));
    expect(screen.getByRole('textbox', { name: /发生了什么/ })).toHaveValue('约好的时间迟到十五分钟');
    await user.click(within(nav).getByRole('link', { name: '案件' }));
    await user.click(screen.getByRole('button', { name: '先离开' }));
    await waitFor(() => expect(window.location.pathname).toBe('/cases'));
    await user.click(screen.getByRole('link', { name: '裁判工具' }));
    await user.click(screen.getByRole('link', { name: /记一笔/ }));
    expect(await screen.findByRole('textbox', { name: /发生了什么/ })).toHaveValue('约好的时间迟到十五分钟');
  });
});
