import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import type { PublicUser, User } from '../../src/types';

// P0-3: a failed refresh keeps the page, coming back to the tab refetches (but
// not /api/config), passing nextResetAt refetches config, and the tab title
// carries the to-do count.

interface Call {
  method: string;
  path: string;
}

type Route = () => Response | Promise<Response>;

function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(JSON.stringify(body)) } as Response;
}

function mockFetch(routes: Record<string, Route>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      const method = init?.method ?? 'GET';
      calls.push({ method, path });
      const route = routes[`${method} ${path}`];
      return Promise.resolve(route ? route() : json(500, { error: `unrouted ${method} ${path}` }));
    }),
  );
  return calls;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const gets = (calls: Call[], path: string): number =>
  calls.filter((c) => c.method === 'GET' && c.path === path).length;

const START = Date.parse('2026-10-26T12:00:00.000Z');
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const RESET = '2026-11-01T16:00:00.000Z';

const PLAYER: PublicUser = {
  id: 'p',
  username: '阿杰',
  avatar_url: null,
  is_participant: true,
  is_judge: false,
  score: 90,
  created_at: '2026-10-01 00:00:00',
};
const ROW = '第 1 名 阿杰，90 分';
const ADMIN: User = {
  id: 'a',
  username: '管理',
  oauth_username: 'a',
  avatar_url: null,
  is_participant: true,
  is_judge: true,
  is_admin: true,
  score: 100,
  created_at: '2026-10-01 00:00:00',
};

function config(nextResetAt: string): unknown {
  return {
    violations: [],
    tiers: [],
    weeklyHeal: 5,
    weeklyBonusCap: 5,
    statementWindowHours: 12,
    aiEnabled: false,
    maxBatchSubjects: 5,
    nextResetAt,
  };
}

function routes(overrides: Record<string, Route> = {}): Record<string, Route> {
  return {
    'GET /api/config': () => json(200, config(RESET)),
    'GET /api/leaderboard': () => json(200, { participants: [PLAYER] }),
    'GET /api/records?limit=50': () => json(200, { records: [] }),
    'GET /api/me': () => json(200, { user: null, pending: { statements: 0, appeals: 0 } }),
    'GET /api/report/latest': () => json(200, { report: null }),
    'GET /api/sessions?scope=upcoming': () => json(200, { sessions: [] }),
    ...overrides,
  };
}

const clock = (): string => document.querySelector('.hdr__reset-time')?.textContent ?? '';

let visibility: DocumentVisibilityState = 'visible';

/** Leave the tab and come back (the hidden event alone never refetches). */
function leaveAndReturn(): void {
  for (const next of ['hidden', 'visible'] as const) {
    visibility = next;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
  }
}

beforeEach(() => {
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'visibilityState');
  window.history.replaceState(null, '', '/');
});

describe('App — the header countdown', () => {
  it('ticks by the minute and reads 回血中… once the reset has passed', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
      shouldAdvanceTime: true,
    });
    vi.setSystemTime(START);
    mockFetch(routes({ 'GET /api/config': () => json(200, config(new Date(START + 30_000).toISOString())) }));
    render(<App />);
    await screen.findByRole('button', { name: ROW });
    expect(clock()).toBe('00:01');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MINUTE + 1_000);
    });
    expect(clock()).toBe('回血中…');
    await settle();
  });
});

describe('App — first load', () => {
  it('signed out: requests exactly the URLs it always did', async () => {
    const calls = mockFetch(routes());
    render(<App />);
    await screen.findByRole('button', { name: ROW });
    await settle();
    expect(new Set(calls.map((c) => `${c.method} ${c.path}`))).toEqual(
      new Set([
        'GET /api/config',
        'GET /api/leaderboard',
        'GET /api/records?limit=50',
        'GET /api/me',
        'GET /api/report/latest',
        'GET /api/sessions?scope=upcoming',
      ]),
    );
  });
});

const REPORT = {
  week_start: '2026-10-19',
  stats: {
    weekStart: '2026-10-19',
    weekEnd: '2026-10-25',
    sessionsPlayed: 1,
    sessionsCollapsed: 0,
    casesFiled: 0,
    totalPenalty: 0,
    absentVerdicts: 0,
    attendanceRate: null,
    upcomingNextWeek: 0,
    star: null,
    pigeon: null,
    bestTalker: null,
    harshest: null,
    topOrganizer: null,
  },
  narrative: '平平无奇的一周。',
  source: 'fallback',
  created_at: '2026-10-26 02:31:00',
};
const REGENERATE = 'POST /api/admin/report/2026-10-19/regenerate';

/** Signed in as the admin, with last week's report on the page. */
function adminRoutes(overrides: Record<string, Route> = {}): Record<string, Route> {
  return routes({
    'GET /api/me': () => json(200, { user: ADMIN, pending: { statements: 0, appeals: 0 } }),
    'GET /api/me/invites': () => json(200, { sessions: [] }),
    'GET /api/report/latest': () => json(200, { report: REPORT }),
    ...overrides,
  });
}

describe('App — after an admin write', () => {
  it('设为裁判 invalidates the board, the feed and me — not config or the report', async () => {
    const calls = mockFetch(
      adminRoutes({
        'GET /api/users/p': () => json(200, { user: PLAYER, records: [], history: [] }),
        'POST /api/admin/users/p': () => json(200, { ok: true }),
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: ROW }));
    await user.click(await screen.findByRole('button', { name: '设为裁判' }));
    await waitFor(() => expect(gets(calls, '/api/leaderboard')).toBe(2));
    await waitFor(() => expect(gets(calls, '/api/records?limit=50')).toBe(2));
    await waitFor(() => expect(gets(calls, '/api/me')).toBe(2));
    await settle();
    expect(gets(calls, '/api/config')).toBe(1);
    expect(gets(calls, '/api/report/latest')).toBe(1);
  });
});

describe('App — the admin re-rolls the weekly report', () => {
  it('换个说法 refetches the report only', async () => {
    const calls = mockFetch(adminRoutes({ [REGENERATE]: () => json(200, { report: REPORT }) }));
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: '换个说法' }));
    await waitFor(() => expect(gets(calls, '/api/report/latest')).toBe(2));
    // While it runs the button reads 重写中…; it is back once the report is in.
    await waitFor(() => expect(screen.getByRole('button', { name: '换个说法' })).toBeEnabled());
    expect(gets(calls, '/api/leaderboard')).toBe(1);
    expect(gets(calls, '/api/config')).toBe(1);
    expect(gets(calls, '/api/sessions?scope=upcoming')).toBe(1);
  });

  it('a failed re-roll says so in a toast — never an alert — and the button comes back', async () => {
    mockFetch(adminRoutes({ [REGENERATE]: () => json(500, { error: 'AI 超时了' }) }));
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: '换个说法' }));
    const message = await screen.findByText('战报没换成新说法：AI 超时了');
    expect(message.closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '换个说法' })).toBeEnabled());
  });
});

describe('App — coming back to the tab', () => {
  it('refetches after more than 60 s — board, feed, me and sessions, never config', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(START);
    const calls = mockFetch(routes());
    render(<App />);
    await screen.findByRole('button', { name: ROW });
    await settle();

    vi.setSystemTime(START + 30_000);
    leaveAndReturn();
    await settle();
    expect(gets(calls, '/api/leaderboard')).toBe(1);

    vi.setSystemTime(START + MINUTE + 1_000);
    leaveAndReturn();
    await waitFor(() => expect(gets(calls, '/api/leaderboard')).toBe(2));
    await waitFor(() => expect(gets(calls, '/api/sessions?scope=upcoming')).toBe(2));
    expect(gets(calls, '/api/records?limit=50')).toBe(2);
    expect(gets(calls, '/api/me')).toBe(2);
    expect(gets(calls, '/api/config')).toBe(1);
    expect(gets(calls, '/api/report/latest')).toBe(1);
  });
});

describe('App — a refresh that fails', () => {
  it('keeps the board on screen and says so with role=status, not an alert; 重试 clears it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(START);
    let failing = false;
    const fail = (ok: () => Response): Route => () => (failing ? json(500, { error: 'boom' }) : ok());
    const calls = mockFetch(
      routes({
        'GET /api/leaderboard': fail(() => json(200, { participants: [PLAYER] })),
        'GET /api/records?limit=50': fail(() => json(200, { records: [] })),
        'GET /api/me': fail(() => json(200, { user: null, pending: { statements: 0, appeals: 0 } })),
      }),
    );
    render(<App />);
    await screen.findByRole('button', { name: ROW });

    failing = true;
    vi.setSystemTime(START + MINUTE + 1_000);
    leaveAndReturn();

    const notice = await screen.findByText('没刷新出来，显示的是 1 分钟前的数据。');
    expect(notice.closest('[role="status"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: ROW })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('出错了')).not.toBeInTheDocument();

    failing = false;
    await userEvent.setup().click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(screen.queryByText(/没刷新出来/)).not.toBeInTheDocument());
    expect(gets(calls, '/api/leaderboard')).toBe(3);
  });

  it('503 (maintenance) says the page is read-only for now', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(START);
    let down = false;
    mockFetch(
      routes({
        'GET /api/leaderboard': () =>
          down ? json(503, { error: '系统维护中（只读），请稍后再试' }) : json(200, { participants: [PLAYER] }),
      }),
    );
    render(<App />);
    await screen.findByRole('button', { name: ROW });
    down = true;
    vi.setSystemTime(START + 2 * MINUTE + 1_000);
    leaveAndReturn();
    expect(await screen.findByText('系统维护中，暂时只能看，显示的是 2 分钟前的数据。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: ROW })).toBeInTheDocument();
  });

  it('stays up while what failed is still old, even when another part refreshes fine', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(START);
    let failing = false;
    const calls = mockFetch(
      adminRoutes({
        'GET /api/leaderboard': () =>
          failing ? json(500, { error: 'boom' }) : json(200, { participants: [PLAYER] }),
        [REGENERATE]: () => json(200, { report: REPORT }),
      }),
    );
    render(<App />);
    await screen.findByRole('button', { name: ROW });
    failing = true;
    vi.setSystemTime(START + MINUTE + 1_000);
    leaveAndReturn();
    const stale = '没刷新出来，显示的是 1 分钟前的数据。';
    await screen.findByText(stale);

    // Only the report is refetched (and arrives); the board is still the old one.
    await userEvent.setup().click(screen.getByRole('button', { name: '换个说法' }));
    await waitFor(() => expect(gets(calls, '/api/report/latest')).toBe(2));
    await waitFor(() => expect(screen.getByRole('button', { name: '换个说法' })).toBeEnabled());
    expect(screen.getByText(stale)).toBeInTheDocument();
  });
});

describe('App — the weekly reset passes with the page open', () => {
  it('refetches config, shows 回血中… meanwhile, and never a negative countdown', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
      shouldAdvanceTime: true,
    });
    vi.setSystemTime(START);
    const firstReset = new Date(START + 30_000).toISOString();
    const nextReset = new Date(START + 30_000 + 7 * DAY).toISOString();
    let configCalls = 0;
    let release: (res: Response) => void = () => undefined;
    const calls = mockFetch(
      routes({
        'GET /api/config': () => {
          configCalls += 1;
          if (configCalls === 1) return json(200, config(firstReset));
          return new Promise<Response>((resolve) => {
            release = resolve;
          });
        },
      }),
    );
    render(<App />);
    await screen.findByRole('button', { name: ROW });
    expect(clock()).toBe('00:01');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MINUTE + 1_000);
    });
    expect(gets(calls, '/api/config')).toBe(2);
    expect(clock()).toBe('回血中…');

    await act(async () => {
      release(json(200, config(nextReset)));
    });
    await waitFor(() => expect(clock()).toMatch(/^\d+天 \d{2}:\d{2}$/));
    expect(clock()).not.toContain('-');
    await waitFor(() => expect(gets(calls, '/api/leaderboard')).toBe(2));
    expect(gets(calls, '/api/me')).toBe(2);
    expect(gets(calls, '/api/config')).toBe(2);
  });
});

describe('App — tab title', () => {
  it('signed in with things to do: the same URLs plus the two follow-ups, and (N) in the tab title', async () => {
    const calls = mockFetch(
      routes({
        'GET /api/me': () => json(200, { user: ADMIN, pending: { statements: 2, appeals: 1 } }),
        'GET /api/records?limit=20&mine=pending': () => json(200, { records: [] }),
        'GET /api/me/invites': () => json(200, { sessions: [] }),
      }),
    );
    const { unmount } = render(<App />);
    await waitFor(() => expect(document.title).toBe('(3) EDG 信誉分'));
    await settle();
    expect(new Set(calls.map((c) => c.path))).toEqual(
      new Set([
        '/api/config',
        '/api/leaderboard',
        '/api/records?limit=50',
        '/api/me',
        '/api/report/latest',
        '/api/sessions?scope=upcoming',
        '/api/records?limit=20&mine=pending',
        '/api/me/invites',
        '/api/sessions?scope=mine',
      ]),
    );
    unmount();
    expect(document.title).toBe('EDG 信誉分');
  });
});
