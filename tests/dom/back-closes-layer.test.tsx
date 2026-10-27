import { StrictMode, useState } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { AppealSheet } from '../../src/components/AppealSheet';
import { Modal } from '../../src/components/Modal';
import { bootRouter, navigate, simulateReloadForTests, useLocation } from '../../src/lib/router';
import type { RecordItem, SessionDetail, User } from '../../src/types';
import { drainHistoryTraversals, entryIdx, overlayMarks } from './history';
import { useDesktopViewport } from './viewport';

// P1-2 (spec §2.2): overlays live in the session history. The back button
// closes only the top layer; a UI close walks back over the entry; a fresh tab
// on a deep address gets one `/` underneath, once; a reload never reopens an
// overlay and never grows the history.

/** The browser's back button. The popstate's re-render happens inside act. */
async function pressBack(): Promise<void> {
  await act(async () => {
    window.history.back();
    await drainHistoryTraversals();
  });
}

/** Let a UI close's silent back land (no React work comes of it, but keep it in act). */
async function settleHistory(): Promise<void> {
  await act(async () => {
    await drainHistoryTraversals();
  });
}

/** Subscribes to the router like App does, and shows where it is. */
function Where(): JSX.Element {
  const { pathname } = useLocation();
  return <p data-testid="where">{pathname}</p>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('entering and reloading', () => {
  it('a fresh tab on a deep address gets one `/` underneath, and a reload adds nothing', async () => {
    // Arriving from an outside link: an entry the router did not write, last in the list.
    window.history.pushState(null, '', '/sessions/5');
    const length = window.history.length;
    bootRouter();
    expect(window.history.length).toBe(length + 1);
    expect(window.location.pathname).toBe('/sessions/5');

    simulateReloadForTests();
    bootRouter();
    simulateReloadForTests();
    bootRouter();
    expect(window.history.length).toBe(length + 1);
    expect(window.location.pathname).toBe('/sessions/5');

    render(<Where />);
    await pressBack();
    expect(window.location.pathname).toBe('/');
    expect(screen.getByTestId('where')).toHaveTextContent('/');
  });

  it('`/` itself is only stamped, never padded', () => {
    window.history.pushState(null, '', '/?utm=dc');
    const length = window.history.length;
    bootRouter();
    expect(window.history.length).toBe(length);
    expect(window.location.search).toBe('?utm=dc');
    expect(window.history.state).toMatchObject({ edg: 1 });
  });

  it('a reload with a sheet open drops its marks and keeps the rest', () => {
    window.history.pushState({ edg: 1, idx: 2, sheet: 'reschedule', layer: 4, y: 120 }, '', '/sessions/5');
    const length = window.history.length;
    bootRouter();
    expect(window.history.length).toBe(length);
    expect(window.location.pathname).toBe('/sessions/5');
    expect(window.history.state).toEqual({ edg: 1, idx: 2, y: 120 });
  });
});

describe('scroll restoration', () => {
  it('going back to an address scrolls to where the user left it', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo');
    window.history.replaceState(null, '', '/');
    bootRouter();
    render(<Where />);
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(640);
    act(() => navigate('/sessions/5'));
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0);
    await pressBack();
    expect(screen.getByTestId('where')).toHaveTextContent('/');
    await waitFor(() => expect(scrollTo).toHaveBeenLastCalledWith(0, 640));
  });
});

// ---------------------------------------------------------------- overlays (P1-2 Modal historyKey)

/** A dialog with a sheet on top of it, both in history. */
function TwoLayers(): JSX.Element {
  const [outer, setOuter] = useState(false);
  const [inner, setInner] = useState(false);
  return (
    <>
      <Where />
      <button type="button" onClick={() => setOuter(true)}>
        打开外层
      </button>
      <Modal open={outer} onClose={() => setOuter(false)} labelledBy="outer-title" historyKey="outer">
        <h2 id="outer-title">外层</h2>
        <button type="button" onClick={() => setInner(true)}>
          打开内层
        </button>
        <Modal
          open={inner}
          onClose={() => setInner(false)}
          labelledBy="inner-title"
          variant="sheet"
          title="内层"
          historyKey="inner"
        >
          <p>内层内容</p>
        </Modal>
      </Modal>
    </>
  );
}

/** `/` as a fresh tab: stamped, nothing behind it. Returns its idx to compare with later. */
function stampHome(): number {
  window.history.replaceState(null, '', '/');
  bootRouter();
  return entryIdx();
}

describe('the back button and overlays', () => {
  it('closes only the top layer, then the next one', async () => {
    const user = userEvent.setup();
    const before = stampHome();
    render(<TwoLayers />);
    await user.click(screen.getByRole('button', { name: '打开外层' }));
    await user.click(screen.getByRole('button', { name: '打开内层' }));
    expect(overlayMarks().sheet).toBe('inner');

    await pressBack();
    expect(screen.queryByRole('dialog', { name: '内层' })).toBeNull();
    expect(screen.getByRole('dialog', { name: '外层' })).toBeInTheDocument();
    expect(overlayMarks().sheet).toBe('outer');

    await pressBack();
    expect(screen.queryByRole('dialog', { name: '外层' })).toBeNull();
    expect(overlayMarks()).toEqual({ sheet: undefined, layer: undefined });
    expect(entryIdx()).toBe(before);
    expect(window.location.pathname).toBe('/');
  });

  it('a UI close is synchronous and leaves the history where it was before the open', async () => {
    const user = userEvent.setup();
    const before = stampHome();
    render(<TwoLayers />);
    await user.click(screen.getByRole('button', { name: '打开外层' }));
    expect(entryIdx()).toBe(before + 1);

    await user.keyboard('{Escape}');
    // Closed at once — not after a popstate (organizer-actions, appeal-sheet, modal-focus rely on it).
    expect(screen.queryByRole('dialog', { name: '外层' })).toBeNull();
    await settleHistory();
    expect(entryIdx()).toBe(before);
    expect(overlayMarks()).toEqual({ sheet: undefined, layer: undefined });

    // ✕ works the same way, and nothing is left behind for a later back press.
    await user.click(screen.getByRole('button', { name: '打开外层' }));
    await user.click(screen.getByRole('button', { name: '关闭' }));
    await settleHistory();
    expect(entryIdx()).toBe(before);
  });

  it('closing both layers from the UI walks back over both entries', async () => {
    const user = userEvent.setup();
    const before = stampHome();
    render(<TwoLayers />);
    await user.click(screen.getByRole('button', { name: '打开外层' }));
    await user.click(screen.getByRole('button', { name: '打开内层' }));
    expect(entryIdx()).toBe(before + 2);
    await user.keyboard('{Escape}');
    await settleHistory();
    expect(entryIdx()).toBe(before + 1);
    expect(overlayMarks().sheet).toBe('outer');
    await user.keyboard('{Escape}');
    await settleHistory();
    expect(entryIdx()).toBe(before);
  });

  it('StrictMode: one open is one entry', async () => {
    const user = userEvent.setup();
    const before = stampHome();
    render(
      <StrictMode>
        <TwoLayers />
      </StrictMode>,
    );
    await user.click(screen.getByRole('button', { name: '打开外层' }));
    await settleHistory();
    expect(entryIdx()).toBe(before + 1);
    expect(overlayMarks().sheet).toBe('outer');
    await pressBack();
    expect(screen.queryByRole('dialog', { name: '外层' })).toBeNull();
    expect(entryIdx()).toBe(before);
  });

  it('a navigation right after a UI close waits for the silent back, so the overlay entry is gone', async () => {
    const user = userEvent.setup();
    const before = stampHome();
    render(<TwoLayers />);
    await user.click(screen.getByRole('button', { name: '打开外层' }));
    await user.keyboard('{Escape}');
    act(() => navigate('/sessions/5'));
    await settleHistory();
    expect(window.location.pathname).toBe('/sessions/5');
    expect(entryIdx()).toBe(before + 1);
    await pressBack();
    expect(window.location.pathname).toBe('/');
    expect(screen.getByTestId('where')).toHaveTextContent('/');
  });

  it('a navigation from inside an overlay uses its entry up instead of stacking on it', async () => {
    const user = userEvent.setup();
    const before = stampHome();
    render(<TwoLayers />);
    await user.click(screen.getByRole('button', { name: '打开外层' }));
    act(() => navigate('/sessions/5'));
    expect(entryIdx()).toBe(before + 1);
    expect(overlayMarks()).toEqual({ sheet: undefined, layer: undefined });
    await user.keyboard('{Escape}');
    await settleHistory();
    // No silent back: it would have undone the navigation.
    expect(window.location.pathname).toBe('/sessions/5');
    await pressBack();
    expect(window.location.pathname).toBe('/');
  });

  it('the scroll under an overlay survives a navigation from inside it', async () => {
    const user = userEvent.setup();
    const scrollTo = vi.spyOn(window, 'scrollTo');
    stampHome();
    render(<TwoLayers />);
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(640);
    await user.click(screen.getByRole('button', { name: '打开外层' }));
    act(() => navigate('/sessions/5'));
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0);
    await user.keyboard('{Escape}');
    await pressBack();
    expect(screen.getByTestId('where')).toHaveTextContent('/');
    await waitFor(() => expect(scrollTo).toHaveBeenLastCalledWith(0, 640));
  });

  it('a hash-only change closes nothing', async () => {
    const user = userEvent.setup();
    stampHome();
    render(<TwoLayers />);
    await user.click(screen.getByRole('button', { name: '打开外层' }));
    await act(async () => {
      window.location.hash = '#x';
      await drainHistoryTraversals();
    });
    expect(screen.getByRole('dialog', { name: '外层' })).toBeInTheDocument();
  });

  it('a reload with an overlay open does not reopen it', () => {
    window.history.pushState({ edg: 1, idx: 1, sheet: 'outer', layer: 1 }, '', '/');
    bootRouter();
    render(<TwoLayers />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(overlayMarks()).toEqual({ sheet: undefined, layer: undefined });
  });
});

// ---------------------------------------------------------------- a leave confirm (AppealSheet, historyKey 'appeal')

describe('a leave confirm and the back button', () => {
  const RECORD: RecordItem = {
    id: 9,
    subject: { id: 'p', username: '选手', avatar_url: null },
    reporter: { id: 'j', username: '裁判', avatar_url: null },
    type: 'late_major',
    delta: -6,
    note: null,
    claim: '迟到 25 分钟，没打招呼',
    claim_summary: null,
    classified_by: 'ai',
    escalation_suggested: false,
    session_id: null,
    statement: null,
    statement_at: null,
    appeal_reason: null,
    deadline_at: null,
    status: 'decided',
    verdict: { source: 'ai', headline: '情有可原', reasoning: '', factors: [] },
    range: { min: -9, max: -3, base: -6 },
    created_at: '2026-10-26 09:00:00',
    redacted: false,
  };
  const LEAVE = '申诉理由会留在这台设备上，下次回来接着写。';

  it('back asks first; after 继续写 the next back asks again instead of leaving', async () => {
    const user = userEvent.setup();
    const before = stampHome();
    const onClose = vi.fn();
    render(<AppealSheet record={RECORD} onClose={onClose} onAppealed={() => {}} />);
    await user.type(screen.getByRole('textbox', { name: /为什么觉得判得不对/ }), '判重了');
    expect(entryIdx()).toBe(before + 1);

    await pressBack();
    const leave = screen.getByRole('group', { name: LEAVE });
    expect(within(leave).getByRole('button', { name: '继续写' })).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();
    // Stopped by the confirm: the sheet owns the top entry again.
    expect(overlayMarks().sheet).toBe('appeal');
    expect(entryIdx()).toBe(before + 1);

    await user.click(within(leave).getByRole('button', { name: '继续写' }));
    await pressBack();
    expect(screen.getByRole('group', { name: LEAVE })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '申诉这一起' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '先离开' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------- the app (P1-1 routes + P1-2 history)

interface Call {
  method: string;
  path: string;
}

function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(JSON.stringify(body)) } as Response;
}

/** Unrouted requests answer 500, so an unexpected one shows up. */
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
      return Promise.resolve(route ? route() : json(500, { error: `unrouted ${method} ${path}` }));
    }),
  );
  return calls;
}

const DAY_MS = 86_400_000;
const ORGANIZER: User = {
  id: 'org',
  username: '组织者',
  oauth_username: 'org',
  avatar_url: null,
  is_participant: true,
  is_judge: false,
  is_admin: false,
  score: 100,
  created_at: '2026-10-01 00:00:00',
};

function session(): SessionDetail {
  return {
    id: 1,
    organizer: { id: 'org', username: '组织者', avatar_url: null },
    title: '周五五排',
    game: null,
    // Tomorrow, so 改时间 is offered whatever the machine's clock says.
    starts_at: new Date(Date.now() + DAY_MS).toISOString(),
    duration_min: null,
    capacity: null,
    note: null,
    status: 'open',
    settled_at: null,
    created_at: '2026-10-27 00:00:00',
    counts: { invited: 0, going: 1, maybe: 0, out: 0 },
    my_rsvp: 'going',
    players: [],
  };
}

function appRoutes(): Record<string, () => Response> {
  return {
    'GET /api/config': () =>
      json(200, {
        violations: [],
        tiers: [],
        weeklyHeal: 5,
        weeklyBonusCap: 5,
        statementWindowHours: 24,
        aiEnabled: false,
        maxBatchSubjects: 5,
        nextResetAt: '2026-11-02T00:00:00.000Z',
      }),
    'GET /api/leaderboard': () => json(200, { participants: [] }),
    'GET /api/records?limit=50': () => json(200, { records: [] }),
    'GET /api/me': () => json(200, { user: ORGANIZER, pending: { statements: 0, appeals: 0 } }),
    'GET /api/me/invites': () => json(200, { sessions: [] }),
    'GET /api/report/latest': () => json(200, { report: null }),
    'GET /api/sessions?scope=upcoming': () => json(200, { sessions: [] }),
    'GET /api/sessions/1': () => json(200, { session: session(), records: [] }),
  };
}

const writes = (calls: Call[]): Call[] => calls.filter((c) => c.method !== 'GET');

/** /sessions/1 opened straight from an outside link (state null), as the organizer. */
async function openSessionFromOutside(): Promise<{ calls: Call[]; unmount: () => void }> {
  const calls = mockFetch(appRoutes());
  window.history.pushState(null, '', '/sessions/1');
  const { unmount } = render(<App />);
  expect(await screen.findByRole('heading', { name: '周五五排' })).toBeInTheDocument();
  return { calls, unmount };
}

async function backToLobbyAndCheck(): Promise<void> {
  await pressBack();
  expect(window.location.pathname).toBe('/');
  expect(await screen.findByRole('heading', { name: /约局/ })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: '周五五排' })).toBeNull();
}

describe('App — overlays over a routed page', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('phone: back closes 改时间 only, the next back leaves /sessions/1 for the padded `/`', async () => {
    const user = userEvent.setup();
    const { calls } = await openSessionFromOutside();
    await user.click(await screen.findByRole('button', { name: '改时间' }));
    expect(screen.getByRole('dialog', { name: '改到什么时候？' })).toBeInTheDocument();
    expect(overlayMarks().sheet).toBe('reschedule');

    await pressBack();
    expect(screen.queryByRole('dialog', { name: '改到什么时候？' })).toBeNull();
    expect(screen.getByRole('heading', { name: '周五五排' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/sessions/1');

    await backToLobbyAndCheck();
    expect(writes(calls)).toEqual([]);
  });

  it('desktop: the same over the drawer', async () => {
    useDesktopViewport();
    const user = userEvent.setup();
    await openSessionFromOutside();
    await user.click(await screen.findByRole('button', { name: '改时间' }));
    await pressBack();
    expect(screen.queryByRole('dialog', { name: '改到什么时候？' })).toBeNull();
    expect(screen.getByRole('heading', { name: '周五五排' })).toBeInTheDocument();
    await backToLobbyAndCheck();
  });

  it('closing 改时间 with 先不改 leaves one back press to the lobby', async () => {
    const user = userEvent.setup();
    await openSessionFromOutside();
    await user.click(await screen.findByRole('button', { name: '改时间' }));
    await user.click(screen.getByRole('button', { name: '先不改' }));
    expect(screen.queryByRole('dialog', { name: '改到什么时候？' })).toBeNull();
    await settleHistory();
    expect(overlayMarks()).toEqual({ sheet: undefined, layer: undefined });
    await backToLobbyAndCheck();
  });

  it('a reload does not grow the history: still one back press to the lobby', async () => {
    let { unmount } = await openSessionFromOutside();
    const length = window.history.length;
    for (let reload = 0; reload < 3; reload += 1) {
      unmount();
      simulateReloadForTests();
      ({ unmount } = render(<App />));
      expect(await screen.findByRole('heading', { name: '周五五排' })).toBeInTheDocument();
    }
    expect(window.history.length).toBe(length);
    expect(window.location.pathname).toBe('/sessions/1');
    await backToLobbyAndCheck();
  });

  it('a reload with 改时间 open does not reopen it', async () => {
    mockFetch(appRoutes());
    window.history.pushState({ edg: 1, idx: 1, sheet: 'reschedule', layer: 3 }, '', '/sessions/1');
    render(<App />);
    expect(await screen.findByRole('heading', { name: '周五五排' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '改时间' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '改到什么时候？' })).toBeNull();
    expect(overlayMarks()).toEqual({ sheet: undefined, layer: undefined });
    expect(window.location.pathname).toBe('/sessions/1');
  });
});
