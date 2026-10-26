import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { PlayerDetail } from '../../src/components/PlayerDetail';
import { RecordsFeed } from '../../src/components/RecordsFeed';
import { WeeklyReportCard } from '../../src/components/WeeklyReportCard';
import type { RecordItem, User, WeeklyReport } from '../../src/types';

// P8 in the app, at its edges: links into the app, the first-run dialog, an
// old weekly report, the feed's escalation chip.

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

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

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
const ADMIN: User = {
  id: 'a',
  username: '管理',
  oauth_username: 'a',
  avatar_url: null,
  is_participant: true,
  is_judge: true,
  is_admin: true,
  score: 100,
  created_at: 'x',
};
const NEWBIE: User = { ...ADMIN, id: 'n', username: '新人', is_participant: false, is_judge: false, is_admin: false };

const base = (me: User | null) => ({
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
  'GET /api/sessions?scope=upcoming': () => json(200, { sessions: [] }),
  'GET /api/records/7': () => json(200, { record: CASE }),
  'GET /api/users/p': () =>
    json(200, {
      user: { id: 'p', username: '选手', avatar_url: null, is_participant: true, is_judge: false, score: 88, created_at: 'x' },
      records: [CASE],
      history: [],
    }),
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('links into the app', () => {
  it('a case that cannot be loaded right now (500) is not called gone', async () => {
    mockFetch({ ...base(null), 'GET /api/records/7': () => json(500, { error: 'boom' }) });
    window.history.replaceState(null, '', '/?case=7');
    render(<App />);
    expect(await screen.findByText('打不开链接里的案件，稍后再试。')).toBeInTheDocument();
  });

  it('opens once — not again on every refresh after an action', async () => {
    const calls = mockFetch({ ...base(ADMIN), 'POST /api/admin/users/p': () => json(200, { ok: true }) });
    window.history.replaceState(null, '', '/?case=7');
    const user = userEvent.setup();
    render(<App />);
    const input = await screen.findByRole('spinbutton', { name: '调整分数' });
    await user.clear(input);
    await user.type(input, '75');
    await user.click(screen.getByRole('button', { name: '改分' }));
    await user.click(screen.getByRole('button', { name: '确认改分' }));
    await waitFor(() => expect(calls.filter((c) => c.path === '/api/records?limit=50').length).toBeGreaterThan(1));
    await settle();
    expect(calls.filter((c) => c.path === '/api/records/7')).toHaveLength(1);
  });

  it('waits for the first-run dialog, then opens the case', async () => {
    mockFetch(base(NEWBIE));
    window.history.replaceState(null, '', '/?onboarding=1&case=7');
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole('radiogroup', { name: '选择身份' })).toBeInTheDocument();
    await settle();
    await settle();
    expect(screen.queryByRole('heading', { name: '选手' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(await screen.findByRole('heading', { name: '选手' })).toBeInTheDocument();
  });

  it('scrolls the linked case into view', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    try {
      mockFetch(base(null));
      render(<PlayerDetail userId="p" me={null} onClose={() => {}} focusRecordId={7} />);
      await waitFor(() => expect(document.activeElement?.id).toBe('case-7'));
      expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ block: 'center' }));
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });
});

describe('the weekly report card', () => {
  const report: WeeklyReport = {
    week_start: '2026-10-12',
    stats: {
      weekStart: '2026-10-12',
      weekEnd: '2026-10-18',
      sessionsPlayed: 1,
      sessionsCollapsed: 0,
      casesFiled: 1,
      totalPenalty: -15,
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
    created_at: '2026-10-19 02:31:00',
  } as WeeklyReport;

  it('says when it is not last week’s (Monday morning, before 10:30)', () => {
    render(<WeeklyReportCard report={report} stale />);
    expect(screen.getByRole('heading', { name: /往期战报/ })).toBeInTheDocument();
    expect(screen.getByText(/周一 10:30 之后发布/)).toBeInTheDocument();
  });

  it('is last week’s otherwise', () => {
    render(<WeeklyReportCard report={report} />);
    expect(screen.getByRole('heading', { name: /上周战报/ })).toBeInTheDocument();
  });
});

describe('the feed', () => {
  it('shows no 待确认升级 chip once the case went to judgment', () => {
    const { container } = render(<RecordsFeed records={[{ ...CASE, escalation_suggested: true, status: 'decided' }]} />);
    expect(container.querySelector('.feed-row__status--escalate')).toBeNull();
  });
});
