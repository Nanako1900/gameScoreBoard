import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { NotFound } from '../../src/components/NotFound';
import { PageBar } from '../../src/components/PageBar';
import { PlayerDetail } from '../../src/components/PlayerDetail';
import { SessionDetailDialog } from '../../src/components/SessionDetailDialog';
import { useRouteLayout } from '../../src/lib/useRouteLayout';
import type { PublicUser, RecordItem, SessionDetail, User } from '../../src/types';
import { useDesktopViewport } from './viewport';

// P1-1: the routes of spec §2.2 inside the app — pages on a phone, drawers on a
// desktop, NotFound, and the case a link points at moved to the top.

interface Call {
  method: string;
  path: string;
}

function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(JSON.stringify(body)) } as Response;
}

function mockFetch(routes: Record<string, () => Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      const method = init?.method ?? 'GET';
      calls.push({ method, path });
      const route = routes[`${method} ${path}`];
      return Promise.resolve(route ? route() : json(404, { error: `unrouted ${method} ${path}` }));
    }),
  );
  return calls;
}

const count = (calls: Call[], path: string): number => calls.filter((c) => c.path === path).length;

const CASE: RecordItem = {
  id: 7,
  subject: { id: 'p', username: '选手', avatar_url: null },
  reporter: { id: 'j', username: '裁判', avatar_url: null },
  type: 'no_show',
  delta: -12,
  note: null,
  claim: '说好八点五排结果没来',
  claim_summary: '八点没来',
  classified_by: 'ai',
  escalation_suggested: false,
  session_id: null,
  statement: null,
  statement_at: null,
  appeal_reason: null,
  deadline_at: null,
  status: 'decided',
  verdict: { source: 'ai', headline: '', reasoning: '', factors: [] },
  range: { min: -20, max: -10, base: -15 },
  created_at: '2026-10-26 09:00:00',
  redacted: true,
};
const PLAYER: PublicUser = {
  id: 'p',
  username: '选手',
  avatar_url: null,
  is_participant: true,
  is_judge: false,
  score: 88,
  created_at: '2026-10-01 00:00:00',
};
const SELF: User = { ...PLAYER, oauth_username: 'p', is_admin: false };
const ROW = '第 1 名 选手，88 分';
const SESSION: SessionDetail = {
  id: 5,
  organizer: { id: 'org', username: '组织者', avatar_url: null },
  title: '周五五排',
  game: null,
  starts_at: '2026-10-30T13:00:00.000Z',
  duration_min: null,
  capacity: null,
  note: null,
  status: 'open',
  settled_at: null,
  created_at: '2026-10-01 00:00:00',
  counts: { invited: 0, going: 1, maybe: 0, out: 0 },
  my_rsvp: null,
  players: [],
};

function routes(me: User | null = null): Record<string, () => Response> {
  return {
    'GET /api/config': () =>
      json(200, {
        violations: [],
        tiers: [],
        weeklyHeal: 5,
        weeklyBonusCap: 5,
        statementWindowHours: 12,
        aiEnabled: false,
        maxBatchSubjects: 5,
        nextResetAt: '2026-11-01T16:00:00.000Z',
      }),
    'GET /api/leaderboard': () => json(200, { participants: [PLAYER] }),
    'GET /api/records?limit=50': () => json(200, { records: [] }),
    'GET /api/me': () => json(200, { user: me, pending: { statements: 0, appeals: 0 } }),
    'GET /api/me/invites': () => json(200, { sessions: [] }),
    'GET /api/report/latest': () => json(200, { report: null }),
    'GET /api/sessions?scope=upcoming': () => json(200, { sessions: [] }),
    'GET /api/sessions/5': () => json(200, { session: SESSION, records: [] }),
    'GET /api/records/7': () => json(200, { record: CASE }),
    'GET /api/records/9': () => json(500, { error: 'boom' }),
    'GET /api/users/p': () => json(200, { user: PLAYER, records: [{ ...CASE, id: 6 }, CASE], history: [] }),
  };
}

const lobbyHidden = (): boolean => document.querySelector('.app__main')?.hasAttribute('hidden') ?? false;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('building blocks', () => {
  it('NotFound: the heading takes focus, 回大厅 is a real link home', () => {
    render(<NotFound title="这页不存在" />);
    const heading = screen.getByRole('heading', { name: '这页不存在' });
    expect(heading).toHaveAttribute('id', 'notfound-title');
    expect(document.activeElement).toBe(heading);
    expect(screen.getByRole('link', { name: '回大厅' })).toHaveAttribute('href', '/');
  });

  it('NotFound takes a detail view’s heading id and its own actions', () => {
    render(
      <NotFound
        title="找不到这位选手。"
        headingId="player-detail-title"
        actions={[{ label: '看信誉榜', to: '/board' }]}
        autoFocus={false}
      />,
    );
    const heading = screen.getByRole('heading', { name: '找不到这位选手。' });
    expect(heading).toHaveAttribute('id', 'player-detail-title');
    expect(document.activeElement).not.toBe(heading);
    expect(screen.getByRole('link', { name: '看信誉榜' })).toHaveAttribute('href', '/board');
    expect(screen.queryByRole('link', { name: '回大厅' })).not.toBeInTheDocument();
  });

  it('PageBar: one 返回 button; the title is context, not a heading', async () => {
    const onBack = vi.fn();
    render(<PageBar backLabel="返回" title="周五五排" onBack={onBack} />);
    await userEvent.setup().click(screen.getByRole('button', { name: '返回' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByText('周五五排')).toHaveAttribute('aria-hidden', 'true');
  });

  it('useRouteLayout: a page without matchMedia, a drawer on a desktop', () => {
    function Layout(): JSX.Element {
      return <p>{useRouteLayout()}</p>;
    }
    const phone = render(<Layout />);
    expect(screen.getByText('page')).toBeInTheDocument();
    phone.unmount();
    useDesktopViewport();
    render(<Layout />);
    expect(screen.getByText('drawer')).toBeInTheDocument();
  });
});

describe('SessionDetailDialog — page and drawer', () => {
  it('page: PageBar first, no dialog, the title focused once loaded', async () => {
    mockFetch(routes());
    const onClose = vi.fn();
    render(<SessionDetailDialog variant="page" sessionId={5} me={null} onClose={onClose} onChanged={() => {}} />);
    const title = await screen.findByRole('heading', { name: '周五五排' });
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.querySelector('.modal-page')?.firstElementChild).toHaveClass('pagebar');
    await userEvent.setup().click(screen.getByRole('button', { name: '返回' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('drawer: a dialog with Modal’s own ✕ and no PageBar', async () => {
    mockFetch(routes());
    render(<SessionDetailDialog variant="drawer" sessionId={5} me={null} onClose={() => {}} onChanged={() => {}} />);
    const dialog = await screen.findByRole('dialog', { name: '周五五排' });
    expect(dialog).toHaveClass('modal__panel--drawer');
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '返回' })).not.toBeInTheDocument();
  });

  it('a 404 is NotFound on a page — and still today’s line in the center dialog', async () => {
    mockFetch(routes());
    const page = render(
      <SessionDetailDialog variant="page" sessionId={999} me={null} onClose={() => {}} onChanged={() => {}} />,
    );
    const heading = await screen.findByRole('heading', { name: '找不到这局，链接可能写错了。' });
    expect(heading).toHaveAttribute('id', 'session-detail-title');
    page.unmount();

    render(<SessionDetailDialog sessionId={999} me={null} onClose={() => {}} onChanged={() => {}} />);
    expect(await screen.findByText('unrouted GET /api/sessions/999')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '找不到这局，链接可能写错了。' })).not.toBeInTheDocument();
  });
});
