import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RollCallPage } from '../../src/components/RollCallPage';
import { App } from '../../src/App';
import { writeDraft } from '../../src/lib/drafts';
import type { SessionDetail, User } from '../../src/types';

const HOUR = 3_600_000;
const ME: User = { id: 'org', username: '组织者', oauth_username: '组织者', avatar_url: null, is_participant: true,
  is_judge: false, is_admin: false, score: 100, created_at: '2026-10-01 00:00:00' };
function session(patch: Partial<SessionDetail> = {}): SessionDetail {
  return { id: 1, organizer: { id: ME.id, username: ME.username, avatar_url: null }, title: '五排', game: null,
    starts_at: new Date(Date.now() - 3 * HOUR).toISOString(), duration_min: null, capacity: null, note: null,
    status: 'open', settled_at: null, created_at: '2026-10-01 00:00:00',
    counts: { going: 2, invited: 0, maybe: 0, out: 0 }, my_rsvp: 'going',
    players: [{ user: { id: 'a', username: '阿飞', avatar_url: null }, rsvp: 'going', rsvp_at: '2026-10-01 00:00:00',
      attendance: null, late_minutes: null, attendance_note: null, record_id: null, is_participant: true }], ...patch };
}
function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) } as Response;
}
function mock(reply: (path: string, init?: RequestInit) => Response) {
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(reply(String(input), init)));
  vi.stubGlobal('fetch', fetch); return fetch;
}
afterEach(() => { vi.unstubAllGlobals(); });

describe('roll call page', () => {
  it.each([
    ['outsider', {}, { ...ME, id: 'other' }, '只有组织者和管理员能点名。'],
    ['not started', { starts_at: new Date(Date.now() + HOUR).toISOString() }, ME, '这局还没开始，开局后才能点名。'],
    ['settled', { status: 'settled' }, ME, '这局已经结算了。'],
    ['cancelled', { status: 'cancelled' }, ME, '这局已取消。'],
  ] as const)('refuses %s with a link to the session', async (_name, patch, me, message) => {
    mock(() => json(200, { session: session(patch), records: [] }));
    render(<RollCallPage sessionId={1} me={me} onChanged={vi.fn()} />);
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '回到这局' })).toHaveAttribute('href', '/sessions/1');
    expect(screen.queryByRole('button', { name: /保存点名/ })).not.toBeInTheDocument();
  });
  it('shows the session NotFound on 404', async () => {
    mock(() => json(404, { error: '不存在' })); render(<RollCallPage sessionId={1} me={ME} onChanged={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: '找不到这局，链接可能写错了。' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '回大厅' })).toBeInTheDocument();
  });
  it('permits an admin, restores the existing draft key and guards PageBar return with the same flow', async () => {
    mock(() => json(200, { session: session(), records: [] }));
    writeDraft('rollcall', 1, { a: { attendance: 'late', late_minutes: 12 } });
    render(<RollCallPage sessionId={1} me={{ ...ME, id: 'admin', is_admin: true }} onChanged={vi.fn()} />);
    expect(await screen.findByRole('spinbutton', { name: /阿飞 迟到分钟数/ })).toHaveValue(12);
    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: /点名/ })).toHaveLength(1);
    const back = screen.getByRole('button', { name: '返回' });
    await userEvent.setup().click(back);
    const confirm = screen.getByRole('group', { name: '点名还没提交，标记会留在这台设备上。' });
    expect(within(confirm).getByRole('button', { name: '继续点名' })).toHaveFocus();
    await userEvent.setup().click(within(confirm).getByRole('button', { name: '继续点名' }));
    expect(back).toHaveFocus();
    expect(localStorage.getItem('edg.draft.rollcall.1')).not.toBeNull();
  });
  it('saves marks under the same key, survives a remount and shares the cancel guard', async () => {
    mock(() => json(200, { session: session(), records: [] })); const user = userEvent.setup();
    const view = render(<RollCallPage sessionId={1} me={ME} onChanged={vi.fn()} />);
    const marks = await screen.findByRole('group', { name: '阿飞 出勤' });
    await user.click(within(marks).getByRole('button', { name: '准时' }));
    view.unmount();
    expect(JSON.parse(localStorage.getItem('edg.draft.rollcall.1')!).value).toEqual({ a: { attendance: 'on_time' } });
    render(<RollCallPage sessionId={1} me={ME} onChanged={vi.fn()} />);
    expect(within(await screen.findByRole('group', { name: '阿飞 出勤' })).getByRole('button', { name: '准时' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.getByRole('group', { name: '点名还没提交，标记会留在这台设备上。' })).toBeInTheDocument();
  });
  it('settles, then reads the session and records again before showing the summary', async () => {
    const s = session(); const changed = vi.fn(); let reads = 0;
    const settled = { ...s, status: 'settled', players: s.players.map((p) => ({ ...p, attendance: 'no_show' })) };
    const fetch = mock((path, init) => {
      if (path.endsWith('/rollcall')) return json(200, { session: s, drafts: [{ user_id: 'a', username: '阿飞',
        type: 'no_show', kind: 'penalty', range: { min: -20, max: -10, base: -15 }, suggested_claim: '没来', already_filed: false }] });
      if (path.endsWith('/settle')) return json(200, { session: settled, created: 1, skipped: 0 });
      reads += 1; return json(200, { session: reads === 1 ? s : settled, records: reads === 1 ? [] : [{ status: 'awaiting_statement' }] });
    });
    const user = userEvent.setup(); render(<RollCallPage sessionId={1} me={ME} onChanged={changed} />);
    await user.click(within(await screen.findByRole('group', { name: '阿飞 出勤' })).getByRole('button', { name: '没来' }));
    await user.click(screen.getByRole('button', { name: '保存点名（1 人）' }));
    expect(await screen.findByText('2/2')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /阿飞/ }));
    await user.click(screen.getByRole('button', { name: '确认立案（1）' }));
    expect(await screen.findByText('已结算 ✓')).toBeInTheDocument();
    expect(screen.getByText('已结算 · 没来 1 · 立案 1 起，等当事人说明')).toBeInTheDocument();
    expect(reads).toBe(2); expect(changed).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: '回到这局' })).toHaveAttribute('href', '/sessions/1');
    expect(localStorage.getItem('edg.draft.rollcall.1')).toBeNull();
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2);
  });
  it('notifies once when settlement succeeds even if the summary read fails, then retries without notifying again', async () => {
    const s = session(); const changed = vi.fn(); let reads = 0;
    const settled = { ...s, status: 'settled', players: s.players.map((p) => ({ ...p, attendance: 'on_time' })) };
    mock((path) => {
      if (path.endsWith('/rollcall')) return json(200, { session: s, drafts: [] });
      if (path.endsWith('/settle')) return json(200, { session: settled, created: 0, skipped: 0 });
      reads += 1;
      return reads === 2 ? json(500, { error: '暂时失败' }) : json(200, { session: reads === 1 ? s : settled, records: [] });
    });
    const user = userEvent.setup(); render(<RollCallPage sessionId={1} me={ME} onChanged={changed} />);
    await user.click(within(await screen.findByRole('group', { name: '阿飞 出勤' })).getByRole('button', { name: '准时' }));
    await user.click(screen.getByRole('button', { name: '保存点名（1 人）' }));
    await user.click(await screen.findByRole('button', { name: '跳过全部，仅记录出勤' }));
    expect(await screen.findByRole('button', { name: '重试' })).toBeInTheDocument();
    expect(changed).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('已结算 · 准时 1')).toBeInTheDocument();
    expect(reads).toBe(3); expect(changed).toHaveBeenCalledTimes(1);
  });
  it('the existing detail button navigates to the page', async () => {
    const s = session(); window.history.replaceState(null, '', '/sessions/1');
    mock((path) => {
      if (path === '/api/config') return json(200, { violations: [], tiers: [], weeklyHeal: 5, weeklyBonusCap: 5,
        statementWindowHours: 12, aiEnabled: false, maxBatchSubjects: 5, nextResetAt: '2026-11-01T16:00:00Z' });
      if (path === '/api/me') return json(200, { user: ME, pending: { statements: 0, appeals: 0 } });
      if (path === '/api/leaderboard') return json(200, { participants: [] });
      if (path === '/api/records?limit=50') return json(200, { records: [] });
      if (path === '/api/report/latest') return json(200, { report: null });
      if (path === '/api/sessions/1') return json(200, { session: s, records: [] });
      return json(200, { sessions: [] });
    });
    render(<App />); await userEvent.setup().click(await screen.findByRole('link', { name: '去点名' }));
    expect(window.location.pathname).toBe('/sessions/1/rollcall');
    expect(await screen.findByRole('heading', { name: '点名 · 五排' })).toBeInTheDocument();
  });
});
