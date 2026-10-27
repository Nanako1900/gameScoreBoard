import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { ForgivenessNote } from '../../src/components/ForgivenessNote';
import { MyScoreLine } from '../../src/components/MyScoreLine';
import type { Config, PublicUser, User } from '../../src/types';

// 宽恕看得见（spec §5 #3, M7）. weeklyHeal is 5 in every config here, as in the
// app tests' stub: a literal 15 anywhere would show up as a failure.

const DAY = 86_400_000;
const HOUR = 3_600_000;
const fromNow = (ms: number): string => new Date(Date.now() + ms).toISOString();

const CONFIG: Config = {
  violations: [],
  tiers: [],
  weeklyHeal: 5,
  weeklyBonusCap: 6,
  statementWindowHours: 12,
  aiEnabled: false,
  maxBatchSubjects: 5,
  nextResetAt: fromNow(2 * DAY + HOUR),
};

const ME: User = {
  id: 'me',
  username: '我',
  oauth_username: '我',
  avatar_url: null,
  is_participant: true,
  is_judge: false,
  is_admin: false,
  score: 82,
  created_at: '2026-10-01 00:00:00',
};

describe('MyScoreLine', () => {
  it('shows score, rank and what Monday does, from config', () => {
    render(<MyScoreLine me={ME} rank={6} config={CONFIG} />);
    expect(screen.getByText('82 分 · 第 6 名')).toBeInTheDocument();
    expect(screen.getByText('周一 0 点回血 +5 → 预计 87 · 还有 2 天')).toBeInTheDocument();
    // 本周变化 waits for P4-5.
    expect(screen.queryByText(/本周/)).not.toBeInTheDocument();
  });

  it('has nothing to wait for at full score', () => {
    render(<MyScoreLine me={{ ...ME, score: 100 }} rank={1} config={CONFIG} />);
    expect(screen.getByText('已经是满分，回血不用等。')).toBeInTheDocument();
  });

  it('says 回血中… once the reset time has passed — never a negative time', () => {
    render(<MyScoreLine me={ME} rank={6} config={{ ...CONFIG, nextResetAt: fromNow(-HOUR) }} />);
    expect(screen.getByText('回血中…')).toBeInTheDocument();
    expect(screen.queryByText(/-\d/)).not.toBeInTheDocument();
  });

  it('leaves out the rank off the board, and is not there for a non-participant', () => {
    const { unmount } = render(<MyScoreLine me={ME} rank={null} config={CONFIG} />);
    expect(screen.getByText('82 分')).toBeInTheDocument();
    unmount();
    const { container } = render(<MyScoreLine me={{ ...ME, is_participant: false }} rank={null} config={CONFIG} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('opens the details when it can', async () => {
    const onOpen = vi.fn();
    render(<MyScoreLine me={ME} rank={6} config={CONFIG} onOpen={onOpen} />);
    await userEvent.setup().click(screen.getByRole('button', { name: '82 分 · 第 6 名' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe('ForgivenessNote', () => {
  it('gives the way back after a penalty, from weeklyHeal', () => {
    render(<ForgivenessNote delta={-6} scoreAfter={82} weeklyHeal={5} />);
    expect(screen.getByText('这次 -6。每周一 0 点回血 +5，预计下周一后回到 87。')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers the appeal only when asked to', async () => {
    const onAppeal = vi.fn();
    render(<ForgivenessNote delta={-6} scoreAfter={82} weeklyHeal={5} onAppeal={onAppeal} />);
    await userEvent.setup().click(screen.getByRole('button', { name: '觉得不公平？可以申诉' }));
    expect(onAppeal).toHaveBeenCalledTimes(1);
  });

  it('says nothing for points gained or none', () => {
    const { container } = render(<ForgivenessNote delta={2} scoreAfter={100} weeklyHeal={5} />);
    expect(container).toBeEmptyDOMElement();
  });
});

function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(JSON.stringify(body)) } as Response;
}

/** Route fetch by "METHOD /path?query"; anything unrouted answers 500 so it shows up. */
function mockFetch(routes: Record<string, () => Response>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      const route = routes[`${init?.method ?? 'GET'} ${path}`];
      return Promise.resolve(route ? route() : json(500, { error: `unrouted ${path}` }));
    }),
  );
}

/** Let the last fetches of the page land inside act() (p8-app.test.tsx:38-41). */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('MyScoreLine in the app', () => {
  it('sits after the to-dos and before the board, with the numbers from config', async () => {
    const board: PublicUser[] = [
      { id: 'x', username: '阿杰', avatar_url: null, is_participant: true, is_judge: false, score: 90, created_at: 'x' },
      { id: 'me', username: '我', avatar_url: null, is_participant: true, is_judge: false, score: 82, created_at: 'x' },
    ];
    mockFetch({
      'GET /api/config': () => json(200, CONFIG),
      'GET /api/leaderboard': () => json(200, { participants: board }),
      'GET /api/records?limit=50': () => json(200, { records: [] }),
      'GET /api/me': () => json(200, { user: ME, pending: { statements: 0, appeals: 0 } }),
      'GET /api/me/invites': () => json(200, { sessions: [] }),
      'GET /api/report/latest': () => json(200, { report: null }),
      'GET /api/sessions?scope=upcoming': () => json(200, { sessions: [] }),
    });
    render(<App />);

    const standing = await screen.findByRole('button', { name: '82 分 · 第 2 名' });
    expect(screen.getByText('周一 0 点回血 +5 → 预计 87 · 还有 2 天')).toBeInTheDocument();
    const boardHeading = await screen.findByRole('heading', { name: '信誉榜' });
    // The score precedes the board in the home reading order.
    expect(standing.compareDocumentPosition(boardHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await settle();
  });

  it('is not on the page for a visitor', async () => {
    mockFetch({
      'GET /api/config': () => json(200, CONFIG),
      'GET /api/leaderboard': () => json(200, { participants: [] }),
      'GET /api/records?limit=50': () => json(200, { records: [] }),
      'GET /api/me': () => json(200, { user: null, pending: { statements: 0, appeals: 0 } }),
      'GET /api/report/latest': () => json(200, { report: null }),
      'GET /api/sessions?scope=upcoming': () => json(200, { sessions: [] }),
    });
    render(<App />);
    await screen.findByRole('heading', { name: '最近案件' });
    await settle();
    expect(screen.queryByText(/周一 0 点回血/)).not.toBeInTheDocument();
  });
});
