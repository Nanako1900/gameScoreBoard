import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoardPage, type BoardData } from '../../src/components/BoardPage';
import { App } from '../../src/App';
import { PlayerDetail } from '../../src/components/PlayerDetail';
import { useDesktopViewport } from './viewport';
import type { Config, WeeklyReport } from '../../src/types';
import type { BoardTab } from '../../src/lib/routes';

const CONFIG: Config = { violations: [], tiers: [], weeklyHeal: 5, weeklyBonusCap: 5,
  statementWindowHours: 12, aiEnabled: false, maxBatchSubjects: 5, nextResetAt: '2026-11-01T16:00:00Z', boardTzOffsetHours: 8 };
const REPORT: WeeklyReport = { week_start: '2026-10-19', narrative: '大家好好约局。', source: 'ai', created_at: '2026-10-26 02:30:00',
  stats: { weekStart: '2026-10-19', weekEnd: '2026-10-25', sessionsPlayed: 3, sessionsCollapsed: 0,
    casesFiled: 2, totalPenalty: -6, absentVerdicts: 0, attendanceRate: 0.8, upcomingNextWeek: 1,
    star: { name: '守约之星', delta: 4 }, pigeon: { name: '慢慢恢复', delta: -6 },
    bestTalker: { name: '好好解释', savedBy: 3 }, harshest: null, topOrganizer: null, basis: 'verdict' } };
const DATA: BoardData = { participants: [], records: [], report: REPORT, reportStale: false, trends: {}, counts: {},
  regenerating: false, onSelectUser: () => {} };

function mockApp() {
  const routes: Record<string, unknown> = {
    '/api/config': CONFIG, '/api/leaderboard': { participants: [] }, '/api/records?limit=50': { records: [] },
    '/api/me': { user: null, pending: { statements: 0, appeals: 0 } }, '/api/report/latest': { report: REPORT },
  };
  const fetch = vi.fn((input: RequestInfo | URL) => {
    const path = String(input); const status = routes[path] === undefined ? 404 : 200;
    return Promise.resolve({ ok: status === 200, status, text: async () => JSON.stringify(routes[path] ?? { error: '不存在' }) } as Response);
  });
  vi.stubGlobal('fetch', fetch); return fetch;
}
afterEach(() => { vi.unstubAllGlobals(); });

describe('the board destination', () => {
  it.each([
    ['list', '全部选手', '榜单'], ['feed', '最新动态', '动态'],
    ['report', /上周战报/, '战报'], ['rules', '30 秒看懂', '规则'],
  ] as const)('shows %s as an ordinary page with navigation links', (tab, heading, current) => {
    render(<BoardPage tab={tab} config={CONFIG} me={null} data={DATA} />);
    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: '信誉榜' });
    expect(nav.querySelectorAll('a')).toHaveLength(4);
    expect(screen.getByRole('link', { name: current })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '返回' })).not.toBeInTheDocument();
  });
  it('focuses the title on entry, but leaves focus on the clicked subpage link', async () => {
    const { rerender } = render(<BoardPage tab="list" config={CONFIG} me={null} data={DATA} />);
    expect(screen.getByRole('heading', { name: '信誉榜' })).toHaveFocus();
    const link = screen.getByRole('link', { name: '动态' });
    await userEvent.setup().click(link);
    rerender(<BoardPage tab="feed" config={CONFIG} me={null} data={DATA} />);
    expect(link).toHaveFocus(); expect(link).toHaveAttribute('aria-current', 'page');
  });
  it('shows the full report even after home dismissal, with no pigeon award or dismiss action', () => {
    window.localStorage.setItem('edg.report.dismissed', REPORT.week_start);
    const { container } = render(<BoardPage tab="report" config={CONFIG} me={null} data={DATA} />);
    expect(screen.getByText(REPORT.narrative)).toBeInTheDocument();
    expect(screen.getByText('上周之星')).toBeInTheDocument();
    expect(screen.getByText('最会说话')).toBeInTheDocument();
    expect(container.querySelectorAll('.wr-award')).toHaveLength(2);
    expect(screen.queryByText('上周鸽王')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '本周不再显示' })).not.toBeInTheDocument();
  });
  it('reads heal from config and renders the four guide cards, glossary, and open rules without blurb', () => {
    const { container } = render(<BoardPage tab="rules" config={CONFIG} me={null} />);
    for (const heading of ['约局', '守约', '分数与回血', '出事了怎么办', '用词表']) {
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    }
    expect(screen.getByText(/每人从 100 分起/)).toHaveTextContent('回血 +5');
    expect(screen.getByText(/每人从 100 分起/)).toHaveTextContent('北京时间');
    expect(screen.getByText('AI 裁决 / 保底判')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '计分规则' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /计分规则/ })).not.toBeInTheDocument();
    expect(container.querySelector('.rules__tier-blurb')).toBeNull();
  });
  it.each(['list', 'feed', 'report'] as BoardTab[])('has an empty state without data: %s', (tab) => {
    render(<BoardPage tab={tab} config={CONFIG} me={null} />);
    if (tab === 'report') expect(screen.getByText('还没有战报。每周一 10:30 之后发布上周的。')).toBeInTheDocument();
    else expect(screen.getByRole('heading', { name: tab === 'list' ? '全部选手' : '最新动态' })).toBeInTheDocument();
  });
});

describe('board route integration', () => {
  it.each([false, true])('opens a board page over the hidden hall, desktop=%s', async (desktop) => {
    if (desktop) useDesktopViewport();
    window.history.replaceState(null, '', '/board/feed'); mockApp(); render(<App />);
    expect(await screen.findByRole('heading', { name: '最新动态' })).toBeInTheDocument();
    expect(document.querySelector('.app__main')).toHaveAttribute('hidden');
    expect(screen.getByRole('heading', { name: '信誉榜' })).toHaveFocus();
  });
  it('links home to the full report and all recent activity', async () => {
    mockApp(); render(<App />);
    expect(await screen.findByRole('link', { name: '读全文' })).toHaveAttribute('href', '/board/report');
    expect(screen.getByRole('link', { name: '全部动态' })).toHaveAttribute('href', '/board/feed');
  });
  it.each(['/board', '/board/report', '/board/rules'])('keeps block labels unique over the hidden hall: %s', async (path) => {
    window.history.replaceState(null, '', path); mockApp(); render(<App />);
    await screen.findByRole('heading', { name: '信誉榜' });
    if (path === '/board') expect(screen.getByRole('region', { name: '全部选手' })).toBeInTheDocument();
    const ids = [...document.querySelectorAll('[id]')].map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('offers a board destination for a missing player', async () => {
    mockApp();
    render(<PlayerDetail userId="gone" me={null} config={CONFIG} variant="page" onClose={() => {}} onChanged={() => {}} onOpenStatement={() => {}} />);
    expect(await screen.findByRole('link', { name: '看信誉榜' })).toHaveAttribute('href', '/board');
    expect(screen.getAllByRole('link', { name: '回大厅' })).toHaveLength(1);
  });
});
