import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { Rsvp } from '@shared/attendance';
import { RescheduleSheet } from '../../src/components/RescheduleSheet';
import { SessionDetailDialog } from '../../src/components/SessionDetailDialog';
import { ToastProvider } from '../../src/components/Toast';
import type { SessionDetail, SessionPlayer, User } from '../../src/types';

// P0-6: 改时间 and 取消这局 inside the existing session dialog, and what an
// answer says back. Only Date is faked — pinned to a local Wednesday morning so
// quickSlots() is the same list on every machine; timers stay real.

const NOW = new Date(2026, 9, 28, 10, 0);
const at = (day: number, hour: number, minute = 0): string =>
  new Date(2026, 9, day, hour, minute).toISOString();
const START = at(28, 21); // 今晚 21:00

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
    my_rsvp: null,
    players: [
      player('org', 'going'),
      player('a', 'going'),
      player('b', 'maybe'),
      player('c', 'out'),
      player('d', 'invited'),
    ],
    ...overrides,
  };
}

const detail = (s: SessionDetail): Response => json(200, { session: s, records: [] });

/** The dialog inside a ToastProvider, as App renders it. */
function renderDialog(me: User): Mock {
  const onChanged = vi.fn();
  render(
    <ToastProvider>
      <SessionDetailDialog sessionId={1} me={me} onClose={() => {}} onChanged={onChanged} />
    </ToastProvider>,
  );
  return onChanged;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('RescheduleSheet', () => {
  function renderSheet(): { onClose: Mock; onRescheduled: Mock; sheet: HTMLElement } {
    const onClose = vi.fn();
    const onRescheduled = vi.fn();
    render(<RescheduleSheet session={makeSession()} onClose={onClose} onRescheduled={onRescheduled} />);
    return { onClose, onRescheduled, sheet: screen.getByRole('dialog', { name: '改到什么时候？' }) };
  }

  it('starts on 先不改, shows the current time as local, and never offers it again', () => {
    mockFetch({});
    const { sheet } = renderSheet();
    expect(within(sheet).getByRole('button', { name: '先不改' })).toHaveFocus();
    expect(within(sheet).getByText(/^现在：/)).toHaveTextContent('现在：10月28日 21:00 周三（本地时间）');
    expect(within(sheet).queryByRole('radio', { name: '今晚 21:00' })).toBeNull();
    expect(within(sheet).getByRole('radio', { name: '今晚 20:00' })).toBeChecked();
    expect(within(sheet).getByRole('button', { name: '改到 今晚 20:00' })).toBeInTheDocument();
  });

  it('says what the move does before doing it', () => {
    mockFetch({});
    const { sheet } = renderSheet();
    expect(within(sheet).getByText('改到 今晚 20:00 之后：')).toBeInTheDocument();
    expect(within(sheet).getByText('已回复的 3 人要重新确认（说过不来的也要重新回答）')).toBeInTheDocument();
    expect(
      within(sheet).getByText('局里每个人约 3 分钟后收到一条「约局改时间了」私信，连改几次也只发一条'),
    ).toBeInTheDocument();
    expect(within(sheet).getByText('开局提醒和点名提醒会跟着改')).toBeInTheDocument();
  });

  it('moves it with one PATCH of starts_at only', async () => {
    const moved = makeSession({ starts_at: at(28, 22) });
    const calls = mockFetch({ 'PATCH /api/sessions/1': () => json(200, { session: moved }) });
    const user = userEvent.setup();
    const { sheet, onRescheduled } = renderSheet();
    await user.click(within(sheet).getByRole('radio', { name: '今晚 22:00' }));
    expect(within(sheet).getByText('改到 今晚 22:00 之后：')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: '改到 今晚 22:00' }));
    await waitFor(() => expect(onRescheduled).toHaveBeenCalledWith(moved));
    expect(writes(calls)).toEqual([
      { method: 'PATCH', path: '/api/sessions/1', body: { starts_at: at(28, 22) } },
    ]);
  });

  it('先不改 closes without a request', async () => {
    const calls = mockFetch({});
    const user = userEvent.setup();
    const { sheet, onClose } = renderSheet();
    await user.click(within(sheet).getByRole('button', { name: '先不改' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);
  });

  it('takes 其他时间 as local wall-clock time and refuses an empty one', async () => {
    const calls = mockFetch({
      'PATCH /api/sessions/1': () => json(200, { session: makeSession({ starts_at: at(30, 20, 30) }) }),
    });
    const user = userEvent.setup();
    const { sheet } = renderSheet();
    // The ▸ / ▾ is decoration: the name stays 其他时间, the state is aria-expanded.
    const toggle = within(sheet).getByRole('button', { name: '其他时间' });
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const input = within(sheet).getByLabelText('自定义开始时间');
    expect(input).toHaveValue('2026-10-28T11:00');
    fireEvent.change(input, { target: { value: '' } });
    await user.click(within(sheet).getByRole('button', { name: '改时间' }));
    expect(within(sheet).getByRole('alert')).toHaveTextContent('选一个时间');
    fireEvent.change(input, { target: { value: '2026-10-30T20:30' } });
    await user.click(within(sheet).getByRole('button', { name: '改到 周五 20:30' }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0].body).toEqual({ starts_at: at(30, 20, 30) });
  });

  it("shows the server's reason in the sheet and stays open", async () => {
    mockFetch({ 'PATCH /api/sessions/1': () => json(400, { error: '约局已开始，不能再修改' }) });
    const user = userEvent.setup();
    const { sheet, onRescheduled } = renderSheet();
    await user.click(within(sheet).getByRole('button', { name: '改到 今晚 20:00' }));
    expect(await within(sheet).findByRole('alert')).toHaveTextContent('约局已开始，不能再修改');
    expect(within(sheet).getByRole('button', { name: '改到 今晚 20:00' })).toBeEnabled();
    expect(onRescheduled).not.toHaveBeenCalled();
  });
});

describe('改时间 in the session dialog', () => {
  it('opens over the dialog; Escape closes only the sheet', async () => {
    const calls = mockFetch({ 'GET /api/sessions/1': () => detail(makeSession()) });
    const user = userEvent.setup();
    renderDialog(ORGANIZER);
    await user.click(await screen.findByRole('button', { name: '改时间' }));
    expect(screen.getByRole('dialog', { name: '改到什么时候？' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: '改到什么时候？' })).toBeNull();
    expect(screen.getByRole('dialog', { name: '周五五排' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '改时间' })).toHaveFocus();
    expect(writes(calls)).toEqual([]);
  });

  it('after a move the dialog shows the new time, tells the lists, and says so', async () => {
    const moved = makeSession({
      starts_at: at(28, 22),
      counts: { invited: 4, going: 1, maybe: 0, out: 0 },
      players: [
        player('org', 'going'),
        player('a', 'invited'),
        player('b', 'invited'),
        player('c', 'invited'),
        player('d', 'invited'),
      ],
    });
    const calls = mockFetch({
      'GET /api/sessions/1': () => detail(makeSession()),
      'PATCH /api/sessions/1': () => json(200, { session: moved }),
    });
    const user = userEvent.setup();
    const onChanged = renderDialog(ORGANIZER);
    await user.click(await screen.findByRole('button', { name: '改时间' }));
    const sheet = screen.getByRole('dialog', { name: '改到什么时候？' });
    await user.click(within(sheet).getByRole('radio', { name: '今晚 22:00' }));
    await user.click(within(sheet).getByRole('button', { name: '改到 今晚 22:00' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '改到什么时候？' })).toBeNull());
    expect(screen.getByText('10月28日 22:00 周三')).toBeInTheDocument();
    expect(await screen.findByText('已改到 今天 22:00。')).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '改时间' })).toHaveFocus();
    expect(writes(calls)).toHaveLength(1);
  });
});

describe('who manages it', () => {
  it('a player gets neither 改时间 nor 取消这局', async () => {
    mockFetch({ 'GET /api/sessions/1': () => detail(makeSession({ my_rsvp: 'invited' })) });
    renderDialog(PLAYER);
    expect(await screen.findByRole('button', { name: '来' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '改时间' })).toBeNull();
    expect(screen.queryByRole('button', { name: '取消这局' })).toBeNull();
  });

  it('an admin who is not the organizer gets both, and can still answer', async () => {
    mockFetch({ 'GET /api/sessions/1': () => detail(makeSession({ my_rsvp: 'invited' })) });
    renderDialog(ADMIN);
    const reschedule = await screen.findByRole('button', { name: '改时间' });
    const cancel = screen.getByRole('button', { name: '取消这局' });
    // 取消这局 comes last (spec §3.5): after 改时间 in DOM order, which is the visual order.
    expect(reschedule.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('button', { name: '来' })).toBeInTheDocument();
  });

  it('once it has started there is only 现在点名', async () => {
    mockFetch({ 'GET /api/sessions/1': () => detail(makeSession({ starts_at: at(28, 9) })) });
    renderDialog(ORGANIZER);
    expect(await screen.findByRole('link', { name: '现在点名' })).toHaveAttribute('href', '/sessions/1/rollcall');
    expect(screen.queryByRole('button', { name: '改时间' })).toBeNull();
    expect(screen.queryByRole('button', { name: '取消这局' })).toBeNull();
  });
  it('after the expected end there is a 去点名 link', async () => {
    mockFetch({ 'GET /api/sessions/1': () => detail(makeSession({ starts_at: at(27, 21) })) });
    renderDialog(ORGANIZER);
    expect(await screen.findByRole('link', { name: '去点名' })).toHaveAttribute('href', '/sessions/1/rollcall');
    expect(screen.queryByRole('button', { name: '改时间' })).toBeNull();
    expect(screen.queryByRole('button', { name: '取消这局' })).toBeNull();
  });

});

describe('取消这局', () => {
  it('asks in place with focus on 不取消了, and backing out sends nothing', async () => {
    const calls = mockFetch({ 'GET /api/sessions/1': () => detail(makeSession()) });
    const user = userEvent.setup();
    renderDialog(ORGANIZER);
    await user.click(await screen.findByRole('button', { name: '取消这局' }));
    const confirm = screen.getByRole('group', { name: '取消这局？' });
    expect(
      within(confirm).getByText('会私信通知说了来、待定的人，以及收到过邀请还没回的人；说了不来的人不会收到。'),
    ).toBeInTheDocument();
    expect(within(confirm).getAllByRole('button').map((b) => b.textContent)).toEqual(['不取消了', '确认取消']);
    expect(within(confirm).getByRole('button', { name: '不取消了' })).toHaveFocus();
    await user.click(within(confirm).getByRole('button', { name: '不取消了' }));
    expect(screen.queryByRole('group', { name: '取消这局？' })).toBeNull();
    expect(screen.getByRole('button', { name: '取消这局' })).toHaveFocus();
    expect(writes(calls)).toEqual([]);
  });

  it('confirming cancels at once: one POST, a toast, focus on the title', async () => {
    let cancelled = false;
    const calls = mockFetch({
      'GET /api/sessions/1': () => detail(makeSession({ status: cancelled ? 'cancelled' : 'open' })),
      'POST /api/sessions/1/cancel': () => {
        cancelled = true;
        return json(200, { session: makeSession({ status: 'cancelled' }) });
      },
    });
    const user = userEvent.setup();
    const onChanged = renderDialog(ORGANIZER);
    await user.click(await screen.findByRole('button', { name: '取消这局' }));
    await user.click(screen.getByRole('button', { name: '确认取消' }));
    expect(await screen.findByText('这局已取消。')).toBeInTheDocument();
    expect(writes(calls)).toEqual([{ method: 'POST', path: '/api/sessions/1/cancel', body: null }]);
    expect(onChanged).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('heading', { name: '周五五排' })).toHaveFocus());
    expect(screen.queryByRole('button', { name: '取消这局' })).toBeNull();
  });

  it('a refused cancel keeps the confirm and shows why', async () => {
    mockFetch({
      'GET /api/sessions/1': () => detail(makeSession()),
      'POST /api/sessions/1/cancel': () => json(400, { error: '已结算的约局不能取消' }),
    });
    const user = userEvent.setup();
    renderDialog(ORGANIZER);
    await user.click(await screen.findByRole('button', { name: '取消这局' }));
    await user.click(screen.getByRole('button', { name: '确认取消' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('已结算的约局不能取消');
    expect(screen.getByRole('group', { name: '取消这局？' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认取消' })).toBeEnabled();
  });
});

describe('answering in the dialog', () => {
  /** GETs reflect the last answer POSTed. */
  function stubAnswers(first: Rsvp, extra: Partial<SessionDetail> = {}): Call[] {
    let mine: Rsvp = first;
    return mockFetch({
      'GET /api/sessions/1': () => detail(makeSession({ ...extra, my_rsvp: mine })),
      'POST /api/sessions/1/rsvp': (call) => {
        mine = (call.body as { rsvp: Rsvp }).rsvp;
        return json(200, { session: makeSession({ ...extra, my_rsvp: mine }) });
      },
    });
  }

  it('says what an answer means, without an alert', async () => {
    stubAnswers('invited');
    renderDialog(PLAYER);
    expect(await screen.findByRole('button', { name: '来' })).toBeEnabled();
    expect(screen.getByText('来 = 承诺，没来会被记一笔；待定不算承诺。')).toBeInTheDocument();
    expect(screen.getByText('开局前说不来，点名结算不会记你。')).toBeInTheDocument();
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('a first answer gets a note and no undo (invited cannot be restored)', async () => {
    const calls = stubAnswers('invited');
    const user = userEvent.setup();
    renderDialog(PLAYER);
    await user.click(await screen.findByRole('button', { name: '来' }));
    expect(await screen.findByText('已回复：来。开局前想改随时改。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '撤销' })).toBeNull();
    expect(writes(calls)).toEqual([
      { method: 'POST', path: '/api/sessions/1/rsvp', body: { rsvp: 'going', starts_at: START } },
    ]);
  });

  it('switching answers says 已改成 and offers 撤销', async () => {
    stubAnswers('maybe');
    const user = userEvent.setup();
    renderDialog(PLAYER);
    await user.click(await screen.findByRole('button', { name: '来' }));
    expect(await screen.findByText('已改成：来')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '撤销' })).toBeInTheDocument();
  });

  it('changing to 不来 can be undone back to the previous answer', async () => {
    const calls = stubAnswers('maybe');
    const user = userEvent.setup();
    const onChanged = renderDialog(PLAYER);
    await user.click(await screen.findByRole('button', { name: '不来' }));
    expect(await screen.findByText('收到，提前说了点名就不会记你 👍')).toBeInTheDocument();
    expect(writes(calls)).toHaveLength(1); // offered, not sent
    await user.click(screen.getByRole('button', { name: '撤销' }));
    expect(await screen.findByText('已撤销')).toBeInTheDocument();
    expect(writes(calls).map((c) => c.body)).toEqual([
      { rsvp: 'out', starts_at: START },
      { rsvp: 'maybe', starts_at: START },
    ]);
    await waitFor(() => expect(screen.getByRole('button', { name: '待定' })).toHaveAttribute('aria-pressed', 'true'));
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it('a full session closes 来 and says what to do instead', async () => {
    stubAnswers('invited', { capacity: 2, counts: { invited: 1, going: 2, maybe: 0, out: 0 } });
    renderDialog(PLAYER);
    const going = await screen.findByRole('button', { name: '来' });
    expect(going).toBeDisabled();
    expect(going).toHaveAccessibleDescription('来 2/2 满了，可以先报待定。');
    expect(screen.getByRole('button', { name: '待定' })).toBeEnabled();
    expect(screen.getByText('来 2/2 满了，可以先报待定。')).toBeInTheDocument();
  });

  it('someone already going keeps 来 when it is full', async () => {
    stubAnswers('going', { capacity: 2, counts: { invited: 1, going: 2, maybe: 0, out: 0 } });
    renderDialog(PLAYER);
    expect(await screen.findByRole('button', { name: '来' })).toBeEnabled();
    expect(screen.queryByText(/满了/)).toBeNull();
  });
});
