import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionHistoryPage } from '../../src/components/SessionHistoryPage';
import { SESSION_HISTORY_PAGE } from '../../shared/attendance';
import type { HistorySessionItem } from '../../src/types';

function history(id: number): HistorySessionItem {
  return { id, title: `五排${id}`, game: '云顶', organizer: { id: 'org', username: '阿杰', avatar_url: null },
    starts_at: '2026-10-26T12:00:00Z', duration_min: null, capacity: null, note: null, status: 'settled',
    created_at: '2026-10-25 12:00:00', settled_at: '2026-10-26 15:00:00',
    counts: { going: 5, maybe: 0, invited: 0, out: 0 }, my_rsvp: null,
    attendance_summary: { on_time: 4, late: 1, no_show: 0, left_early: 0, excused: 0 } };
}
function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) } as Response;
}
function mock(reply: (url: string) => Response | Promise<Response>) {
  const fetch = vi.fn((input: RequestInfo | URL) => Promise.resolve(reply(String(input))));
  vi.stubGlobal('fetch', fetch); return fetch;
}
afterEach(() => { vi.unstubAllGlobals(); });

describe('session history page', () => {
  it('pages by the last id and shows counts, cancelled reasons as text, and real session links', async () => {
    const first = Array.from({ length: SESSION_HISTORY_PAGE }, (_, i) => history(i + 1));
    const fetch = mock((url) => json(200, { sessions: url.includes('before=')
      ? [{ ...history(21), status: 'cancelled', cancel_reason: '<b>临时加班</b>' }] : first }));
    const { container } = render(<SessionHistoryPage boardTzOffsetHours={8} />);
    const firstLink = await screen.findByRole('link', { name: /五排1 · 已结算/ });
    expect(firstLink).toHaveAttribute('href', '/sessions/1');
    expect(firstLink).toHaveTextContent('10/26 周一 20:00');
    expect(firstLink).toHaveTextContent('准时 4 · 迟到 1');
    expect(firstLink).not.toHaveTextContent('没来 0');
    await userEvent.setup().click(screen.getByRole('button', { name: '加载更多' }));
    expect(await screen.findByText('阿杰：<b>临时加班</b>')).toBeInTheDocument();
    expect(container.querySelector('b')).toBeNull();
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual(['/api/sessions?scope=history', '/api/sessions?scope=history&before=20']);
    expect(screen.queryByRole('button', { name: '加载更多' })).not.toBeInTheDocument();
  });
  it('explains an older API which treats history as upcoming', async () => {
    const { attendance_summary: _summary, ...oldItem } = history(1);
    mock(() => json(200, { sessions: [oldItem] }));
    render(<SessionHistoryPage />);
    expect(await screen.findByText('这个服务器还不支持约局历史。')).toBeInTheDocument();
  });
  it('shows an empty first page', async () => {
    mock(() => json(200, { sessions: [] })); render(<SessionHistoryPage />);
    expect(await screen.findByText('还没有开过的局。')).toBeInTheDocument();
  });
  it('reports failure as status and retries', async () => {
    let broken = true; mock(() => broken ? json(500, { error: '失败' }) : json(200, { sessions: [history(1)] }));
    render(<SessionHistoryPage />);
    expect(await screen.findByRole('status')).toHaveTextContent('这块没加载出来，你的操作没丢。');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument(); broken = false;
    await userEvent.setup().click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('link', { name: /五排1/ })).toBeInTheDocument();
  });
  it('focuses the page title after the first response', async () => {
    let finish!: (reply: Response) => void;
    mock(() => new Promise<Response>((resolve) => { finish = resolve; }));
    render(<SessionHistoryPage />); screen.getByRole('button', { name: '返回' }).focus();
    await act(async () => finish(json(200, { sessions: [] })));
    await waitFor(() => expect(screen.getByRole('heading', { name: '约局历史' })).toHaveFocus());
  });
});
