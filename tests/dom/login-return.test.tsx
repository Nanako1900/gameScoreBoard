import { act, render, screen, waitFor } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { LOGIN_RETURN_TTL_MS } from '../../src/lib/constants';
import { LOGIN_RETURN_KEY, serializeLoginReturn } from '../../src/lib/loginReturnShape';
import { navigate, resetRouterForTests } from '../../src/lib/router';
import type { RecordItem, User } from '../../src/types';
import { preventNavigation } from './history';

// P1-3 (spec §3.5, §4.1 登录回跳): a visitor on a read-only page clicks 来, logs
// in, and lands back on that page with a question — "A link never writes", so
// nothing is posted until they click again.

interface Call {
  method: string;
  path: string;
}

const HOUR = 3_600_000;
const GOING = { kind: 'rsvp', sessionId: 5, rsvp: 'going' };

const ME: User = {
  id: 'p',
  username: '选手',
  oauth_username: '选手',
  avatar_url: null,
  is_participant: true,
  is_judge: false,
  is_admin: false,
  score: 100,
  created_at: '2026-10-01 00:00:00',
};

const CASE: RecordItem = {
  id: 7,
  subject: { id: 'q', username: '当事人', avatar_url: null },
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

function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(JSON.stringify(body)) } as Response;
}

interface Stub {
  calls: Call[];
  /** Back from the login page: /api/me answers with ME from now on. */
  signIn: () => void;
}

/** The app's reads — a visitor until signIn() — and an RSVP that answers like the server. */
function stubApi(signedInUser: User = ME, bound = true): Stub {
  const calls: Call[] = [];
  let me: User | null = null;
  const routes: Record<string, () => Response> = {
    'GET /api/config': () =>
      json(200, {
        violations: [],
        tiers: [],
        weeklyHeal: 5,
        statementWindowHours: 12,
        aiEnabled: false,
        maxBatchSubjects: 5,
        nextResetAt: '2026-11-01T16:00:00.000Z',
      }),
    'GET /api/leaderboard': () => json(200, { participants: [] }),
    'GET /api/records?limit=50': () => json(200, { records: [] }),
    'GET /api/me': () => json(200, { user: me, pending: { statements: 0, appeals: 0 } }),
    'GET /api/me/discord': () => json(200, { link: bound ? { discord_username: 'own', linked_at: '', notify_dm: true, dm_ok: true } : null }),
    'POST /api/me/display-name': () => json(200, { ok: true }),
    'POST /api/me/roles': () => { me = { ...signedInUser, is_participant: true }; return json(200, { user: me }); },
    'GET /api/report/latest': () => json(200, { report: null }),
    'GET /api/records/7': () => json(200, { record: CASE }),
    'GET /api/users/q': () =>
      json(200, {
        user: { id: 'q', username: '当事人', avatar_url: null, is_participant: true, is_judge: false, score: 88, created_at: 'x' },
        records: [CASE],
        history: [],
      }),
    'POST /auth/logout': () => json(200, { ok: true }),
  };
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
  return {
    calls,
    signIn: () => {
      me = signedInUser;
    },
  };
}

const writes = (calls: readonly Call[]): Call[] => calls.filter((c) => c.method !== 'GET');

async function finishWelcome(): Promise<void> {
  const user = userEvent.setup();
  const heading = screen.getByRole('button', { name: /机器人怎么用/ });
  if (heading.getAttribute('aria-expanded') !== 'true') await user.click(heading);
  // The welcome heading can render before the binding read settles. That read
  // may still move the expanded step; finish only once the real action is ready.
  const complete = await waitFor(() => {
    const button = screen.getByRole('button', { name: '完成，去首页' });
    expect(button).toBeEnabled();
    return button;
  });
  await user.click(complete);
}

const stored = (): unknown => {
  const raw = window.sessionStorage.getItem(LOGIN_RETURN_KEY);
  return raw === null ? null : JSON.parse(raw);
};

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

/**
 * What the OAuth round trip leaves behind (P1 contract 6.1): a fresh load of
 * `url` (the API lands on '/'), signed in, with edg.return as given.
 */
function backFromLogin(stub: Stub, raw: string | null, url = '/'): RenderResult {
  resetRouterForTests();
  if (raw !== null) window.sessionStorage.setItem(LOGIN_RETURN_KEY, raw);
  if (url !== '/') window.history.replaceState(null, '', url);
  stub.signIn();
  return render(<App />);
}

// jsdom cannot follow a clicked <a href>; LoginLink's own click handler still runs.
let allowNavigation: () => void = () => {};
beforeEach(() => {
  allowNavigation = preventNavigation();
});
afterEach(() => {
  allowNavigation();
  vi.unstubAllGlobals();
});

describe('LoginLink — every way into the login page', () => {
  it('the header’s 登录 remembers the page it was clicked on', async () => {
    stubApi();
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/players/q');
    render(<App />);
    const login = await screen.findByRole('link', { name: '登录' });
    expect(login).toHaveAttribute('href', '/auth/login');
    await user.click(login);
    expect(stored()).toEqual({ v: 1, path: '/players/q', savedAt: expect.any(Number) });
  });

  it('the lobby’s 开始 link enters welcome without prematurely consuming a saved return', async () => {
    stubApi();
    const user = userEvent.setup();
    window.sessionStorage.setItem(LOGIN_RETURN_KEY, serializeLoginReturn('/players/q', Date.now()));
    render(<App />);
    const login = await screen.findByRole('link', { name: '开始' });
    expect(login).toHaveAttribute('href', '/welcome');
    await user.click(login);
    expect(stored()).not.toBeNull();
    expect(window.location.pathname).toBe('/welcome');
  });
});

describe('登录回跳 — back from the login page', () => {
  it('reads an old intent-bearing value as an address only and never writes on resume', async () => {
    const stub = stubApi();
    backFromLogin(stub, JSON.stringify({ v: 1, path: '/players/q', savedAt: Date.now(), intent: GOING }));
    await screen.findByRole('heading', { name: '当事人' });
    expect(window.location.pathname).toBe('/players/q');
    expect(stored()).toBeNull();
    expect(writes(stub.calls)).toEqual([]);
  });

  it.each(['/sessions/5', '/sessions/new?again=5'])('a saved retired address %s goes home', async (path) => {
    const stub = stubApi();
    backFromLogin(stub, JSON.stringify({ v: 1, path, savedAt: Date.now(), intent: GOING }), '/players/q');
    await waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(stored()).toBeNull();
    expect(writes(stub.calls)).toEqual([]);
  });

  it('the welcome page goes first, then the saved address', async () => {
    const stub = stubApi();
    backFromLogin(stub, serializeLoginReturn('/players/q', Date.now()), '/?onboarding=1');
    await screen.findByRole('heading', { name: '入户' });
    await settle();
    expect(window.location.pathname).toBe('/welcome');
    expect(stored()).not.toBeNull();
    await finishWelcome();
    await screen.findByRole('heading', { name: '当事人' });
    expect(window.location.pathname).toBe('/players/q');
    expect(writes(stub.calls)).toEqual([]);
  });

  it.each([
    ['/?case=7', '/players/q/cases/7'],
    ['/?session=3&utm=dc', '/'],
    ['/?session=3&case=7&utm=dc', '/players/q/cases/7'],
  ])('an old link (%s) wins over the saved address', async (url, landing) => {
    const stub = stubApi();
    backFromLogin(stub, serializeLoginReturn('/players/q?return=old', Date.now()), url);
    await waitFor(() => expect(stored()).toBeNull());
    await waitFor(() => expect(window.location.pathname).toBe(landing));
    expect(window.location.search).not.toContain('return=old');
    expect(window.location.search).not.toMatch(/case=|session=/);
    if (landing === '/') expect(await screen.findByText('约局功能已下线')).toBeInTheDocument();
    expect(writes(stub.calls)).toEqual([]);
  });

  it('a session retirement toast waits for the welcome page', async () => {
    const stub = stubApi();
    backFromLogin(stub, serializeLoginReturn('/players/q', Date.now()), '/?session=3&onboarding=1');
    await screen.findByRole('heading', { name: '入户' });
    expect(screen.queryByText('约局功能已下线')).not.toBeInTheDocument();
    await finishWelcome();
    expect(await screen.findByText('约局功能已下线')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
    expect(stored()).toBeNull();
  });

  it('binding return still asks an unfinished identity before announcing retirement', async () => {
    const stub = stubApi({ ...ME, is_participant: false });
    backFromLogin(stub, serializeLoginReturn('/players/q', Date.now()), '/?session=3&linked=discord');
    await screen.findByRole('heading', { name: '入户' });
    expect(screen.queryByText('约局功能已下线')).not.toBeInTheDocument();
    expect(window.location.search).toBe('');
    await userEvent.setup().click(await screen.findByRole('button', { name: '确认' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /机器人怎么用/ })).toHaveAttribute('aria-expanded', 'true'));
    await finishWelcome();
    expect(await screen.findByText('约局功能已下线')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
    expect(stored()).toBeNull();
    expect(writes(stub.calls)).toEqual([
      { method: 'POST', path: '/api/me/display-name' }, { method: 'POST', path: '/api/me/roles' },
    ]);
  });

  it('continues the case once after both welcome flags and clears all consumed parameters', async () => {
    const stub = stubApi();
    backFromLogin(stub, serializeLoginReturn('/players/q?old=1', Date.now()),
      '/?case=7&session=3&onboarding=1&linked=discord&utm=dc');
    await screen.findByRole('heading', { name: '入户' });
    expect(window.location.pathname).toBe('/welcome');
    expect(window.location.search).toBe('?utm=dc');
    expect(screen.getByText('Discord 绑定成功')).toBeInTheDocument();
    expect(stored()).not.toBeNull();
    await finishWelcome();
    await screen.findByRole('heading', { name: '案件 #7' });
    expect(window.location.pathname).toBe('/players/q/cases/7');
    expect(window.location.search).toBe('?utm=dc');
    expect(stored()).toBeNull();
    expect(screen.queryByText('约局功能已下线')).not.toBeInTheDocument();
    await settle();
    expect(stub.calls.filter((call) => call.path === '/api/records/7')).toHaveLength(1);
    expect(writes(stub.calls)).toEqual([]);
  });

  it.each(['/welcome', '/welcome/', '/welcome/?utm=login'])('does not reopen welcome after login from its own address %s', async (path) => {
    const stub = stubApi();
    backFromLogin(stub, serializeLoginReturn(path, Date.now()), '/?onboarding=1');
    await screen.findByRole('heading', { name: '入户' });
    await finishWelcome();
    await waitFor(() => expect(stored()).toBeNull());
    await settle();
    expect(window.location.pathname).toBe('/');
    expect(screen.queryByRole('heading', { name: '入户' })).not.toBeInTheDocument();
    expect(writes(stub.calls)).toEqual([]);
  });

  it.each(['onboarding=1', 'linked=discord'])('continues an existing non-home page after %s', async (flag) => {
    const stub = stubApi();
    backFromLogin(stub, null, `/players/q?${flag}&utm=dc`);
    await screen.findByRole('heading', { name: '入户' });
    expect(window.location.pathname).toBe('/welcome');
    expect(window.location.search).toBe('?utm=dc');
    await finishWelcome();
    await screen.findByRole('heading', { name: '当事人' });
    expect(window.location.pathname).toBe('/players/q');
    expect(window.location.search).toBe('?utm=dc');
    expect(writes(stub.calls)).toEqual([]);
  });

  it('keeps the login return ahead of the original non-home page after welcome', async () => {
    const stub = stubApi();
    backFromLogin(stub, serializeLoginReturn('/guide', Date.now()), '/players/q?onboarding=1');
    await screen.findByRole('heading', { name: '入户' });
    await finishWelcome();
    await screen.findByRole('heading', { name: '机器人指南' });
    expect(window.location.pathname).toBe('/guide');
    expect(stored()).toBeNull();
    expect(writes(stub.calls)).toEqual([]);
  });

  it.each([
    ['/?case=7&onboarding=1&utm=dc', '/players/q/cases/7'],
    ['/?session=3&onboarding=1&utm=dc', '/'],
    ['/players/q?onboarding=1&utm=dc', '/players/q'],
  ])('keeps the original destination across the full Discord OAuth navigation: %s', async (url, landing) => {
    const firstStub = stubApi(ME, false);
    const first = backFromLogin(firstStub, null, url);
    await userEvent.setup().click(await screen.findByRole('link', { name: '绑定 Discord' }));
    expect(writes(firstStub.calls)).toEqual([]);
    first.unmount();
    // OAuth loads a new document and only carries ?linked=discord back from the API.
    const secondStub = stubApi();
    backFromLogin(secondStub, null, '/?linked=discord');
    await screen.findByRole('heading', { name: '入户' });
    await finishWelcome();
    await waitFor(() => expect(window.location.pathname).toBe(landing));
    if (landing !== '/') {
      await screen.findByRole('heading', { name: landing.includes('/cases/') ? '案件 #7' : '当事人' });
      expect(window.location.search).toBe('?utm=dc');
    } else {
      expect(await screen.findByText('约局功能已下线')).toBeInTheDocument();
    }
    expect(writes(secondStub.calls)).toEqual([]);
  });

  it('retains an entry destination through a welcome reload and forgets it on completion', async () => {
    const first = backFromLogin(stubApi(), null, '/?onboarding=1&case=7&utm=dc');
    await screen.findByRole('button', { name: '完成，去首页' });
    first.unmount();
    backFromLogin(stubApi(), null, '/welcome?utm=dc');
    await screen.findByRole('heading', { name: '入户' });
    await finishWelcome();
    await screen.findByRole('heading', { name: '案件 #7' });
    expect(window.location.pathname).toBe('/players/q/cases/7');
    expect(window.location.search).toBe('?utm=dc');
    expect(sessionStorage.getItem('edg.welcome.return')).toBeNull();
  });

  it.each(['/missing', '/auth/login'])('does not resume an unknown or API-owned entry pathname %s', async (path) => {
    backFromLogin(stubApi(), null, `${path}?onboarding=1`);
    await screen.findByRole('heading', { name: '入户' });
    await finishWelcome();
    await settle();
    expect(window.location.pathname).toBe('/');
  });

  it.each([
    ['/?case=7&linked=discord', '/players/q/cases/7'],
    ['/players/q?linked=discord', '/players/q'],
  ])('keeps an explicit new destination ahead of an older pending welcome return: %s', async (url, landing) => {
    sessionStorage.setItem('edg.welcome.return', JSON.stringify({ v: 1, savedAt: Date.now(), path: '/?session=3' }));
    backFromLogin(stubApi(), null, url);
    await screen.findByRole('heading', { name: '入户' });
    await finishWelcome();
    await screen.findByRole('heading', { name: landing.includes('/cases/') ? '案件 #7' : '当事人' });
    expect(window.location.pathname).toBe(landing);
    expect(screen.queryByText('约局功能已下线')).not.toBeInTheDocument();
  });

  it('a stale or tampered value goes nowhere and is removed', async () => {
    const values = [
      serializeLoginReturn('/players/q', Date.now() - LOGIN_RETURN_TTL_MS - 1),
      JSON.stringify({ v: 1, path: '//evil.example/players/q', savedAt: Date.now() }),
      JSON.stringify({ v: 1, path: '/players/%E0%A4%A', savedAt: Date.now() }),
      JSON.stringify({ v: 1, path: '/auth/login', savedAt: Date.now() }),
      '{not json',
    ];
    for (const raw of values) {
      const stub = stubApi();
      const { unmount } = backFromLogin(stub, raw);
      await waitFor(() => expect(stored()).toBeNull());
      expect(window.location.pathname, raw).toBe('/');
      expect(writes(stub.calls), raw).toEqual([]);
      unmount();
    }
  });

  it('a visitor load neither follows nor removes a saved address', async () => {
    const raw = serializeLoginReturn('/players/q', Date.now());
    window.sessionStorage.setItem(LOGIN_RETURN_KEY, raw);
    stubApi();
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'EDG 信誉分' });
    expect(window.location.pathname).toBe('/');
    expect(window.sessionStorage.getItem(LOGIN_RETURN_KEY)).toBe(raw);
  });

  it('logging out forgets the saved address', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const stub = stubApi();
      backFromLogin(stub, null);
      const user = userEvent.setup();
      await screen.findByRole('heading', { level: 1, name: '你好，选手。' });
      window.sessionStorage.setItem(LOGIN_RETURN_KEY, serializeLoginReturn('/players/q', Date.now()));
      await user.click(screen.getByRole('button', { name: /选手/ }));
      await user.click(screen.getByRole('button', { name: '退出登录' }));
      await waitFor(() => expect(stored()).toBeNull());
      expect(quiet.mock.calls.every(([first]) => String(first).includes('Not implemented: navigation'))).toBe(true);
    } finally { quiet.mockRestore(); }
  });
});
