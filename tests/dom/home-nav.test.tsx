import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { useDesktopViewport } from './viewport';
import { Header } from '../../src/components/Header';
import { AccountMenu } from '../../src/components/AccountMenu';
import { Skeleton } from '../../src/components/Skeleton';
import type { Config, User } from '../../src/types';

const ME: User = { id: 'me', username: '小明', oauth_username: '小明', avatar_url: null, score: 100,
  is_participant: true, is_judge: false, is_admin: false, created_at: '2026-10-01 00:00:00' };
const CONFIG: Config = { violations: [], tiers: [], weeklyHeal: 5,
  statementWindowHours: 12, aiEnabled: false, maxBatchSubjects: 5, nextResetAt: '2099-11-01T16:00:00Z' };

describe('header navigation', () => {
  it('keeps the brand and reset while pending, without navigation or account controls', () => {
    const { container } = render(<Header pending layout="drawer" config={null} me={ME}
      onLogout={vi.fn()} onOpenOnboarding={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'EDG 信誉分 首页' })).toHaveAttribute('href', '/');
    expect(container.querySelector('.hdr__reset-time')).toHaveTextContent('—');
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(container.querySelector('h1,h2,h3,h4,h5,h6')).toBeNull();
  });
  it.each(['page', 'drawer'] as const)('keeps one ordered navigation and DOM order for layout=%s', (layout) => {
    const { container } = render(<Header layout={layout} route={{ name: 'tools', tab: 'voice' }} config={CONFIG} me={ME}
      onLogout={vi.fn()} onOpenOnboarding={vi.fn()} onRecord={vi.fn()} myPath="/players/me" />);
    const nav = screen.getByRole('navigation', { name: '主导航' });
    expect(screen.getAllByRole('navigation')).toHaveLength(1);
    expect(within(nav).getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')]))
      .toEqual([['首页', '/'], ['信誉榜', '/board'], ['案件', '/cases'], ['设置', '/settings/profile']]);
    expect(within(nav).getByRole('link', { name: '案件' })).toHaveAttribute('aria-current', 'page');
    const nodes = [screen.getByRole('link', { name: 'EDG 信誉分 首页' }), nav,
      container.querySelector('.hdr__reset')!, screen.getByRole('button', { name: /小明/ })];
    for (let i = 1; i < nodes.length; i += 1) expect(nodes[i - 1].compareDocumentPosition(nodes[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it('keeps the same four links for visitors with the existing login flow', () => {
    render(<Header config={null} me={null} todoCount={3} onLogout={vi.fn()} onOpenOnboarding={vi.fn()} />);
    expect(screen.getByRole('link', { name: '登录' })).toHaveAttribute('href', '/auth/login');
    const nav = screen.getByRole('navigation', { name: '主导航' });
    expect(within(nav).getAllByRole('link').map(link => link.textContent)).toEqual(['首页', '信誉榜', '案件', '设置']);
    expect(within(nav).getByRole('link', { name: '设置' })).toHaveAttribute('href', '/settings/profile');
    expect(screen.queryByRole('link', { name: '组一局' })).not.toBeInTheDocument();
  });
  it('places a signed-in inbox count on cases, without a zero badge', () => {
    const { rerender } = render(<Header route={{ name: 'cases' }} me={ME} config={CONFIG} todoCount={3}
      onLogout={vi.fn()} onOpenOnboarding={vi.fn()} />);
    const nav = screen.getByRole('navigation', { name: '主导航' });
    expect(within(nav).getByRole('link', { name: /案件，要你处理\s*3/ })).toHaveAttribute('href', '/cases');
    expect(within(nav).getByRole('link', { name: '首页' })).not.toHaveTextContent('3');
    rerender(<Header route={{ name: 'cases' }} me={ME} config={CONFIG} todoCount={0}
      onLogout={vi.fn()} onOpenOnboarding={vi.fn()} />);
    expect(within(nav).getByRole('link', { name: '案件' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).queryByText('0')).not.toBeInTheDocument();
  });
  it('marks my own profile as home, other players as board, and old admin settings as settings', () => {
    const props = { me: ME, config: CONFIG, onLogout: vi.fn(), onOpenOnboarding: vi.fn() };
    const { rerender } = render(<Header {...props} route={{ name: 'player', userId: ME.id }} />);
    expect(screen.getByRole('link', { name: '首页' })).toHaveAttribute('aria-current', 'page');
    rerender(<Header {...props} route={{ name: 'player', userId: 'another' }} />);
    expect(screen.getByRole('link', { name: '信誉榜' })).toHaveAttribute('aria-current', 'page');
    rerender(<Header {...props} route={{ name: 'admin', tab: 'ai' }} />);
    expect(screen.getByRole('link', { name: '设置' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('the shared account menu', () => {
  it.each([[false, false], [true, false], [false, true]] as const)
    ('only provides my record and logout for judge=%s admin=%s', async (judge, admin) => {
      render(<AccountMenu me={{ ...ME, is_judge: judge, is_admin: admin }} myPath="/players/me"
        onOpenOnboarding={vi.fn()} onRecord={vi.fn()} onOpenAdmin={vi.fn()} onLogout={vi.fn()} dot />);
      const toggle = screen.getByRole('button', { name: /小明/ });
      expect(toggle).toHaveAccessibleName('小明，有待办');
      await userEvent.setup().click(toggle);
      const menu = screen.getByRole('group', { name: '账户菜单' });
      expect([...menu.querySelectorAll('a,button')].map((item) => item.textContent)).toEqual(['我的记录', '退出登录']);
      expect(within(menu).getByRole('link', { name: '我的记录' })).toHaveAttribute('href', '/players/me');
    });
  it.each(['judge', 'admin'] as const)('does not duplicate settings or tools for %s', async (role) => {
    render(<AccountMenu me={{ ...ME, is_judge: role === 'judge', is_admin: role === 'admin' }}
      myPath="/players/me" onOpenOnboarding={vi.fn()} onLogout={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole('button', { name: '小明' }));
    expect(screen.queryByRole('link', { name: '管理' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '编辑身份' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '记一笔' })).not.toBeInTheDocument();
  });
  it('closes on Escape and restores the toggle, or on an outside mouse press', async () => {
    render(<AccountMenu me={ME} myPath="/players/me" onOpenOnboarding={vi.fn()} onLogout={vi.fn()} />);
    const user = userEvent.setup(); const toggle = screen.getByRole('button', { name: '小明' });
    await user.click(toggle); screen.getByRole('link', { name: '我的记录' }).focus();
    await user.keyboard('{Escape}'); expect(toggle).toHaveFocus(); expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle); fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('group', { name: '账户菜单' })).not.toBeInTheDocument();
  });
  it('keeps old callbacks compatible without exposing old actions', async () => {
    const onboarding = vi.fn(), record = vi.fn(), admin = vi.fn(), logout = vi.fn();
    render(<AccountMenu me={{ ...ME, is_admin: true }} myPath="/players/me" onOpenOnboarding={onboarding}
      onRecord={record} onOpenAdmin={admin} onLogout={logout} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '小明' }));
    await user.click(screen.getByRole('button', { name: '退出登录' }));
    expect(screen.queryByRole('group', { name: '账户菜单' })).not.toBeInTheDocument();
    expect(onboarding).not.toHaveBeenCalled(); expect(record).not.toHaveBeenCalled();
    expect(admin).not.toHaveBeenCalled(); expect(logout).toHaveBeenCalledOnce();
  });
});

describe('loading skeleton', () => {
  it('announces the block as busy without creating headings or exposing its bars', () => {
    const { container } = render(<Skeleton label="最近案件加载中" lines={2} className="extra" />);
    const skeleton = container.querySelector('.skel');
    expect(skeleton).toHaveAttribute('aria-busy', 'true'); expect(skeleton).toHaveClass('extra');
    expect(screen.getByText('最近案件加载中')).toHaveClass('visually-hidden');
    expect(skeleton?.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
    expect(container.querySelector('h1,h2,h3,h4,h5,h6')).toBeNull();
  });
});

function homeFetch(signedIn = true): void {
  const participants = Array.from({ length: 12 }, (_, i) => ({ ...ME, id: i === 11 ? ME.id : `p${i}`, username: i === 11 ? ME.username : `玩家${i}`, score: 100 - i }));
  const json = (body: unknown): Response => ({ ok: true, status: 200, text: async () => JSON.stringify(body) }) as Response;
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const path = String(input);
    if (path === '/api/config') return Promise.resolve(json(CONFIG));
    if (path === '/api/me') return Promise.resolve(json({ user: signedIn ? { ...ME, score: 89 } : null, pending: { statements: 0, appeals: 0 } }));
    if (path === '/api/leaderboard') return Promise.resolve(json({ participants }));
    if (path === '/api/records?limit=50') return Promise.resolve(json({ records: Array.from({ length: 7 }, (_, i) => ({
      id: i + 1, subject: { id: 'p0', username: '玩家0', avatar_url: null }, reporter: { id: 'j', username: '裁判', avatar_url: null },
      type: 'no_show', delta: -10, note: null, claim: null, claim_summary: null, classified_by: 'human', escalation_suggested: false,
      session_id: null, statement: null, statement_at: null, appeal_reason: null, deadline_at: null, status: 'decided', verdict: null,
      range: { min: -20, max: -10, base: -15 }, created_at: '2026-10-27 00:00:00',
    })) }));
    if (path === '/api/report/latest') return Promise.resolve(json({ report: { week_start: '2026-10-19', stats: { weekStart: '2026-10-19', weekEnd: '2026-10-25', casesFiled: 2, totalPenalty: -10, absentVerdicts: 0, star: null, pigeon: null, bestTalker: null, harshest: null }, narrative: '大家继续守约。', source: 'fallback', created_at: '2026-10-26 00:00:00' } }));
    if (path === '/api/me/discord') return Promise.resolve({ ok: false, status: 404, text: async () => '{}' } as Response);
    return Promise.resolve(json({ sessions: [] }));
  }));
}
afterEach(() => { vi.unstubAllGlobals(); });
describe('home layout integration', () => {
  it.each([false, true])('keeps a compact signed-in overview in reading order, desktop=%s', async (desktop) => {
    if (desktop) useDesktopViewport();
    homeFetch(); render(<App />); await screen.findByText('当前没有待办。');
    const main = document.querySelector('.app__main')!;
    const score = within(main as HTMLElement).getByRole('region', { name: '我的分数' });
    const recent = within(main as HTMLElement).getByRole('region', { name: '最近判决' });
    expect(score.compareDocumentPosition(recent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(main.querySelector('.lb')).toBeNull();
    expect(within(recent).getAllByRole('listitem')).toHaveLength(3);
    expect(within(recent).queryByRole('button', { name: '看更多' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '全部案件' })).toHaveAttribute('href', '/cases?view=public');
    expect(screen.getByRole('link', { name: '阅读战报' })).toHaveAttribute('href', '/board/report');
    expect(screen.queryByText('大家继续守约。')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '计分规则' })).toHaveAttribute('href', '/board/rules');
    expect(screen.getByRole('link', { name: '机器人指南' })).toHaveAttribute('href', '/guide');
    expect(document.querySelector('.btabs')).toBeNull();
  });
  it.each([false, true])('gives visitors a compact welcome and three verdicts, desktop=%s', async (desktop) => {
    if (desktop) useDesktopViewport();
    homeFetch(false); render(<App />);
    await screen.findByRole('heading', { name: '最近判决' });
    const main = document.querySelector('.app__main')!;
    expect(main.querySelector('.lb')).toBeNull();
    expect(within(screen.getByRole('region', { name: '最近判决' })).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByRole('region', { name: '我的分数' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '看更多' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '全部案件' })).toHaveAttribute('href', '/cases?view=public');
    expect(screen.getByRole('link', { name: '阅读战报' })).toHaveAttribute('href', '/board/report');
    expect(screen.getByRole('navigation', { name: '主导航' }).querySelectorAll('a')).toHaveLength(4);
    expect(document.querySelector('.btabs')).toBeNull();
  });
  it('first load has a header and three busy skeletons, with no headings or navigation', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {}))); render(<App />);
    expect(screen.getByText('信誉分加载中…').closest('[role="status"]')).not.toBeNull(); expect(document.querySelectorAll('.skel')).toHaveLength(3);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument(); expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });
});
