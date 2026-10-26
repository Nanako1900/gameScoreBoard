import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import type { RecordItem } from '../../src/types';

// P8: ?case=<id> and ?session=<id> — the links the bot puts in DMs and replies.

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

const appRoutes = {
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
  'GET /api/me': () => json(200, { user: null, pending: { statements: 0, appeals: 0 } }),
  'GET /api/report/latest': () => json(200, { report: null }),
  'GET /api/sessions?scope=upcoming': () => json(200, { sessions: [] }),
  'GET /api/records/7': () => json(200, { record: CASE }),
  'GET /api/users/p': () =>
    json(200, {
      user: { id: 'p', username: '选手', avatar_url: null, is_participant: true, is_judge: false, score: 88, created_at: 'x' },
      records: [{ ...CASE, id: 6 }, CASE],
      history: [],
    }),
};

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('App — links into the app', () => {
  it('?case= opens the case in its subject’s page, focused, and is used up', async () => {
    const calls = mockFetch(appRoutes);
    window.history.replaceState(null, '', '/?case=7&utm=dc');
    render(<App />);
    expect(await screen.findByRole('heading', { name: '选手' })).toBeInTheDocument();
    const card = document.getElementById('case-7');
    await waitFor(() => expect(document.activeElement).toBe(card));
    expect(card?.className).toContain('vc--focus');
    expect(document.getElementById('case-6')?.className).not.toContain('vc--focus');
    expect(window.location.search).toBe('?utm=dc');
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('ignores anything but a positive id, and strips it', async () => {
    for (const bad of ['abc', '0', '-1', '1e3', '07x', '1234567890123456']) {
      const calls = mockFetch(appRoutes);
      window.history.replaceState(null, '', `/?case=${bad}`);
      const { unmount } = render(<App />);
      await screen.findByRole('heading', { name: /约局/ });
      await settle();
      expect(calls.some((c) => c.path.startsWith('/api/records/')), bad).toBe(false);
      expect(screen.queryByRole('heading', { name: '选手' })).not.toBeInTheDocument();
      expect(window.location.search, bad).toBe('');
      unmount();
    }
  });

  it('a case that is gone: a notice, and the app carries on', async () => {
    mockFetch({ ...appRoutes, 'GET /api/records/8': () => json(404, { error: '记录不存在' }) });
    window.history.replaceState(null, '', '/?case=8');
    render(<App />);
    expect(await screen.findByText('链接里的案件不存在了。')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '选手' })).not.toBeInTheDocument();
  });

  it('?session= opens the session', async () => {
    const calls = mockFetch(appRoutes);
    window.history.replaceState(null, '', '/?session=3');
    render(<App />);
    await waitFor(() => expect(calls.some((c) => c.method === 'GET' && c.path === '/api/sessions/3')).toBe(true));
    expect(window.location.search).toBe('');
  });
});
