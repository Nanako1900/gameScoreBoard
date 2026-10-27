import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { INVITES_PER_ORGANIZER, MAX_INVITES, type Rsvp } from '@shared/attendance';
import { InviteSheet } from '../../src/components/InviteSheet';
import { SessionDetailDialog } from '../../src/components/SessionDetailDialog';
import { ToastProvider } from '../../src/components/Toast';
import { bootRouter } from '../../src/lib/router';
import type { Invitable, InvitableState } from '../../src/lib/useInvitable';
import type { InvitableUser, SessionDetail, SessionPlayer, User } from '../../src/types';
import { drainHistoryTraversals, overlayMarks } from './history';

// P2-1: 再叫几个人 — the minimal InviteSheet (P2 contract 4.6). Only Date is
// faked, as in organizer-actions; timers stay real.

const NOW = new Date(2026, 9, 28, 10, 0);
const at = (day: number, hour: number, minute = 0): string =>
  new Date(2026, 9, day, hour, minute).toISOString();
const START = at(28, 21);

interface Call {
  method: string;
  path: string;
  body: unknown;
}

function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(JSON.stringify(body)) } as Response;
}

/** Unrouted requests get a 500, so an extra request shows up as a failure. */
function mockFetch(routes: Record<string, (call: Call) => Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      const method = init?.method ?? 'GET';
      const call: Call = { method, path, body: init?.body ? JSON.parse(String(init.body)) : null };
      calls.push(call);
      const route = routes[`${method} ${path}`];
      return Promise.resolve(route ? route(call) : json(500, { error: `unrouted ${method} ${path}` }));
    }),
  );
  return calls;
}

const writes = (calls: Call[]): Call[] => calls.filter((c) => c.method !== 'GET');

function player(id: string, rsvp: Rsvp): SessionPlayer {
  return {
    user: { id, username: `玩家${id}`, avatar_url: null },
    rsvp,
    rsvp_at: '2026-10-27 00:00:00',
    attendance: null,
    late_minutes: null,
    attendance_note: null,
    record_id: null,
    is_participant: true,
  };
}

function makeSession(overrides: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: 1,
    organizer: { id: 'org', username: '组织者', avatar_url: null },
    title: '周五五排',
    game: null,
    starts_at: START,
    duration_min: null,
    capacity: null,
    note: null,
    status: 'open',
    settled_at: null,
    created_at: '2026-10-27 00:00:00',
    counts: { invited: 1, going: 2, maybe: 1, out: 1 },
    my_rsvp: 'going',
    players: [player('org', 'going'), player('a', 'going'), player('b', 'maybe'), player('c', 'out'), player('d', 'invited')],
    ...overrides,
  };
}

function friend(id: string, isParticipant = true): InvitableUser {
  return { id, username: `玩家${id}`, avatar_url: null, is_participant: isParticipant, last_played_with_me_at: null };
}

/** a is in (going), c said no; e is free on the board, f is a free friend off it. */
const FRIENDS: InvitableUser[] = [friend('a'), friend('c'), friend('e'), friend('f', false)];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('InviteSheet', () => {
  function renderSheet(state: InvitableState): { onInvited: Mock; reload: Mock; sheet: HTMLElement } {
    const onInvited = vi.fn();
    const reload = vi.fn();
    const invitable: Invitable = { state, reload };
    render(<InviteSheet session={makeSession()} invitable={invitable} onClose={() => {}} onInvited={onInvited} />);
    return { onInvited, reload, sheet: screen.getByRole('dialog', { name: '再叫几个人' }) };
  }

  it('groups people, and greys out who is already in or said no', () => {
    mockFetch({});
    const { sheet } = renderSheet({ kind: 'ready', users: FRIENDS });
    const board = within(sheet).getByRole('group', { name: '在榜的' });
    const others = within(sheet).getByRole('group', { name: '其他朋友（未上榜，不参与计分）' });
    const onBoard = within(board).getAllByRole('checkbox');
    expect(onBoard).toHaveLength(3); // in the server's order
    expect(onBoard[0]).toHaveAccessibleName('玩家a · 已在局里');
    expect(onBoard[1]).toHaveAccessibleName('玩家c · 说了不来');
    expect(onBoard[2]).toHaveAccessibleName('玩家e');
    expect(within(board).getByRole('checkbox', { name: '玩家a · 已在局里' })).toBeDisabled();
    expect(within(board).getByRole('checkbox', { name: '玩家c · 说了不来' })).toBeDisabled();
    expect(within(board).getByRole('checkbox', { name: '玩家e' })).toBeEnabled();
    expect(within(others).getByRole('checkbox', { name: '玩家f' })).toBeEnabled();
    expect(within(sheet).getByRole('button', { name: '叫人' })).toBeDisabled();
    expect(within(sheet).getByText('已选 0 人')).toBeInTheDocument();
  });

  it('says the rules, never who can be reached', () => {
    mockFetch({});
    const { sheet } = renderSheet({ kind: 'ready', users: FRIENDS });
    expect(
      within(sheet).getByText(
        `绑了 Discord 且开着私信的人会收到 Bot 私信；同一个人一天最多收到你 ${INVITES_PER_ORGANIZER} 条邀请私信。`,
      ),
    ).toBeInTheDocument();
    expect(within(sheet).getByText('没绑的人要自己上网页看，把链接发到群里最稳。')).toBeInTheDocument();
    expect(sheet).not.toHaveTextContent(/已绑|未绑定|能收到私信的/);
  });

  it(`stops at ${MAX_INVITES} people at once`, async () => {
    mockFetch({});
    const many = Array.from({ length: MAX_INVITES + 1 }, (_, i) => friend(`n${i}`));
    const user = userEvent.setup();
    const { sheet } = renderSheet({ kind: 'ready', users: many });
    const boxes = within(sheet).getAllByRole('checkbox');
    for (const box of boxes.slice(0, MAX_INVITES)) await user.click(box);
    expect(boxes[MAX_INVITES]).toBeDisabled();
    expect(boxes[0]).toBeEnabled(); // a picked one can still be dropped
    expect(within(sheet).getByText(`一次最多叫 ${MAX_INVITES} 人`)).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: `叫 ${MAX_INVITES} 人` })).toBeEnabled();
  });

  it('sends exactly { user_ids }, once, and hands the answer back', async () => {
    const answer = { session: makeSession(), added: 2, skipped: 0 };
    const calls = mockFetch({ 'POST /api/sessions/1/invite': () => json(200, answer) });
    const user = userEvent.setup();
    const { sheet, onInvited } = renderSheet({ kind: 'ready', users: FRIENDS });
    await user.click(within(sheet).getByRole('checkbox', { name: '玩家e' }));
    await user.click(within(sheet).getByRole('checkbox', { name: '玩家f' }));
    expect(within(sheet).getByText('已选 2 人')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: '叫 2 人' }));
    await waitFor(() => expect(onInvited).toHaveBeenCalledWith(answer));
    expect(writes(calls)).toEqual([
      { method: 'POST', path: '/api/sessions/1/invite', body: { user_ids: ['e', 'f'] } },
    ]);
  });

  it("shows the server's reason inside the sheet and stays open", async () => {
    mockFetch({ 'POST /api/sessions/1/invite': () => json(400, { error: '约局已开始，不能再叫人' }) });
    const user = userEvent.setup();
    const { sheet, onInvited } = renderSheet({ kind: 'ready', users: FRIENDS });
    await user.click(within(sheet).getByRole('checkbox', { name: '玩家e' }));
    await user.click(within(sheet).getByRole('button', { name: '叫 1 人' }));
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('约局已开始，不能再叫人');
    expect(within(sheet).getByRole('button', { name: '叫 1 人' })).toBeEnabled();
    expect(within(sheet).getByRole('checkbox', { name: '玩家e' })).toBeChecked();
    expect(onInvited).not.toHaveBeenCalled();
  });

  it('a list that did not load says so, without an alert, and offers 重试', async () => {
    mockFetch({});
    const user = userEvent.setup();
    const { sheet, reload } = renderSheet({ kind: 'error' });
    expect(within(sheet).getByRole('status')).toHaveTextContent('名单没加载出来，稍后再试。');
    expect(within(sheet).queryByRole('alert')).toBeNull();
    expect(within(sheet).queryByRole('checkbox')).toBeNull();
    await user.click(within(sheet).getByRole('button', { name: '重试' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('says when the list is still loading, or nobody else has logged in yet', () => {
    mockFetch({});
    const { unmount } = render(
      <InviteSheet
        session={makeSession()}
        invitable={{ state: { kind: 'loading' }, reload: () => {} }}
        onClose={() => {}}
        onInvited={() => {}}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('加载中…');
    unmount();
    render(
      <InviteSheet
        session={makeSession()}
        invitable={{ state: { kind: 'ready', users: [] }, reload: () => {} }}
        onClose={() => {}}
        onInvited={() => {}}
      />,
    );
    expect(
      screen.getByText('还没有别的朋友登录过。把链接发到群里，他们登录后就能在这里叫到。'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('group')).toBeNull();
  });
});

describe('再叫几个人 in the session dialog', () => {
  function makeUser(id: string, username: string, isAdmin = false): User {
    return {
      id,
      username,
      oauth_username: username,
      avatar_url: null,
      is_participant: true,
      is_judge: false,
      is_admin: isAdmin,
      score: 100,
      created_at: '2026-10-01 00:00:00',
    };
  }

  const ORGANIZER = makeUser('org', '组织者');
  const PLAYER = makeUser('p', '选手');
  const ADMIN = makeUser('admin', '管理员', true);
  const detail = (s: SessionDetail): Response => json(200, { session: s, records: [] });
  const friends = (): Response => json(200, { users: FRIENDS });
  const listRequests = (calls: Call[]): Call[] => calls.filter((c) => c.path === '/api/me/invitable');

  /** The dialog inside a ToastProvider, as App renders it. */
  function renderDialog(me: User | null): Mock {
    const onChanged = vi.fn();
    render(
      <ToastProvider>
        <SessionDetailDialog sessionId={1} me={me} onClose={() => {}} onChanged={onChanged} />
      </ToastProvider>,
    );
    return onChanged;
  }

  /** Let a response already on its way land (inside act: it sets state). */
  async function settle(): Promise<void> {
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  }

  it('the organizer gets ＋ 再叫几个人, first, before 改时间', async () => {
    mockFetch({ 'GET /api/sessions/1': () => detail(makeSession()), 'GET /api/me/invitable': friends });
    renderDialog(ORGANIZER);
    const entry = await screen.findByRole('button', { name: '再叫几个人' });
    expect(entry).toHaveTextContent('＋ 再叫几个人');
    const reschedule = screen.getByRole('button', { name: '改时间' });
    expect(entry.compareDocumentPosition(reschedule) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('an API without /api/me/invitable (404): no entry, and nothing said about it', async () => {
    const calls = mockFetch({
      'GET /api/sessions/1': () => detail(makeSession()),
      'GET /api/me/invitable': () => json(404, { error: 'Not Found' }),
    });
    renderDialog(ORGANIZER);
    expect(await screen.findByRole('button', { name: '改时间' })).toBeInTheDocument();
    await waitFor(() => expect(listRequests(calls)).toHaveLength(1));
    await settle();
    expect(screen.queryByRole('button', { name: '再叫几个人' })).toBeNull();
    expect(screen.queryByText(/名单/)).toBeNull();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it.each([
    ['a player', PLAYER, { my_rsvp: 'invited' as const }],
    ['a visitor', null, {}],
    ['the organizer, once it has started', ORGANIZER, { starts_at: at(28, 9) }],
    ['the organizer of a cancelled session', ORGANIZER, { status: 'cancelled' as const }],
  ])('%s: no list request, no entry', async (_who, me, overrides) => {
    const calls = mockFetch({ 'GET /api/sessions/1': () => detail(makeSession(overrides)), 'GET /api/me/invitable': friends });
    renderDialog(me);
    expect(await screen.findByRole('heading', { name: '周五五排' })).toBeInTheDocument();
    await settle();
    expect(listRequests(calls)).toEqual([]);
    expect(screen.queryByRole('button', { name: '再叫几个人' })).toBeNull();
  });

  it('inviting closes the sheet, shows who was asked, tells the lists and says so', async () => {
    const after = makeSession({
      counts: { invited: 3, going: 2, maybe: 1, out: 1 },
      players: [...makeSession().players, player('e', 'invited'), player('f', 'invited')],
    });
    const calls = mockFetch({
      'GET /api/sessions/1': () => detail(makeSession()),
      'GET /api/me/invitable': friends,
      'POST /api/sessions/1/invite': () => json(200, { session: after, added: 2, skipped: 0 }),
    });
    const user = userEvent.setup();
    const onChanged = renderDialog(ORGANIZER);
    await user.click(await screen.findByRole('button', { name: '再叫几个人' }));
    const sheet = screen.getByRole('dialog', { name: '再叫几个人' });
    await user.click(within(sheet).getByRole('checkbox', { name: '玩家e' }));
    await user.click(within(sheet).getByRole('checkbox', { name: '玩家f' }));
    await user.click(within(sheet).getByRole('button', { name: '叫 2 人' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '再叫几个人' })).toBeNull());
    expect(await screen.findByText('已叫 2 人。没绑 Discord 的朋友，记得在群里喊一声。')).toBeInTheDocument();
    expect(screen.getByText('玩家e')).toBeInTheDocument();
    expect(screen.getByText('玩家f')).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '再叫几个人' })).toHaveFocus();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(writes(calls)).toEqual([
      { method: 'POST', path: '/api/sessions/1/invite', body: { user_ids: ['e', 'f'] } },
    ]);
    expect(listRequests(calls)).toHaveLength(1);
  });

  it('nobody new: says so', async () => {
    mockFetch({
      'GET /api/sessions/1': () => detail(makeSession()),
      'GET /api/me/invitable': friends,
      'POST /api/sessions/1/invite': () => json(200, { session: makeSession(), added: 0, skipped: 1 }),
    });
    const user = userEvent.setup();
    renderDialog(ORGANIZER);
    await user.click(await screen.findByRole('button', { name: '再叫几个人' }));
    await user.click(screen.getByRole('checkbox', { name: '玩家e' }));
    await user.click(screen.getByRole('button', { name: '叫 1 人' }));
    expect(await screen.findByText('没有叫到新的人：选的人已经在局里了。')).toBeInTheDocument();
  });

  it('a list that failed to load keeps the entry; 重试 in the sheet asks again', async () => {
    let failing = true;
    const calls = mockFetch({
      'GET /api/sessions/1': () => detail(makeSession()),
      'GET /api/me/invitable': () => (failing ? json(500, { error: '服务器开小差了' }) : friends()),
    });
    const user = userEvent.setup();
    renderDialog(ORGANIZER);
    await user.click(await screen.findByRole('button', { name: '再叫几个人' }));
    const sheet = screen.getByRole('dialog', { name: '再叫几个人' });
    expect(within(sheet).getByRole('status')).toHaveTextContent('名单没加载出来，稍后再试。');
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    failing = false;
    await user.click(within(sheet).getByRole('button', { name: '重试' }));
    expect(await within(sheet).findByRole('checkbox', { name: '玩家e' })).toBeEnabled();
    expect(listRequests(calls)).toHaveLength(2);
  });

  it('the back button closes only the sheet', async () => {
    window.history.replaceState(null, '', '/');
    bootRouter();
    const calls = mockFetch({ 'GET /api/sessions/1': () => detail(makeSession()), 'GET /api/me/invitable': friends });
    const user = userEvent.setup();
    renderDialog(ORGANIZER);
    await user.click(await screen.findByRole('button', { name: '再叫几个人' }));
    expect(overlayMarks().sheet).toBe('invite');
    await act(async () => {
      window.history.back();
      await drainHistoryTraversals();
    });
    expect(screen.queryByRole('dialog', { name: '再叫几个人' })).toBeNull();
    expect(screen.getByRole('dialog', { name: '周五五排' })).toBeInTheDocument();
    expect(writes(calls)).toEqual([]);
  });

  it('an admin who was invited still has exactly one 来, and none in the sheet', async () => {
    mockFetch({ 'GET /api/sessions/1': () => detail(makeSession({ my_rsvp: 'invited' })), 'GET /api/me/invitable': friends });
    const user = userEvent.setup();
    renderDialog(ADMIN);
    await user.click(await screen.findByRole('button', { name: '再叫几个人' }));
    const sheet = screen.getByRole('dialog', { name: '再叫几个人' });
    expect(within(sheet).queryByRole('button', { name: '来' })).toBeNull();
    // The panel behind is inert while the sheet is up: count it too.
    expect(screen.getAllByRole('button', { name: '来', hidden: true })).toHaveLength(1);
  });
});
