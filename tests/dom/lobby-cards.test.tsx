import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancelSession, inviteToSession, setRsvp, updateSession } from '../../src/api';
import { emitSession, onSession, SESSION_EVENT } from '../../src/lib/sessionEvents';
import { useLobbySessions } from '../../src/lib/useLobbySessions';
import { useRsvpAnswer } from '../../src/lib/useRsvpAnswer';
import type { SessionDetail, User } from '../../src/types';
import { RsvpControl } from '../../src/components/RsvpControl';
import { SessionCard } from '../../src/components/SessionCard';
import { RosterGroups } from '../../src/components/RosterGroups';
import { RecentSessions } from '../../src/components/RecentSessions';
import { ToastProvider } from '../../src/components/Toast';
import { SessionsPanel } from '../../src/components/SessionsPanel';
import { SessionDetailDialog } from '../../src/components/SessionDetailDialog';
import { formatDateTime } from '../../src/lib/time';

const HOUR = 3_600_000;
const ME: User = { id: 'me', username: '我', oauth_username: '我', avatar_url: null, is_participant: true,
  is_judge: false, is_admin: false, score: 82, created_at: '2026-10-01 00:00:00' };
function session(patch: Partial<SessionDetail> = {}): SessionDetail {
  return { id: 1, organizer: { id: 'org', username: '阿杰', avatar_url: null }, title: '周五五排', game: '云顶',
    starts_at: new Date(Date.now() + HOUR).toISOString(), duration_min: null, capacity: 5, note: null,
    status: 'open', settled_at: null, created_at: '2026-10-01 00:00:00',
    counts: { invited: 1, going: 1, maybe: 0, out: 0 }, my_rsvp: 'invited', players: [], ...patch };
}
function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) } as Response;
}
function mockFetch(reply: (path: string, init?: RequestInit) => Response | Promise<Response>) {
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(reply(String(input), init)));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
afterEach(() => { vi.unstubAllGlobals(); });

describe('session synchronization and lobby reads', () => {
  it('emits returned sessions only after successful writes and unsubscribes', async () => {
    const s = session();
    mockFetch(() => json(200, { session: s, added: 1, skipped: 0 }));
    const listener = vi.fn(); const stop = onSession(listener);
    expect(SESSION_EVENT).toBe('edg:session');
    await setRsvp(1, 'going', s.starts_at); await updateSession(1, { game: '云顶' });
    await cancelSession(1); await inviteToSession(1, ['a']);
    expect(listener).toHaveBeenCalledTimes(4);
    expect(listener).toHaveBeenLastCalledWith(s);
    mockFetch(() => json(409, { error: '约局时间已经改了，请按新的时间重新确认' }));
    await expect(setRsvp(1, 'out', s.starts_at)).rejects.toMatchObject({ status: 409 });
    expect(listener).toHaveBeenCalledTimes(4);
    stop(); emitSession(s); expect(listener).toHaveBeenCalledTimes(4);
  });
  it('loads upcoming and mine without limits; mine failing is silent and events patch both', async () => {
    const s = session();
    const fetch = mockFetch((path) => path.endsWith('scope=mine') ? json(500, { error: '坏了' }) : json(200, { sessions: [s] }));
    const { result } = renderHook(() => useLobbySessions({ enabled: true, me: ME, refreshKey: 0 }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/sessions?scope=upcoming', '/api/sessions?scope=mine']);
    expect(result.current.failed).toBe(false); expect(result.current.mine).toBeNull();
    act(() => emitSession({ ...s, my_rsvp: 'going' }));
    expect(result.current.upcoming[0].my_rsvp).toBe('going');
  });
  it('keeps old rows after refresh failure and does not request when disabled', async () => {
    const s = session(); const fetch = mockFetch(() => json(200, { sessions: [s] }));
    const { result, rerender } = renderHook(({ enabled }) => useLobbySessions({ enabled, me: null, refreshKey: 0 }),
      { initialProps: { enabled: false } });
    expect(fetch).not.toHaveBeenCalled(); rerender({ enabled: true });
    await waitFor(() => expect(result.current.upcoming).toHaveLength(1));
    mockFetch(() => json(500, { error: '稍后再试' }));
    await act(() => result.current.reload());
    expect(result.current.failed).toBe(true); expect(result.current.upcoming).toEqual([s]);
  });
  it('RSVP uses the shown starts_at and refreshes before exposing a 409', async () => {
    const s = session(); let refreshed = false;
    const fetch = mockFetch(() => json(409, { error: '约局时间已经改了，请按新的时间重新确认' }));
    const reload = vi.fn(async () => { refreshed = true; });
    const { result } = renderHook(() => useRsvpAnswer({ reload }));
    await act(() => result.current.answer(s, 'going'));
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({ rsvp: 'going', starts_at: s.starts_at });
    expect(refreshed).toBe(true); expect(result.current.error).toBe('约局时间已经改了，请按新的时间重新确认');
    expect(result.current.busyId).toBeNull();
  });
  it('preserves mine during a refreshKey refresh failure, but clears it on an identity change', async () => {
    const s = session(); mockFetch(() => json(200, { sessions: [s] }));
    const { result, rerender } = renderHook(({ key, me }) => useLobbySessions({ enabled: true, me, refreshKey: key }),
      { initialProps: { key: 0, me: ME } });
    await waitFor(() => expect(result.current.mine).toEqual([s]));
    mockFetch(() => json(500, { error: '失败' })); rerender({ key: 1, me: ME });
    expect(result.current.mine).toEqual([s]);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.mine).toEqual([s]);
    rerender({ key: 1, me: { ...ME, id: 'another' } });
    await waitFor(() => expect(result.current.mine).toBeNull());
  });
  it('updates both successful lists by event, ignores obsolete loads and unsubscribes on unmount', async () => {
    const s = session(); const pending: ((res: Response) => void)[] = [];
    mockFetch(() => new Promise<Response>((resolve) => pending.push(resolve)));
    const { result, rerender, unmount } = renderHook(({ key }) => useLobbySessions({ enabled: true, me: ME, refreshKey: key }),
      { initialProps: { key: 0 } });
    rerender({ key: 1 });
    await act(async () => { pending[2](json(200, { sessions: [s] })); pending[3](json(200, { sessions: [s] })); });
    await act(async () => { pending[0](json(200, { sessions: [] })); pending[1](json(200, { sessions: [] })); });
    expect(result.current.mine).toEqual([s]);
    act(() => emitSession({ ...s, my_rsvp: 'going' }));
    expect(result.current.mine?.[0].my_rsvp).toBe('going'); expect(result.current.upcoming[0].my_rsvp).toBe('going');
    unmount(); act(() => emitSession({ ...s, my_rsvp: 'out' }));
    expect(result.current.upcoming[0].my_rsvp).toBe('going');
    const again = renderHook(() => useLobbySessions({ enabled: true, me: ME, refreshKey: 0 }));
    again.unmount();
    await act(async () => { pending[4](json(200, { sessions: [s] })); pending[5](json(200, { sessions: [s] })); });
    expect(again.result.current.upcoming).toEqual([]);
  });
  it('first replies have no undo; changing an answer restores the original starts_at', async () => {
    const s = session(); const fetch = mockFetch(() => json(200, { session: s })); const reload = vi.fn(async () => {});
    const { result } = renderHook(() => useRsvpAnswer({ reload }), { wrapper: ToastProvider });
    await act(() => result.current.answer(s, 'going'));
    expect(screen.getByText('已回复：来。开局前想改随时改。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '撤销' })).not.toBeInTheDocument();
    await act(() => result.current.answer({ ...s, my_rsvp: 'going' }, 'out'));
    await userEvent.setup().click(screen.getByRole('button', { name: '撤销' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(JSON.parse(String(fetch.mock.calls[2][1]?.body))).toEqual({ rsvp: 'going', starts_at: s.starts_at });
  });
});

describe('lobby and detail integration', () => {
  it('deduplicates mine and upcoming, and handledElsewhere suppresses the only answer group', async () => {
    const s = session(); const fetch = mockFetch(() => json(200, { sessions: [s] }));
    const { rerender } = render(<SessionsPanel me={ME} onOpenSession={vi.fn()} onCreate={vi.fn()} refreshKey={0} />);
    expect(await screen.findAllByRole('button', { name: '来' })).toHaveLength(1);
    expect(fetch.mock.calls.map(([url]) => url)).toContain('/api/sessions?scope=mine');
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    rerender(<SessionsPanel me={ME} onOpenSession={vi.fn()} onCreate={vi.fn()} refreshKey={0} handledElsewhere={new Set([1])} />);
    expect(screen.queryByRole('button', { name: '来' })).not.toBeInTheDocument();
    expect(screen.getByText('↑ 在「要你处理」里')).toBeInTheDocument();
    act(() => emitSession({ ...s, counts: { ...s.counts, going: 3 } }));
    expect(screen.getByText('来 3/5')).toBeInTheDocument();
  });
  it('mine 500 is invisible; upcoming failure uses status and retries without an alert', async () => {
    const s = session(); mockFetch((url) => url.endsWith('scope=mine') ? json(500, { error: 'mine失败' }) : json(200, { sessions: [s] }));
    const first = render(<SessionsPanel me={ME} onOpenSession={vi.fn()} onCreate={vi.fn()} refreshKey={0} />);
    await screen.findByText('周五五排'); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument(); first.unmount();
    mockFetch(() => json(500, { error: 'upcoming失败' }));
    render(<SessionsPanel me={null} onOpenSession={vi.fn()} onCreate={vi.fn()} refreshKey={0} />);
    expect(await screen.findByRole('status')).toHaveTextContent('这块没加载出来，你的操作没丢。');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    mockFetch(() => json(200, { sessions: [s] }));
    await userEvent.setup().click(screen.getByRole('button', { name: '重试' }));
    await screen.findByText('周五五排');
  });
  it('detail keeps its original header without offset and receives session events directly', async () => {
    const s = session(); const fetch = mockFetch(() => json(200, { session: s, records: [] }));
    render(<SessionDetailDialog sessionId={1} me={ME} onClose={vi.fn()} onChanged={vi.fn()} />);
    await screen.findByRole('heading', { name: s.title });
    expect(document.querySelector('.sdt__when')?.textContent).toBe(formatDateTime(s.starts_at));
    expect(screen.getByRole('group', { name: '你去吗？' })).toBeInTheDocument();
    act(() => emitSession({ ...s, title: '改后的局', status: 'cancelled', cancel_reason: '临时加班' }));
    expect(screen.getByRole('heading', { name: '改后的局' })).toBeInTheDocument();
    expect(screen.getByText('阿杰：临时加班')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('lobby card building blocks', () => {
  it('keeps RSVP button names exact; selection, descriptions and suggestion are separate', () => {
    const { rerender } = render(<RsvpControl value="going" label="报名 五排" onAnswer={vi.fn()} />);
    const going = screen.getByRole('button', { name: '来' });
    expect(going).toHaveAttribute('aria-pressed', 'true');
    expect(going).not.toHaveAttribute('aria-describedby');
    expect(going.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    rerender(<RsvpControl value="maybe" label="报名 五排" onAnswer={vi.fn()} goingClosed
      goingClosedNoteId="full" suggested="maybe" suggestedNoteId="hint" contextId="context" />);
    expect(screen.getByRole('button', { name: '来' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '来' })).toHaveAttribute('aria-describedby', 'context full');
    expect(screen.getByRole('button', { name: '待定' })).toHaveClass('sdt__rsvp-btn--suggested');
    expect(screen.getByRole('button', { name: '待定' })).toHaveAttribute('aria-describedby', 'context hint');
  });
  it.each([
    ['live', { starts_at: new Date(Date.now() - HOUR).toISOString() }, ME, false, '开局后不能改报名'],
    ['cancelled', { status: 'cancelled', cancel_reason: '<script>临时加班</script>' }, ME, false, '理由：<script>临时加班</script>'],
    ['organizer', { organizer: { id: 'me', username: '我', avatar_url: null } }, ME, false, '你组的局'],
    ['handled', {}, ME, true, '↑ 在「要你处理」里'],
    ['answered', { my_rsvp: 'going' }, ME, false, '改成不来'],
  ] as const)('%s has one action branch and no heading or scores', (_kind, patch, me, handled, text) => {
    const s = session(patch);
    const { container } = render(<ul><SessionCard session={s} me={me} now={Date.now()} handled={handled}
      onOpen={vi.fn()} onAnswer={vi.fn()} /></ul>);
    expect(screen.getByText(text, { exact: true })).toBeInTheDocument();
    expect(container.querySelector('h1,h2,h3,h4,h5,h6,script')).toBeNull();
    expect(screen.queryByRole('button', { name: '来' })).not.toBeInTheDocument();
    expect(screen.queryByText('82')).not.toBeInTheDocument();
  });
  it('a visitor signs in for this session; full sessions keep 待定 available', () => {
    const s = session({ capacity: 1 });
    const { rerender } = render(<ul><SessionCard session={s} me={null} now={Date.now()} onOpen={vi.fn()} /></ul>);
    expect(screen.getByRole('link', { name: '登录后报名 周五五排' })).toBeInTheDocument();
    rerender(<ul><SessionCard session={s} me={ME} now={Date.now()} onOpen={vi.fn()} onAnswer={vi.fn()} /></ul>);
    expect(screen.getByText('满员')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '来' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '待定' })).toBeEnabled();
  });
  it('roster groups list each name once, with neutral out and non-participant labels', () => {
    const players = (['going', 'maybe', 'invited', 'out'] as const).map((rsvp, i) => ({
      user: { id: i === 0 ? 'org' : String(i), username: `朋友${i}`, avatar_url: null }, rsvp,
      rsvp_at: '2026-10-26 12:00:00', attendance: null, attendance_note: null, late_minutes: null,
      record_id: null, is_participant: i !== 2,
    }));
    render(<RosterGroups session={session({ players })} />);
    expect(screen.getByRole('heading', { name: '谁会来' })).toBeInTheDocument();
    for (const p of players) expect(screen.getAllByText(p.user.username, { exact: true })).toHaveLength(1);
    expect(screen.getByText('· 组局')).toBeInTheDocument();
    expect(screen.getByText('· 未上榜')).toBeInTheDocument();
    expect(screen.getByText('提前说了')).toBeInTheDocument();
    expect(screen.queryByText(/分数|段位|Discord/)).not.toBeInTheDocument();
  });
  it('recent sessions are lazy, read past without limit and never offer RSVP', async () => {
    const fetch = mockFetch(() => json(200, { sessions: [session({ status: 'settled' })] }));
    const user = userEvent.setup();
    const { rerender } = render(<RecentSessions refreshKey={0} onOpenSession={vi.fn()} />);
    expect(fetch).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '最近结束' }));
    await screen.findByText('周五五排');
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/sessions?scope=past']);
    expect(screen.queryByRole('button', { name: '来' })).not.toBeInTheDocument();
    rerender(<RecentSessions refreshKey={1} onOpenSession={vi.fn()} />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });
});
