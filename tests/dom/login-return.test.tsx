import { act, render, screen, waitFor, within } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { SessionDetailDialog } from '../../src/components/SessionDetailDialog';
import { LOGIN_RETURN_TTL_MS } from '../../src/lib/constants';
import { LOGIN_RETURN_KEY, serializeLoginReturn } from '../../src/lib/loginReturnShape';
import type { LoginIntent } from '../../src/lib/loginReturnShape';
import { navigate, resetRouterForTests } from '../../src/lib/router';
import type { RecordItem, SessionDetail, User } from '../../src/types';
import { preventNavigation } from './history';

// P1-3 (spec §3.5, §4.1 登录回跳): a visitor on a read-only page clicks 来, logs
// in, and lands back on that page with a question — "A link never writes", so
// nothing is posted until they click again.

interface Call {
  method: string;
  path: string;
}

const HOUR = 3_600_000;
const QUESTION = '你登录前点的是「来」，确认一下？';
const SUGGESTED = 'sdt__rsvp-btn--suggested';
const GOING: LoginIntent = { kind: 'rsvp', sessionId: 5, rsvp: 'going' };

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

function session(id: number, myRsvp: SessionDetail['my_rsvp']): SessionDetail {
  return {
    id,
    organizer: { id: 'org', username: '组织者', avatar_url: null },
    title: '周五五排',
    game: null,
    starts_at: new Date(Date.now() + 2 * HOUR).toISOString(),
    duration_min: null,
    capacity: null,
    note: null,
    status: 'open',
    settled_at: null,
    created_at: '2026-10-01 00:00:00',
    counts: { invited: 0, going: 1, maybe: 0, out: 0 },
    my_rsvp: myRsvp,
    players: [],
  };
}

interface Stub {
  calls: Call[];
  /** Back from the login page: /api/me answers with ME from now on. */
  signIn: () => void;
}

interface StubOptions {
  /** GET /api/sessions?scope=upcoming. */
  listed?: SessionDetail[];
  /** my_rsvp on session 5 once signed in. */
  myRsvp?: SessionDetail['my_rsvp'];
}

/** The app's reads — a visitor until signIn() — and an RSVP that answers like the server. */
function stubApi(options: StubOptions = {}): Stub {
  const calls: Call[] = [];
  let me: User | null = null;
  const routes: Record<string, () => Response> = {
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
    'GET /api/leaderboard': () => json(200, { participants: [] }),
    'GET /api/records?limit=50': () => json(200, { records: [] }),
    'GET /api/me': () => json(200, { user: me, pending: { statements: 0, appeals: 0 } }),
    'GET /api/me/invites': () => json(200, { sessions: [] }),
    'GET /api/report/latest': () => json(200, { report: null }),
    'GET /api/sessions?scope=upcoming': () => json(200, { sessions: options.listed ?? [] }),
    'GET /api/sessions/3': () => json(200, { session: session(3, null), records: [] }),
    'GET /api/sessions/5': () =>
      json(200, { session: session(5, me ? (options.myRsvp ?? null) : null), records: [] }),
    'GET /api/records/7': () => json(200, { record: CASE }),
    'GET /api/users/q': () =>
      json(200, {
        user: { id: 'q', username: '当事人', avatar_url: null, is_participant: true, is_judge: false, score: 88, created_at: 'x' },
        records: [CASE],
        history: [],
      }),
    'POST /api/sessions/5/rsvp': () => json(200, { session: session(5, 'going') }),
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
      me = ME;
    },
  };
}

const writes = (calls: readonly Call[]): Call[] => calls.filter((c) => c.method !== 'GET');

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
    window.history.replaceState(null, '', '/sessions/5');
    render(<App />);
    const login = await screen.findByRole('link', { name: '登录' });
    expect(login).toHaveAttribute('href', '/auth/login');
    await user.click(login);
    expect(stored()).toEqual({ v: 1, path: '/sessions/5', savedAt: expect.any(Number) });
  });

  it('the lobby’s 用 Nanako 账号登录 forgets an older one (nothing to come back to)', async () => {
    stubApi();
    const user = userEvent.setup();
    window.sessionStorage.setItem(LOGIN_RETURN_KEY, serializeLoginReturn('/sessions/5', GOING, Date.now()));
    render(<App />);
    const login = await screen.findByRole('link', { name: '用 Nanako 账号登录' });
    expect(login).toHaveAttribute('href', '/auth/login');
    await user.click(login);
    expect(stored()).toBeNull();
    expect(window.location.pathname).toBe('/');
  });
});

describe('the session page — ResumeHint and the visitor prompt', () => {
  function renderDetail(resumeRsvp: 'going' | null, myRsvp: SessionDetail['my_rsvp'] = null) {
    const stub = stubApi({ myRsvp });
    stub.signIn();
    const onResumeDone = vi.fn();
    render(
      <SessionDetailDialog
        sessionId={5}
        me={ME}
        onClose={() => {}}
        onChanged={() => {}}
        resumeRsvp={resumeRsvp}
        onResumeDone={onResumeDone}
      />,
    );
    return { stub, onResumeDone };
  }

  it('asks about the earlier click and rings that button — without answering', async () => {
    const { stub, onResumeDone } = renderDetail('going');
    const hint = (await screen.findByText(QUESTION)).closest('.resume-hint');
    expect(hint).toHaveAttribute('role', 'status');
    expect(screen.getByRole('button', { name: '来' })).toHaveClass(SUGGESTED);
    expect(screen.getByRole('button', { name: '来' })).toHaveAttribute('aria-pressed', 'false');
    // Focusing the ringed button reads the question too (a status region inserted with its text may go unannounced).
    expect(screen.getByRole('button', { name: '来' })).toHaveAccessibleDescription(QUESTION);
    expect(screen.getByRole('button', { name: '待定' })).not.toHaveClass(SUGGESTED);
    expect(screen.getByRole('button', { name: '待定' })).not.toHaveAttribute('aria-describedby');
    expect(screen.getAllByRole('button', { name: '来' })).toHaveLength(1);
    await settle();
    expect(onResumeDone).not.toHaveBeenCalled();
    expect(writes(stub.calls)).toEqual([]);
  });

  it('不用了 forgets the click without answering, and focus lands on the title', async () => {
    const { stub, onResumeDone } = renderDetail('going');
    const user = userEvent.setup();
    await screen.findByText(QUESTION);
    await user.click(screen.getByRole('button', { name: '不用了' }));
    expect(onResumeDone).toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: '周五五排' }));
    expect(writes(stub.calls)).toEqual([]);
  });

  it('clicking the ringed 来 again is what answers — once', async () => {
    const { stub, onResumeDone } = renderDetail('going');
    const user = userEvent.setup();
    await screen.findByText(QUESTION);
    await user.click(screen.getByRole('button', { name: '来' }));
    await waitFor(() => expect(onResumeDone).toHaveBeenCalled());
    expect(writes(stub.calls)).toEqual([{ method: 'POST', path: '/api/sessions/5/rsvp' }]);
  });

  it('already that answer: nothing to ask, and the hint is done', async () => {
    const { stub, onResumeDone } = renderDetail('going', 'going');
    expect(await screen.findByRole('button', { name: '来' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(onResumeDone).toHaveBeenCalled());
    expect(screen.queryByText(QUESTION)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '来' })).not.toHaveClass(SUGGESTED);
    expect(writes(stub.calls)).toEqual([]);
  });

  it('a visitor gets 登录后报名: three login links that remember the answer, and the login button', async () => {
    stubApi();
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/sessions/5');
    render(<SessionDetailDialog sessionId={5} me={null} onClose={() => {}} onChanged={() => {}} />);
    const prompt = await screen.findByRole('group', { name: '登录后报名' });
    expect(within(prompt).getByText('登录后就能回『来 / 待定 / 不来』，没绑 Discord 也行。')).toBeInTheDocument();
    for (const name of ['来', '待定', '不来', '用 Nanako 账号登录']) {
      expect(within(prompt).getByRole('link', { name })).toHaveAttribute('href', '/auth/login');
    }
    expect(screen.queryByRole('button', { name: '来' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '我的报名' })).not.toBeInTheDocument();

    await user.click(within(prompt).getByRole('link', { name: '待定' }));
    expect(stored()).toEqual({
      v: 1,
      path: '/sessions/5',
      savedAt: expect.any(Number),
      intent: { kind: 'rsvp', sessionId: 5, rsvp: 'maybe' },
    });
  });
});

describe('a lobby row for a visitor', () => {
  it('登录后报名 comes back to that session', async () => {
    stubApi({ listed: [session(5, null)] });
    const user = userEvent.setup();
    render(<App />);
    const link = await screen.findByRole('link', { name: '登录后报名 周五五排' });
    expect(link).toHaveAttribute('href', '/auth/login');
    await user.click(link);
    expect(stored()).toEqual({ v: 1, path: '/sessions/5', savedAt: expect.any(Number) });
    expect(window.location.pathname).toBe('/');
  });
});
