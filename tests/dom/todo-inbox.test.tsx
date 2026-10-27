import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TodoInbox } from '../../src/components/TodoInbox';
import { App } from '../../src/App';
import { useTodoSources } from '../../src/lib/useTodoSources';
import { clearTodoMarks, dismissUnbound, markCancelledSeen, readSeenCancelled, readUnboundDismissed, SEEN_CANCELLED_KEY } from '../../src/lib/todoMarks';
import { writeDraft } from '../../src/lib/drafts';
import { emitSession } from '../../src/lib/sessionEvents';
import { TODO_SEEN_MAX } from '../../src/lib/constants';
import type { TodoItem } from '../../src/lib/todo';
import type { RecordItem, SessionDetail, User } from '../../src/types';
const NOW = Date.parse('2026-10-28T10:00:00Z');
const ME: User = { id: 'me', username: '我', oauth_username: '我', avatar_url: null, is_participant: true, is_judge: false,
  is_admin: false, score: 100, created_at: '2026-10-01 00:00:00' };
function session(patch: Partial<SessionDetail> = {}): SessionDetail {
  return { id: 1, organizer: { id: 'org', username: '阿飞', avatar_url: null }, title: '五排', game: '瓦', starts_at: new Date(NOW + 3_600_000).toISOString(),
    duration_min: 60, capacity: null, note: null, status: 'open', settled_at: null, created_at: new Date(NOW).toISOString(),
    counts: { going: 2, invited: 1, maybe: 0, out: 0 }, my_rsvp: 'invited', players: [], ...patch };
}
function record(patch: Partial<RecordItem> = {}): RecordItem {
  const ref = { id: 'org', username: '裁判', avatar_url: null };
  return { id: 7, subject: { ...ref, id: 'me', username: '我' }, reporter: ref, type: 'no_show', delta: 0, note: null,
    claim: '未到场', claim_summary: null, classified_by: 'human', escalation_suggested: false, session_id: null,
    statement: null, statement_at: null, appeal_reason: null, deadline_at: new Date(NOW + 3_600_000).toISOString(), status: 'awaiting_statement',
    verdict: null, range: { min: -20, max: -10, base: -15 }, created_at: new Date(NOW).toISOString(), ...patch };
}
function json(status: number, body: unknown): Response { return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) } as Response; }
function mock(reply: (path: string, init?: RequestInit) => Response) {
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(reply(String(input), init))); vi.stubGlobal('fetch', fetch); return fetch;
}
function show(items: TodoItem[] | null) {
  const callbacks = { onAnswer: vi.fn(), onOpenSession: vi.fn(), onOpenStatement: vi.fn(), onOpenNotify: vi.fn(), onSeenCancelled: vi.fn(), onDismissUnbound: vi.fn() };
  render(<TodoInbox items={items} now={NOW} busyId={null} error={null} {...callbacks} />); return callbacks;
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('todo inbox', () => {
  it('shows the exact empty state, and an accessible loading skeleton', () => {
    const view = render(<TodoInbox items={null} now={NOW} busyId={null} error={null} onAnswer={vi.fn()} onOpenSession={vi.fn()} onOpenStatement={vi.fn()}
      onOpenNotify={vi.fn()} onSeenCancelled={vi.fn()} onDismissUnbound={vi.fn()} />);
    expect(screen.getByText('要你处理加载中').closest('[aria-busy]')).toHaveAttribute('aria-busy', 'true'); view.unmount();
    show([]); expect(screen.getByText('没有待办，清清爽爽 ✨')).toBeInTheDocument();
  });
  it('shows statement context and the saved draft length, then opens that exact statement', async () => {
    const r = record(); writeDraft('statement', r.id, '已经写了');
    const callbacks = show([{ key: 'statement:7', kind: 'statement', record: r, urgent: true }]);
    expect(screen.getByText('裁判记了你一笔 · 放鸽子')).toBeInTheDocument(); expect(screen.getByText('草稿已存 · 写了 4 字')).toBeInTheDocument();
    expect(document.querySelector('.tcard--attention')).not.toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: '写说明 ›' })); expect(callbacks.onOpenStatement).toHaveBeenCalledWith(r);
  });
  it('links escalation and the earliest appeal to canonical case pages', () => {
    const r = record({ subject: { id: 'a/b', username: '阿飞', avatar_url: null } });
    show([{ key: 'escalation:7', kind: 'escalation', record: r }, { key: 'appeals', kind: 'appeals', count: 2, earliest: r }]);
    expect(screen.getByRole('link', { name: '去看看 ›' })).toHaveAttribute('href', '/players/a%2Fb/cases/7');
    expect(screen.getByRole('link', { name: '去审理 ›' })).toHaveAttribute('href', '/players/a%2Fb/cases/7');
  });
  it('opens existing settings for both delivery and binding cards', async () => {
    const callbacks = show([{ key: 'dm-broken', kind: 'dm-broken' }, { key: 'unbound', kind: 'unbound' }]); const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '去设置 ›' })); await user.click(screen.getByRole('button', { name: '去绑定 ›' }));
    expect(callbacks.onOpenNotify).toHaveBeenCalledTimes(2);
  });
  it('answers with the same session and removes the card on an emitted response, moving focus to its heading', async () => {
    const s = session(); const callbacks = show([{ key: 'invite:1', kind: 'invite', session: s }]); const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '来' })); expect(callbacks.onAnswer).toHaveBeenCalledWith(s, 'going');
    act(() => emitSession({ ...s, my_rsvp: 'going' }));
    expect(screen.queryByRole('group', { name: '报名 五排' })).not.toBeInTheDocument(); expect(screen.getByRole('heading', { name: '要你处理' })).toHaveFocus();
  });
  it('moved cards explain the former answer and render the original time with del', () => {
    show([{ key: 'moved:1', kind: 'moved', session: { ...session(), invite_reason: 'moved', prev_rsvp: 'out', prev_starts_at: '2026-10-27T12:00:00Z' } }]);
    expect(screen.getByText('你之前说「不来」，新时间还来吗？')).toBeInTheDocument(); expect(document.querySelector('del')).toBeInTheDocument();
    expect(screen.getByText('改时间了 · 阿飞的局')).toBeInTheDocument();
  });
  it.each([null, undefined])('never invents a former answer when moved context is %s', (prev_rsvp) => {
    show([{ key: 'moved:1', kind: 'moved', session: { ...session(), prev_rsvp, prev_starts_at: '2026-10-27T12:00:00Z' } }]);
    expect(screen.getByText('你之前说「未回应」，新时间还来吗？')).toBeInTheDocument();
  });
  it('disables coming when full and gives every described-by reference a real target', () => {
    show([{ key: 'invite:1', kind: 'invite', session: session({ capacity: 2 }) }]);
    const going = screen.getByRole('button', { name: '来' }); expect(going).toBeDisabled();
    expect(screen.getByRole('button', { name: '待定' })).toBeEnabled(); expect(screen.getByText('来 2/2 满了，可以先报待定。')).toBeInTheDocument();
    for (const node of document.querySelectorAll('[aria-describedby]')) {
      for (const id of node.getAttribute('aria-describedby')!.split(' ')) expect(document.getElementById(id)).not.toBeNull();
    }
  });
  it('removes an invitation by id when an event cancels it after moving its start time', () => {
    const s = session(); show([{ key: 'invite:1', kind: 'invite', session: s }]);
    act(() => emitSession({ ...s, starts_at: '2026-10-29T12:00:00Z', status: 'cancelled' }));
    expect(screen.getByText('没有待办，清清爽爽 ✨')).toBeInTheDocument();
  });
  it.each(['same time', 'new time'])('lets a fresh authoritative source restore a card at %s after an event hid the old source', (when) => {
    const s = session({ my_rsvp: 'going' }); const props = { now: NOW, busyId: null, error: null, onAnswer: vi.fn(), onOpenSession: vi.fn(),
      onOpenStatement: vi.fn(), onOpenNotify: vi.fn(), onSeenCancelled: vi.fn(), onDismissUnbound: vi.fn() };
    const view = render(<TodoInbox {...props} items={[{ key: 'soon:1', kind: 'soon', session: s }]} />);
    act(() => emitSession({ ...s, my_rsvp: 'out' })); expect(screen.getByText('没有待办，清清爽爽 ✨')).toBeInTheDocument();
    const fresh = { ...s, starts_at: when === 'same time' ? s.starts_at : '2026-10-29T12:00:00Z' };
    view.rerender(<TodoInbox {...props} items={[{ key: 'soon:1', kind: 'soon', session: fresh }]} />);
    expect(screen.getByRole('button', { name: '改成不来' })).toBeInTheDocument();
  });
  it('soon offers only the reversible out action and disappears once no longer going', async () => {
    const s = session({ my_rsvp: 'going' }); const callbacks = show([{ key: 'soon:1', kind: 'soon', session: s }]);
    await userEvent.setup().click(screen.getByRole('button', { name: '改成不来' })); expect(callbacks.onAnswer).toHaveBeenCalledWith(s, 'out');
    expect(screen.queryByRole('button', { name: '来' })).not.toBeInTheDocument(); act(() => emitSession({ ...s, my_rsvp: 'out' }));
    expect(screen.getByText('没有待办，清清爽爽 ✨')).toBeInTheDocument();
  });
  it('cancelled and unbound notifications have their explicit dismiss actions, excluded from the badge', async () => {
    const callbacks = show([{ key: 'cancelled:1', kind: 'cancelled', session: session({ status: 'cancelled', cancel_reason: '临时有事' }) }, { key: 'unbound', kind: 'unbound' }]);
    expect(screen.getByRole('heading', { name: '要你处理 · 0' })).toBeInTheDocument(); const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '知道了' })); expect(callbacks.onSeenCancelled).toHaveBeenCalledWith(1);
    await user.click(screen.getByRole('button', { name: '不再提示' })); expect(callbacks.onDismissUnbound).toHaveBeenCalledTimes(1);
  });
  it('keeps appeal counts when the detailed list failed, without a review button', () => {
    show([{ key: 'appeals', kind: 'appeals', count: 3, earliest: null }]);
    expect(screen.getByRole('heading', { name: '要你处理 · 3' })).toBeInTheDocument(); expect(screen.getByText('3 个申诉待复核')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '去审理 ›' })).not.toBeInTheDocument();
  });
});
describe('todo marks', () => {
  it('remembers bounded unique cancellations, unbound dismissal, and clears them on logout', () => {
    for (let id = 1; id <= TODO_SEEN_MAX + 2; id += 1) markCancelledSeen(id);
    markCancelledSeen(TODO_SEEN_MAX + 2); expect(readSeenCancelled()).toHaveLength(TODO_SEEN_MAX); expect(readSeenCancelled()[0]).toBe(3);
    dismissUnbound(); expect(readUnboundDismissed()).toBe(true); clearTodoMarks(); expect(readSeenCancelled()).toEqual([]); expect(readUnboundDismissed()).toBe(false);
  });
  it('treats broken storage values as empty and tolerates blocked storage', () => {
    localStorage.setItem(SEEN_CANCELLED_KEY, '{'); expect(readSeenCancelled()).toEqual([]);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readSeenCancelled()).toEqual([]); expect(readUnboundDismissed()).toBe(false); expect(() => { markCancelledSeen(1); dismissUnbound(); clearTodoMarks(); }).not.toThrow();
  });
});
describe('inbox supplemental sources', () => {
  it.each([404, 500])('does not invent settings information for discord status %s', async (status) => {
    mock(() => json(status, { error: 'failed' })); const { result } = renderHook(() => useTodoSources({ me: ME, pendingAppeals: 0, refreshKey: 0 }));
    await waitFor(() => expect(result.current.settled).toBe(true)); expect(result.current.discord).toBe(status === 404 ? undefined : 'error'); expect(result.current.appealed).toBeNull();
  });
  it('never exposes the former account status during the first render after identity changes', async () => {
    let reads = 0; const pending = new Promise<Response>(() => {});
    vi.stubGlobal('fetch', vi.fn(() => ++reads === 1 ? Promise.resolve(json(200, { link: { discord_username: 'A', linked_at: '', dm_ok: false } })) : pending));
    const snapshots: ReturnType<typeof useTodoSources>[] = [];
    const { result, rerender } = renderHook(({ me }) => { const value = useTodoSources({ me, pendingAppeals: 0, refreshKey: 0 }); snapshots.push(value); return value; }, { initialProps: { me: ME } });
    await waitFor(() => expect(result.current.settled).toBe(true)); expect(result.current.discord).toMatchObject({ dm_ok: false });
    snapshots.length = 0; rerender({ me: { ...ME, id: 'other' } });
    expect(snapshots.every((value) => value.discord === undefined && !value.settled)).toBe(true);
  });
  it('loads the exact appeals URL only when admin counts turn positive, and refetches for a refresh', async () => {
    const fetch = mock((path) => path.startsWith('/api/records') ? json(200, { records: [] }) : json(200, { link: null }));
    const admin = { ...ME, is_admin: true }; const { result, rerender } = renderHook(({ pending, refresh }) => useTodoSources({ me: admin, pendingAppeals: pending, refreshKey: refresh }), { initialProps: { pending: 0, refresh: 0 } });
    await waitFor(() => expect(result.current.settled).toBe(true)); expect(fetch.mock.calls.map(([path]) => path)).toEqual(['/api/me/discord']);
    rerender({ pending: 1, refresh: 0 }); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(fetch.mock.calls.map(([path]) => path)).toContain('/api/records?limit=50&status=appealed');
    rerender({ pending: 1, refresh: 1 }); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(5));
  });
});


describe('inbox and lobby integration', () => {
  it('dismisses cancelled and unbound notices persistently across a new App mount', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true }); vi.setSystemTime(NOW);
    mock((path) => {
      if (path === '/api/config') return json(200, { violations: [], tiers: [], weeklyHeal: 5, weeklyBonusCap: 5, statementWindowHours: 12, aiEnabled: false, maxBatchSubjects: 5, nextResetAt: '2026-11-01T16:00:00Z' });
      if (path === '/api/me') return json(200, { user: ME, pending: { statements: 0, appeals: 0 } });
      if (path === '/api/me/discord') return json(200, { link: null });
      if (path === '/api/leaderboard') return json(200, { participants: [ME] });
      if (path.startsWith('/api/records')) return json(200, { records: [] });
      if (path === '/api/report/latest') return json(200, { report: null });
      return json(200, { sessions: path === '/api/sessions?scope=mine' ? [session({ status: 'cancelled', my_rsvp: 'going' })] : [] });
    });
    const view = render(<App />); const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '知道了' })); await user.click(screen.getByRole('button', { name: '不再提示' }));
    expect(readSeenCancelled()).toEqual([1]); expect(readUnboundDismissed()).toBe(true); view.unmount();
    render(<App />); expect(await screen.findByText('没有待办，清清爽爽 ✨')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '知道了' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: '不再提示' })).not.toBeInTheDocument();
  });

  it.each([['来', 'going'], ['待定', 'maybe'], ['不来', 'out']] as const)('has one response control for the same session and sends starts_at on %s', async (label, rsvp) => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true }); vi.setSystemTime(NOW);
    let answered = false; const s = session();
    const fetch = mock((path, init) => {
      if (path === '/api/config') return json(200, { violations: [], tiers: [], weeklyHeal: 5, weeklyBonusCap: 5, statementWindowHours: 12, aiEnabled: false, maxBatchSubjects: 5, nextResetAt: '2026-11-01T16:00:00Z' });
      if (path === '/api/me') return json(200, { user: ME, pending: { statements: 0, appeals: 0 } });
      if (path === '/api/leaderboard') return json(200, { participants: [ME] });
      if (path === '/api/records?limit=50') return json(200, { records: [] });
      if (path === '/api/report/latest') return json(200, { report: null });
      if (path === '/api/me/discord') return json(404, { error: 'unsupported' });
      if (path === '/api/me/invites') return json(200, { sessions: answered ? [] : [s] });
      if (path === '/api/sessions?scope=upcoming') return json(200, { sessions: [{ ...s, my_rsvp: answered ? rsvp : 'invited' }] });
      if (path === '/api/sessions?scope=mine') return json(200, { sessions: [] });
      if (path === '/api/sessions/1/rsvp') { answered = true; return json(200, { session: { ...s, my_rsvp: rsvp } }); }
      return json(500, { error: 'unexpected' });
    });
    const view = render(<App />);
    const inbox = (await screen.findByRole('heading', { name: '要你处理 · 1' })).closest('section')!; expect(screen.getAllByRole('button', { name: '来' })).toHaveLength(1);
    await userEvent.setup().click(screen.getByRole('button', { name: label }));
    await waitFor(() => expect(within(inbox).queryByRole('group', { name: '报名 五排' })).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: '要你处理' })).toHaveFocus();
    expect(JSON.parse(String(fetch.mock.calls.find(([, init]) => init?.method === 'POST')![1]?.body))).toEqual({ rsvp, starts_at: s.starts_at });
    view.unmount(); vi.useRealTimers();
  });
});
