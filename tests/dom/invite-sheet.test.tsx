import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { INVITES_PER_ORGANIZER, MAX_INVITES, type Rsvp } from '@shared/attendance';
import { InviteSheet } from '../../src/components/InviteSheet';
import type { Invitable, InvitableState } from '../../src/lib/useInvitable';
import type { InvitableUser, SessionDetail, SessionPlayer } from '../../src/types';

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
