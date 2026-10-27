import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { ApiError, DISCORD_LINK_URL, getDiscordLink, setDiscordNotify } from '../../src/api';
import { DiscordLinkCard } from '../../src/components/DiscordLinkCard';
import { WelcomePage } from '../../src/components/WelcomePage';
import { ToastProvider } from '../../src/components/Toast';
import type { User } from '../../src/types';

interface Call {
  method: string;
  path: string;
}

type Routes = Record<string, () => Response>;

/**
 * Only what request() reads. A real Response would read its body through a
 * stream on timers of its own; this one settles in microtasks, so `settle()`
 * below can deterministically wait out a fetch that leaves nothing on screen.
 */
function json(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

/** Route fetch by "METHOD /path?query"; anything unrouted answers 500 so it shows up. */
function mockFetch(routes: Routes): Call[] {
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

/** Drain every pending microtask (the whole mocked fetch chain) inside act. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const BOUND = { link: { discord_username: 'nanako_edg', linked_at: '2026-10-20 12:00:00', notify_dm: true, dm_ok: true } };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getDiscordLink', () => {
  it('resolves undefined on 404 — the old Worker has no such route', async () => {
    mockFetch({ 'GET /api/me/discord': () => json(404, { error: 'Not found' }) });
    await expect(getDiscordLink()).resolves.toBeUndefined();
  });

  it('resolves null when unbound and still throws other errors', async () => {
    mockFetch({ 'GET /api/me/discord': () => json(200, { link: null }) });
    await expect(getDiscordLink()).resolves.toBeNull();

    mockFetch({ 'GET /api/me/discord': () => json(500, { error: '服务器开小差了' }) });
    const err = await getDiscordLink().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 500, message: '服务器开小差了' });
  });
});

describe('DiscordLinkCard', () => {
  it('renders nothing when the backend has no Discord support', async () => {
    const calls = mockFetch({ 'GET /api/me/discord': () => json(404, { error: 'Not found' }) });
    const { container } = render(<DiscordLinkCard />);

    await waitFor(() => expect(calls).toHaveLength(1));
    await settle();

    expect(container).toBeEmptyDOMElement();
  });

  it('offers a bind link to the API when unbound', async () => {
    mockFetch({ 'GET /api/me/discord': () => json(200, { link: null }) });
    render(<DiscordLinkCard />);

    const link = await screen.findByRole('link', { name: '绑定 Discord' });
    expect(link).toHaveAttribute('href', DISCORD_LINK_URL);
    expect(DISCORD_LINK_URL).toMatch(/\/link\/discord$/);
    // A real navigation, not a button that fetches: the API sets cookies and redirects.
    expect(link.tagName).toBe('A');
  });

  it('shows the bound name and unlinks only after the inline confirm', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      'GET /api/me/discord': () => json(200, BOUND),
      'POST /api/me/discord/unlink': () => json(200, { ok: true }),
    });
    render(<DiscordLinkCard />);

    const name = await screen.findByText('@nanako_edg');
    expect(name.closest('p')).toHaveTextContent('Discord：@nanako_edg · 已绑定');

    await user.click(screen.getByRole('button', { name: '解绑' }));
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    // Focus lands on the safe choice, so a stray Enter cannot unbind.
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: '确认解绑' }));

    const link = await screen.findByRole('link', { name: '绑定 Discord' });
    expect(link).toHaveAttribute('href', DISCORD_LINK_URL);
    expect(link).toHaveFocus();
    expect(screen.queryByText('@nanako_edg')).not.toBeInTheDocument();
    expect(calls).toContainEqual({ method: 'POST', path: '/api/me/discord/unlink' });
  });

  it('cancelling the confirm sends nothing and returns focus to 解绑', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({ 'GET /api/me/discord': () => json(200, BOUND) });
    render(<DiscordLinkCard />);

    await user.click(await screen.findByRole('button', { name: '解绑' }));
    await user.click(screen.getByRole('button', { name: '取消' }));

    expect(screen.getByRole('button', { name: '解绑' })).toHaveFocus();
    expect(screen.queryByRole('button', { name: '确认解绑' })).not.toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('keeps the binding and shows the server message when unlinking fails', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/me/discord': () => json(200, BOUND),
      'POST /api/me/discord/unlink': () => json(409, { error: '操作冲突，请重试' }),
    });
    render(<DiscordLinkCard />);

    await user.click(await screen.findByRole('button', { name: '解绑' }));
    await user.click(screen.getByRole('button', { name: '确认解绑' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('操作冲突，请重试');
    expect(screen.getByText('@nanako_edg')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '解绑' })).toHaveFocus();
  });

  it('shows the API error when the binding cannot be read', async () => {
    mockFetch({ 'GET /api/me/discord': () => json(401, { error: '请先登录' }) });
    render(<DiscordLinkCard />);

    expect(await screen.findByRole('alert')).toHaveTextContent('请先登录');
    expect(screen.queryByRole('link', { name: '绑定 Discord' })).not.toBeInTheDocument();
  });
});

describe('WelcomePage hosts the card', () => {
  const me: User = {
    id: 'u1',
    username: 'Nanako',
    oauth_username: 'Nanako',
    avatar_url: null,
    is_participant: true,
    is_judge: false,
    is_admin: false,
    score: 100,
    created_at: '2026-10-01 00:00:00',
  };

  it('offers binding in the welcome page beside the editable account fields', () => {
    render(<ToastProvider><WelcomePage me={me} discord={{ value: null, loading: false }}
      onDiscordChanged={() => {}} onSaved={() => {}} onComplete={() => {}} /></ToastProvider>);
    const link = screen.getByRole('link', { name: '绑定 Discord' });
    expect(link).toHaveAttribute('href', DISCORD_LINK_URL);
    expect(screen.getByText(/还没「确认」的修改不会保存/)).toBeInTheDocument();
  });

  it('hides unsupported Discord controls while keeping identity editable', async () => {
    render(<ToastProvider><WelcomePage me={me} discord={{ value: undefined, loading: false }}
      onDiscordChanged={() => {}} onSaved={() => {}} onComplete={() => {}} /></ToastProvider>);
    expect(screen.queryByRole('heading', { name: 'Discord 账号' })).not.toBeInTheDocument();
    await userEvent.setup().click(within(screen.getByTestId('welcome-step-4')).getByRole('button'));
    expect(screen.getByRole('button', { name: '确认' })).toBeInTheDocument();
  });
});

describe('App — ?linked=discord', () => {
  const appRoutes: Routes = {
    'GET /api/config': () =>
      json(200, {
        violations: [],
        tiers: [],
        weeklyHeal: 5,
        statementWindowHours: 24,
        aiEnabled: false,
        maxBatchSubjects: 5,
        nextResetAt: '2026-11-02T00:00:00.000Z',
      }),
    'GET /api/leaderboard': () => json(200, { participants: [] }),
    'GET /api/records?limit=50': () => json(200, { records: [] }),
    'GET /api/me': () => json(200, { user: null, pending: { statements: 0, appeals: 0 } }),
    'GET /api/report/latest': () => json(200, { report: null }),
  };

  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('confirms the bind on welcome and consumes both entry parameters from the URL', async () => {
    const user = userEvent.setup();
    mockFetch(appRoutes);
    window.history.replaceState(null, '', '/?linked=discord&onboarding=1');
    render(<App />);

    expect(await screen.findByText('Discord 绑定成功')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/welcome');
    expect(window.location.search).toBe('');

    await user.click(screen.getByRole('button', { name: '关闭提示' }));
    expect(screen.queryByText('Discord 绑定成功')).not.toBeInTheDocument();
  });

  it('shows nothing without the parameter', async () => {
    mockFetch(appRoutes);
    render(<App />);

    await screen.findByRole('heading', { name: '最近案件' });
    expect(screen.queryByText('Discord 绑定成功')).not.toBeInTheDocument();
  });

  const signedIn = (roles: { is_participant: boolean; is_judge: boolean }): Routes => ({
    ...appRoutes,
    'GET /api/me': () =>
      json(200, {
        user: {
          id: 'u1',
          username: 'nanako',
          oauth_username: 'nanako',
          avatar_url: null,
          score: 100,
          is_admin: false,
          ...roles,
        },
        pending: { statements: 0, appeals: 0 },
      }),
    'GET /api/me/discord': () => json(200, BOUND),
  });

  it('asks the first-run question again when someone without a role comes back from binding', async () => {
    mockFetch(signedIn({ is_participant: false, is_judge: false }));
    window.history.replaceState(null, '', '/?linked=discord');
    render(<App />);
    expect(await screen.findByRole('heading', { name: '入户' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: '设置你的显示名字与身份' })).toBeInTheDocument();
    expect(within(screen.getByTestId('welcome-step-4')).getByRole('button', { expanded: true })).toBeInTheDocument();
  });

  it('opens the guide step for someone whose account is already complete', async () => {
    mockFetch(signedIn({ is_participant: true, is_judge: false }));
    window.history.replaceState(null, '', '/?linked=discord');
    render(<App />);
    expect(await screen.findByText('Discord 绑定成功')).toBeInTheDocument();
    await settle();
    expect(screen.getByRole('button', { name: '完成，去首页' })).toBeEnabled();
    expect(within(screen.getByTestId('welcome-step-5')).getByRole('button', { expanded: true })).toBeInTheDocument();
  });
});

describe('setDiscordNotify', () => {
  interface Sent {
    method: string;
    path: string;
    body: unknown;
  }

  /** Answers every request with one response, recording what was sent. */
  function answer(status: number, body: unknown): Sent[] {
    const sent: Sent[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        sent.push({ method: init?.method ?? 'GET', path: url.replace(/^https?:\/\/[^/]+/, ''), body: init?.body ?? null });
        return Promise.resolve(json(status, body));
      }),
    );
    return sent;
  }

  it('posts exactly { on } and resolves the binding as it now stands', async () => {
    const link = { discord_username: 'nanako_edg', linked_at: '2026-10-20 12:00:00', notify_dm: false, dm_ok: true };
    const sent = answer(200, { link });
    await expect(setDiscordNotify(false)).resolves.toEqual(link);
    expect(sent).toEqual([{ method: 'POST', path: '/api/me/discord/notify', body: '{"on":false}' }]);
  });

  it('resolves undefined on 404 — a backend without the switch', async () => {
    answer(404, { error: 'Not found' });
    await expect(setDiscordNotify(true)).resolves.toBeUndefined();
  });

  it('throws the API\'s words for anything else, e.g. 409 when not bound', async () => {
    answer(409, { error: '还没有绑定 Discord' });
    const err = await setDiscordNotify(true).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, message: '还没有绑定 Discord' });
  });
});
