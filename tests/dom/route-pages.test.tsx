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

describe('PlayerDetail — page, drawer and the focused case', () => {
  it('moves the focused case to the top: one #case-7, the list skips it, the count stays', async () => {
    mockFetch(routes());
    render(<PlayerDetail userId="p" me={null} onClose={() => {}} focusRecordId={7} />);
    await waitFor(() => expect(document.activeElement?.id).toBe('case-7'));
    expect(document.querySelectorAll('[id="case-7"]')).toHaveLength(1);
    const pinned = screen.getByRole('region', { name: '你点开的这一起' });
    expect(pinned).toHaveTextContent('案件 #7 · 放鸽子');
    expect(pinned).toContainElement(document.getElementById('case-7'));
    expect(document.querySelectorAll('.pd__cases .vc')).toHaveLength(1);
    expect(document.querySelector('.pd__count')).toHaveTextContent('2');
  });

  it('pins the route’s copy when the list does not hold the case', async () => {
    mockFetch({ ...routes(), 'GET /api/users/p': () => json(200, { user: PLAYER, records: [{ ...CASE, id: 6 }], history: [] }) });
    render(<PlayerDetail variant="page" userId="p" me={null} onClose={() => {}} focusRecordId={7} pinnedRecord={CASE} />);
    await waitFor(() => expect(document.activeElement?.id).toBe('case-7'));
    expect(document.querySelectorAll('[id="case-7"]')).toHaveLength(1);
    expect(document.querySelector('.pd__count')).toHaveTextContent('1');
  });

  it('page form: the name takes focus; a case that is nowhere leaves the page unscrolled', async () => {
    mockFetch(routes());
    const plain = render(<PlayerDetail variant="page" userId="p" me={null} onClose={() => {}} />);
    const name = await screen.findByRole('heading', { name: '选手' });
    await waitFor(() => expect(document.activeElement).toBe(name));
    expect(document.querySelector('.modal-page')?.firstElementChild).toHaveClass('pagebar');
    plain.unmount();

    render(<PlayerDetail variant="page" userId="p" me={null} onClose={() => {}} focusRecordId={99} />);
    await screen.findByRole('heading', { name: '选手' });
    expect(screen.queryByRole('region', { name: '你点开的这一起' })).not.toBeInTheDocument();
    expect(document.querySelectorAll('.pd__cases .vc')).toHaveLength(2);
  });

  it('loads again when refreshKey changes', async () => {
    const calls = mockFetch(routes());
    const view = render(<PlayerDetail userId="p" me={null} onClose={() => {}} refreshKey={0} />);
    await screen.findByRole('heading', { name: '选手' });
    view.rerender(<PlayerDetail userId="p" me={null} onClose={() => {}} refreshKey={1} />);
    await waitFor(() => expect(count(calls, '/api/users/p')).toBe(2));
  });

  it('shows everyone the score, but the 段位 only to the player themself', async () => {
    mockFetch(routes());
    const visitor = render(<PlayerDetail userId="p" me={null} onClose={() => {}} />);
    const gauge = await screen.findByRole('img', { name: /^信誉分 88 分/ });
    expect(gauge.getAttribute('aria-label')).not.toContain('段位');
    expect(gauge).toHaveClass('gauge--neutral');
    visitor.unmount();

    render(<PlayerDetail userId="p" me={SELF} onClose={() => {}} />);
    expect(await screen.findByRole('img', { name: /^信誉分 88 分/ })).toHaveAccessibleName(/段位/);
  });

  it('a 404 is NotFound on the page and drawer forms — and still today’s line in the center dialog', async () => {
    mockFetch(routes());
    const page = render(<PlayerDetail variant="page" userId="ghost" me={null} onClose={() => {}} />);
    expect(await screen.findByRole('heading', { name: '找不到这位选手。' })).toHaveAttribute('id', 'player-detail-title');
    page.unmount();

    const drawer = render(<PlayerDetail variant="drawer" userId="ghost" me={null} onClose={() => {}} />);
    expect(await screen.findByRole('heading', { name: '找不到这位选手。' })).toBeInTheDocument();
    drawer.unmount();

    render(<PlayerDetail userId="ghost" me={null} onClose={() => {}} />);
    expect(await screen.findByText('unrouted GET /api/users/ghost')).toBeInTheDocument();
  });
});

describe('unknown addresses', () => {
  it('render NotFound in place of the lobby; 回大厅 goes home without a reload', async () => {
    mockFetch(routes());
    window.history.replaceState(null, '', '/xyz');
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole('heading', { name: '这页不存在' })).toBeInTheDocument();
    expect(lobbyHidden()).toBe(true);
    expect(screen.queryByRole('heading', { name: /约局/ })).not.toBeInTheDocument();
    const home = screen.getByRole('link', { name: '回大厅' });
    expect(home).toHaveAttribute('href', '/');
    await user.click(home);
    expect(window.location.pathname).toBe('/');
    expect(await screen.findByRole('heading', { name: /约局/ })).toBeInTheDocument();
  });

  it('say which thing is missing on a session or player that does not exist', async () => {
    mockFetch(routes());
    window.history.replaceState(null, '', '/sessions/999');
    const first = render(<App />);
    expect(await screen.findByRole('heading', { name: '找不到这局，链接可能写错了。' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '回大厅' })).toHaveAttribute('href', '/');
    first.unmount();

    window.history.replaceState(null, '', '/players/ghost');
    render(<App />);
    expect(await screen.findByRole('heading', { name: '找不到这位选手。' })).toBeInTheDocument();
  });

  it('keep the old sentences for a case that is gone, or cannot be read right now', async () => {
    mockFetch(routes());
    window.history.replaceState(null, '', '/players/p/cases/8');
    const first = render(<App />);
    expect(await screen.findByRole('heading', { name: '链接里的案件不存在了。' })).toBeInTheDocument();
    first.unmount();

    window.history.replaceState(null, '', '/cases/9');
    render(<App />);
    expect(await screen.findByRole('heading', { name: '打不开链接里的案件，稍后再试。' })).toBeInTheDocument();
  });
});

describe('/sessions/:id', () => {
  it('on a phone is a page: PageBar, no dialog, the lobby hidden, the title focused', async () => {
    mockFetch(routes());
    window.history.replaceState(null, '', '/sessions/5');
    const user = userEvent.setup();
    render(<App />);
    const title = await screen.findByRole('heading', { name: '周五五排' });
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(lobbyHidden()).toBe(true);
    // Opened straight from outside: 返回 has nothing of ours behind it, so it replaces with '/'.
    const before = window.history.length;
    await user.click(screen.getByRole('button', { name: '返回' }));
    expect(window.location.pathname).toBe('/');
    expect(window.history.length).toBe(before);
    expect(await screen.findByRole('heading', { name: /约局/ })).toBeInTheDocument();
  });

  it('on a desktop is a drawer over the lobby; ✕ closes it', async () => {
    useDesktopViewport();
    mockFetch(routes());
    window.history.replaceState(null, '', '/sessions/5');
    const user = userEvent.setup();
    render(<App />);
    const drawer = await screen.findByRole('dialog');
    expect(drawer.className).toContain('modal__panel--drawer');
    expect(await screen.findByRole('heading', { name: '周五五排' })).toBeInTheDocument();
    expect(lobbyHidden()).toBe(false);
    expect(screen.queryByRole('button', { name: '返回' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '关闭' }));
    expect(window.location.pathname).toBe('/');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('/players/:id', () => {
  it('opens from the board as its own address; 返回 goes back to the lobby', async () => {
    mockFetch(routes());
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: ROW }));
    expect(window.location.pathname).toBe('/players/p');
    expect(await screen.findByRole('heading', { name: '选手' })).toBeInTheDocument();
    expect(lobbyHidden()).toBe(true);
    await user.click(screen.getByRole('button', { name: '返回' }));
    await waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(await screen.findByRole('button', { name: ROW })).toBeInTheDocument();
  });

  it('the brand link goes home in place', async () => {
    mockFetch(routes());
    window.history.replaceState(null, '', '/players/p');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: '选手' });
    await user.click(screen.getByRole('link', { name: 'EDG 信誉分 首页' }));
    expect(window.location.pathname).toBe('/');
    expect(await screen.findByRole('button', { name: ROW })).toBeInTheDocument();
  });
});

describe('/players/:id/cases/:caseId', () => {
  it('moves the case to the top — one #case-7 on the page, focused, the rest below', async () => {
    const calls = mockFetch(routes());
    window.history.replaceState(null, '', '/players/p/cases/7');
    render(<App />);
    expect(await screen.findByRole('heading', { name: '选手' })).toBeInTheDocument();
    const card = document.getElementById('case-7');
    await waitFor(() => expect(document.activeElement).toBe(card));
    expect(document.querySelectorAll('[id="case-7"]')).toHaveLength(1);
    expect(card?.closest('.pd__pinned')).not.toBeNull();
    expect(card?.className).toContain('vc--focus');
    expect(screen.getByRole('region', { name: '你点开的这一起' })).toHaveTextContent('案件 #7 · 放鸽子');
    expect(document.getElementById('case-6')?.closest('.pd__cases')).not.toBeNull();
    expect(document.querySelector('.pd__count')).toHaveTextContent('2');
    expect(count(calls, '/api/records/7')).toBe(1);
  });

  it('when the two ids disagree, the case’s subject wins — in place, no error', async () => {
    const calls = mockFetch(routes());
    window.history.replaceState(null, '', '/players/wrong/cases/7?utm=dc');
    const before = window.history.length;
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe('/players/p/cases/7'));
    expect(window.location.search).toBe('?utm=dc');
    expect(window.history.length).toBe(before);
    expect(await screen.findByRole('heading', { name: '选手' })).toBeInTheDocument();
    expect(count(calls, '/api/users/wrong')).toBe(0);
    expect(count(calls, '/api/records/7')).toBe(1);
  });

  it('/cases/:id is an alias: looked up once, then replaced with the player address', async () => {
    const calls = mockFetch(routes());
    window.history.replaceState(null, '', '/cases/7');
    const before = window.history.length;
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe('/players/p/cases/7'));
    expect(window.history.length).toBe(before);
    expect(await screen.findByRole('heading', { name: '选手' })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement?.id).toBe('case-7'));
    expect(count(calls, '/api/records/7')).toBe(1);
  });

  it('on a desktop opens as a drawer with the case pinned', async () => {
    useDesktopViewport();
    mockFetch(routes());
    window.history.replaceState(null, '', '/players/p/cases/7');
    render(<App />);
    const drawer = await screen.findByRole('dialog');
    expect(drawer.className).toContain('modal__panel--drawer');
    await waitFor(() => expect(document.activeElement?.id).toBe('case-7'));
    expect(lobbyHidden()).toBe(false);
  });

  it('on a desktop, a case that is gone says so in a drawer over the lobby; ✕ goes home', async () => {
    useDesktopViewport();
    mockFetch(routes());
    window.history.replaceState(null, '', '/players/p/cases/8');
    const user = userEvent.setup();
    render(<App />);
    const drawer = await screen.findByRole('dialog', { name: '链接里的案件不存在了。' });
    expect(drawer.className).toContain('modal__panel--drawer');
    expect(lobbyHidden()).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: '链接里的案件不存在了。' }));
    await user.click(screen.getByRole('button', { name: '关闭' }));
    expect(window.location.pathname).toBe('/');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
