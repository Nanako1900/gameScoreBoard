import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { Leaderboard } from '../../src/components/Leaderboard';
import { RecordsFeed } from '../../src/components/RecordsFeed';
import { RulesPanel } from '../../src/components/RulesPanel';
import { WeekHighlights } from '../../src/components/WeekHighlights';
import { WeeklyReportCard } from '../../src/components/WeeklyReportCard';
import { WelcomeCard } from '../../src/components/WelcomeCard';
import type {
  CaseStatus,
  Config,
  PublicUser,
  RecordItem,
  User,
  ViolationType,
  WeeklyReport,
} from '../../src/types';

// P0-4 (spec §9): the board without shaming — tied ranks, no medals, scores on
// every width, 段位 only on the viewer's own row, 本周之星 instead of 红黑榜,
// a shorter feed, a compact report with no awards, and a welcome card.

const NEXT_RESET = '2026-11-01T16:00:00.000Z'; // Monday 00:00 in Beijing
const IN_WEEK = '2026-10-27 12:00:00'; // SQLite UTC
const LAST_WEEK = '2026-10-25 15:00:00'; // an hour before the week started

function player(id: string, username: string, score: number): PublicUser {
  return { id, username, avatar_url: null, is_participant: true, is_judge: false, score, created_at: 'x' };
}

function rec(
  id: number,
  subjectId: string,
  type: ViolationType,
  delta: number,
  status: CaseStatus = 'decided',
  created_at = IN_WEEK,
): RecordItem {
  return {
    id,
    subject: { id: subjectId, username: subjectId === 'a' ? '阿杰' : subjectId === 'b' ? '小红' : '老王', avatar_url: null },
    reporter: { id: 'j', username: '裁判', avatar_url: null },
    type,
    delta,
    note: null,
    claim: null,
    claim_summary: null,
    classified_by: 'derived',
    escalation_suggested: false,
    session_id: null,
    statement: null,
    statement_at: null,
    appeal_reason: null,
    deadline_at: null,
    status,
    verdict: null,
    range: { min: delta, max: delta, base: delta },
    created_at,
  };
}

const onTime = (id: number, who: string): RecordItem => rec(id, who, 'on_time_bonus', 2);
const OLD = rec(1, 'c', 'organizer_bonus', 2, 'decided', LAST_WEEK);
/** 阿杰 ×3, 小红 ×2 this week, and the feed reaches back into last week. */
const STAR_FEED = [onTime(6, 'a'), onTime(5, 'b'), onTime(4, 'a'), onTime(3, 'b'), onTime(2, 'a'), OLD];

const TIED = [player('a', '阿杰', 100), player('b', '小红', 100), player('c', '老王', 96)];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('Leaderboard', () => {
  const renderBoard = (meId: string | null = null) =>
    render(<Leaderboard participants={TIED} trends={{}} counts={{}} onSelect={() => {}} meId={meId} />);

  it('gives tied scores the same rank', () => {
    renderBoard();
    expect(screen.getByRole('button', { name: '第 1 名 阿杰，100 分' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '第 1 名 小红，100 分' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '第 3 名 老王，96 分' })).toBeInTheDocument();
  });

  it('hands out no medals', () => {
    const { container } = renderBoard();
    expect(container.textContent).not.toMatch(/🥇|🥈|🥉/);
    expect(container.querySelector('[class*="lb-row--rank"]')).toBeNull();
  });

  it('shows every score as a number outside the gauge, and every gauge is neutral', () => {
    const { container } = renderBoard();
    const scores = [...container.querySelectorAll('.lb-row__score')].map((el) => el.textContent);
    expect(scores).toEqual(['100', '100', '96']);
    for (const gauge of screen.getAllByRole('img', { hidden: true })) {
      expect(gauge.getAttribute('aria-label')).not.toContain('段位');
    }
  });

  it('shows a 段位 only on the viewer’s own row', () => {
    const { container } = renderBoard('c');
    expect(container.querySelectorAll('.tier-badge')).toHaveLength(1);
    const mine = screen.getByRole('button', { name: '第 3 名 老王，96 分' });
    expect(mine).toHaveClass('lb-row--me');
    expect(within(mine).getByText('誓约之光')).toBeInTheDocument();
  });

  it('shows no 段位 at all to a visitor', () => {
    const { container } = renderBoard(null);
    expect(container.querySelector('.tier-badge')).toBeNull();
    expect(container.querySelector('.lb-row--me')).toBeNull();
  });

  it('renders the highlights slot between the head and the list', () => {
    const { container } = render(
      <Leaderboard participants={TIED} trends={{}} counts={{}} onSelect={() => {}} highlights={<p className="wh">x</p>} />,
    );
    expect(container.querySelector('.lb__head + .wh + .lb__list')).not.toBeNull();
  });
});

describe('WeekHighlights', () => {
  it('names this week’s stars, most bonuses first, and links to them', async () => {
    const onSelectUser = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <WeekHighlights records={STAR_FEED} nextResetAt={NEXT_RESET} onSelectUser={onSelectUser} />,
    );
    expect(container.textContent).toBe('⭐ 本周之星：阿杰（准时 3 次）、小红（准时 2 次）');
    await user.click(screen.getByRole('button', { name: '小红' }));
    expect(onSelectUser).toHaveBeenCalledWith('b');
  });

  it('renders nothing when the feed does not cover the whole week', () => {
    const { container } = render(<WeekHighlights records={STAR_FEED.slice(0, -1)} nextResetAt={NEXT_RESET} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('celebrates a clean week and nudges when nobody made it', () => {
    const { rerender } = render(<WeekHighlights records={[onTime(2, 'a'), OLD]} nextResetAt={NEXT_RESET} />);
    expect(screen.getByText('本周全员守约 🎉')).toBeInTheDocument();
    rerender(<WeekHighlights records={[rec(2, 'a', 'no_show', -12), OLD]} nextResetAt={NEXT_RESET} />);
    expect(screen.getByText('本周还没人摘星，今晚去约一局？')).toBeInTheDocument();
  });

  it('is never a heading', () => {
    render(<WeekHighlights records={STAR_FEED} nextResetAt={NEXT_RESET} />);
    expect(screen.queryAllByRole('heading')).toEqual([]);
  });

  it('a low score can still be the star, and the board names no 鸽王', () => {
    const low = [player('a', '阿杰', 100), player('b', '小红', 30)];
    const { container } = render(
      <Leaderboard
        participants={low}
        trends={{}}
        counts={{}}
        onSelect={() => {}}
        highlights={<WeekHighlights records={[onTime(3, 'b'), onTime(2, 'b'), OLD]} nextResetAt={NEXT_RESET} />}
      />,
    );
    expect(container.querySelector('.wh')?.textContent).toBe('⭐ 本周之星：小红（准时 2 次）');
    expect(container.textContent).not.toContain('鸽王');
  });
});

describe('RecordsFeed previewCount', () => {
  const many = Array.from({ length: 12 }, (_, i) => rec(100 - i, 'a', 'on_time_bonus', 2));

  it('shows the first N rows, then 看更多 reveals the rest and takes focus there', async () => {
    const user = userEvent.setup();
    const { container } = render(<RecordsFeed records={many} previewCount={10} />);
    expect(container.querySelectorAll('.feed-row')).toHaveLength(10);
    await user.click(screen.getByRole('button', { name: '看更多' }));
    const rows = container.querySelectorAll('.feed-row');
    expect(rows).toHaveLength(12);
    expect(screen.queryByRole('button', { name: '看更多' })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(rows[10]);
  });

  it('has no 看更多 when everything fits, or without previewCount', () => {
    const { rerender } = render(<RecordsFeed records={many.slice(0, 10)} previewCount={10} />);
    expect(screen.queryByRole('button', { name: '看更多' })).not.toBeInTheDocument();
    rerender(<RecordsFeed records={many} />);
    expect(screen.queryByRole('button', { name: '看更多' })).not.toBeInTheDocument();
  });

  it('keeps the .feed-row__status--escalate class for an open escalation', () => {
    const open = { ...rec(9, 'a', 'no_show', 0, 'awaiting_statement'), escalation_suggested: true };
    const { container } = render(<RecordsFeed records={[open]} previewCount={10} />);
    expect(container.querySelector('.feed-row__status--escalate')).not.toBeNull();
  });
});

describe('WeeklyReportCard compact', () => {
  const report: WeeklyReport = {
    week_start: '2026-10-19',
    stats: {
      weekStart: '2026-10-19',
      weekEnd: '2026-10-25',
      sessionsPlayed: 3,
      sessionsCollapsed: 0,
      casesFiled: 1,
      totalPenalty: -12,
      absentVerdicts: 0,
      attendanceRate: 0.8,
      upcomingNextWeek: 2,
      star: { name: '阿杰', delta: 6 },
      pigeon: { name: '老王', delta: -12 },
      bestTalker: null,
      harshest: null,
      topOrganizer: { name: '小红', count: 2 },
    },
    narrative: '平平无奇的一周。老王又鸽了一次。',
    source: 'ai',
    created_at: '2026-10-26 02:31:00',
  };

  it('shows the title, a few numbers and only the first sentence — and no award at all', () => {
    const { container } = render(<WeeklyReportCard report={report} compact />);
    expect(screen.getByRole('heading', { name: /上周战报/ })).toBeInTheDocument();
    expect(screen.getByText('平平无奇的一周。')).toBeInTheDocument();
    expect(container.querySelector('.wr-award')).toBeNull();
    expect(container.textContent).not.toContain('鸽王');
    expect(container.textContent).not.toContain('老王又鸽了一次');
    expect(container.querySelector('.wr__compact-stats')?.textContent).toBe('开局 3·立案 1·出勤率 80%');
  });

  it('keeps the stale heading and note', () => {
    render(<WeeklyReportCard report={report} compact stale />);
    expect(screen.getByRole('heading', { name: /往期战报/ })).toBeInTheDocument();
    expect(screen.getByText(/周一 10:30 之后发布/)).toBeInTheDocument();
  });

  it('is opt-in: the default card is unchanged', () => {
    const { container } = render(<WeeklyReportCard report={report} />);
    expect(container.querySelectorAll('.wr-award')).toHaveLength(3);
    expect(screen.getByText(report.narrative)).toBeInTheDocument();
  });
});

describe('RulesPanel', () => {
  const config: Config = {
    violations: [],
    tiers: [],
    weeklyHeal: 5,
    weeklyBonusCap: 5,
    statementWindowHours: 12,
    aiEnabled: false,
    maxBatchSubjects: 5,
    nextResetAt: NEXT_RESET,
  };

  it('is the #rules anchor and still toggles on its own', async () => {
    const user = userEvent.setup();
    const { container } = render(<RulesPanel config={config} />);
    expect(container.querySelector('section#rules')).not.toBeNull();
    const toggle = screen.getByRole('button', { name: /计分规则/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('follows a controlled open and reports toggles to the parent', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<RulesPanel config={config} open={false} onOpenChange={onOpenChange} />);
    const toggle = screen.getByRole('button', { name: /计分规则/ });
    await user.click(toggle);
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(toggle).toHaveAttribute('aria-expanded', 'false'); // the parent decides
    rerender(<RulesPanel config={config} open onOpenChange={onOpenChange} />);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('WelcomeCard', () => {
  const renderCard = (discordInviteUrl: string | null = null, onShowRules = vi.fn()) =>
    render(
      <WelcomeCard loginUrl="/auth/login" discordInviteUrl={discordInviteUrl} onShowRules={onShowRules} weeklyHeal={5} />,
    );

  it('says what the board is, with the heal from config', () => {
    renderCard();
    expect(screen.getByRole('heading', { name: '开黑小队的守约记分板。' })).toBeInTheDocument();
    expect(screen.getByText('说了来就来；来不了，开局前说一声。')).toBeInTheDocument();
    expect(screen.getByText(/放鸽子会被记一笔，每周一 0 点自动回血/)).toHaveTextContent('+5');
    expect(screen.getByRole('link', { name: '用 Nanako 账号登录' })).toHaveAttribute('href', '/auth/login');
    expect(screen.queryByRole('heading', { name: /约局/ })).not.toBeInTheDocument();
  });

  it('30 秒看懂 asks the page to show the rules', async () => {
    const onShowRules = vi.fn();
    const user = userEvent.setup();
    renderCard(null, onShowRules);
    await user.click(screen.getByRole('button', { name: '30 秒看懂' }));
    expect(onShowRules).toHaveBeenCalledTimes(1);
  });

  it('hides the Discord row unless an invite page is configured', () => {
    const { unmount } = renderCard(null);
    expect(screen.queryByText(/还没进 Discord 群/)).not.toBeInTheDocument();
    unmount();
    renderCard('https://discord.nanako.org/');
    const link = screen.getByRole('link', { name: '加入服务器' });
    expect(link).toHaveAttribute('href', 'https://discord.nanako.org/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('can be dismissed for good', async () => {
    const user = userEvent.setup();
    const { unmount } = renderCard();
    await user.click(screen.getByRole('button', { name: '不再显示欢迎卡' }));
    expect(screen.queryByRole('heading', { name: '开黑小队的守约记分板。' })).not.toBeInTheDocument();
    expect(window.localStorage.getItem('edg.welcome.dismissed')).toBe('1');
    unmount();
    renderCard();
    expect(screen.queryByRole('heading', { name: '开黑小队的守约记分板。' })).not.toBeInTheDocument();
  });

  it('still shows when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    renderCard();
    expect(screen.getByRole('heading', { name: '开黑小队的守约记分板。' })).toBeInTheDocument();
  });
});

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

describe('App — the board on the home page', () => {
  const ME: User = { ...TIED[2], oauth_username: 'c', is_admin: false };
  const REPORT = {
    week_start: '2026-10-19',
    stats: {
      weekStart: '2026-10-19', weekEnd: '2026-10-25', sessionsPlayed: 3, sessionsCollapsed: 0, casesFiled: 1,
      totalPenalty: -12, absentVerdicts: 0, attendanceRate: null, upcomingNextWeek: 0,
      star: null, pigeon: { name: '老王', delta: -12 }, bestTalker: null, harshest: null, topOrganizer: null,
    },
    narrative: '平平无奇的一周。',
    source: 'ai',
    created_at: '2026-10-26 02:31:00',
  };
  const routes = (me: User | null) => ({
    'GET /api/config': () =>
      json(200, {
        violations: [],
        tiers: [],
        weeklyHeal: 5,
        weeklyBonusCap: 5,
        statementWindowHours: 12,
        aiEnabled: false,
        maxBatchSubjects: 5,
        nextResetAt: NEXT_RESET,
      }),
    'GET /api/leaderboard': () => json(200, { participants: TIED }),
    'GET /api/records?limit=50': () => json(200, { records: STAR_FEED }),
    'GET /api/me': () => json(200, { user: me, pending: { statements: 0, appeals: 0 } }),
    'GET /api/me/invites': () => json(200, { sessions: [] }),
    'GET /api/report/latest': () => json(200, { report: REPORT }),
    'GET /api/sessions?scope=upcoming': () => json(200, { sessions: [] }),
  });

  it('signed out: welcome card first, one /约局/ heading, stars in the board, no 鸽王 anywhere', async () => {
    mockFetch(routes(null));
    render(<App />);
    expect(await screen.findByRole('heading', { name: /约局/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '开黑小队的守约记分板。' })).toBeInTheDocument();
    expect(screen.getByText('⭐', { exact: false }).closest('.lb')).not.toBeNull();
    expect(document.body.textContent).not.toContain('鸽王');
    expect(document.querySelector('.wr-award')).toBeNull();
    expect(document.querySelector('.tier-badge')).toBeNull();
  });

  it('30 秒看懂 opens the rules and moves focus there', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    try {
      mockFetch(routes(null));
      const user = userEvent.setup();
      render(<App />);
      await user.click(await screen.findByRole('button', { name: '30 秒看懂' }));
      const toggle = screen.getByRole('button', { name: /计分规则/ });
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await waitFor(() => expect(document.activeElement).toBe(toggle));
      expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ block: 'start' }));
      await user.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it('signed in: no welcome card, and the 段位 only on my own row', async () => {
    mockFetch(routes(ME));
    render(<App />);
    await screen.findByRole('heading', { name: /约局/ });
    await settle();
    expect(screen.queryByRole('heading', { name: '开黑小队的守约记分板。' })).not.toBeInTheDocument();
    expect(document.querySelectorAll('.lb .tier-badge')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '第 3 名 老王，96 分' })).toHaveClass('lb-row--me');
  });
});
