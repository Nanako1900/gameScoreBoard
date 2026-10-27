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
