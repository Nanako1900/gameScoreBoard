import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { useDesktopViewport } from './viewport';
import { Header } from '../../src/components/Header';
import { AccountMenu } from '../../src/components/AccountMenu';
import { BottomTabs, showsBottomTabs } from '../../src/components/BottomTabs';
import { Skeleton } from '../../src/components/Skeleton';
import type { Config, User } from '../../src/types';
import type { Route } from '../../src/lib/routes';

const ME: User = { id: 'me', username: '小明', oauth_username: '小明', avatar_url: null, score: 100,
  is_participant: true, is_judge: false, is_admin: false, created_at: '2026-10-01 00:00:00' };
const CONFIG: Config = { violations: [], tiers: [], weeklyHeal: 5, weeklyBonusCap: 5,
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
  it('orders desktop brand, page links, reset, create and account, with the current link marked', () => {
    const { container } = render(<Header layout="drawer" route={{ name: 'board', tab: 'rules' }} config={CONFIG} me={ME}
      onLogout={vi.fn()} onOpenOnboarding={vi.fn()} onRecord={vi.fn()} myPath="/players/me" />);
    const nav = screen.getByRole('navigation', { name: '页面' });
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['大厅', '信誉榜', '规则']);
    expect(within(nav).getByRole('link', { name: '规则' })).toHaveAttribute('aria-current', 'page');
    const nodes = [screen.getByRole('link', { name: 'EDG 信誉分 首页' }), nav,
      container.querySelector('.hdr__reset')!, screen.getByRole('link', { name: '组一局' }), screen.getByRole('button', { name: /小明/ })];
    for (let i = 1; i < nodes.length; i += 1) expect(nodes[i - 1].compareDocumentPosition(nodes[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it('retains the default guest login and omits desktop controls on phones', () => {
    render(<Header config={null} me={null} onLogout={vi.fn()} onOpenOnboarding={vi.fn()} />);
    expect(screen.getByRole('link', { name: '登录' })).toHaveAttribute('href', '/auth/login');
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '组一局' })).not.toBeInTheDocument();
  });
});

describe('the shared account menu', () => {
  it.each([
    [false, false, ['我的', '编辑身份', '通知与 Discord', '退出登录']],
    [true, false, ['我的', '编辑身份', '通知与 Discord', '记一笔', '退出登录']],
    [false, true, ['我的', '编辑身份', '通知与 Discord', '记一笔', '管理', '退出登录']],
  ] as const)('orders actions for judge=%s admin=%s', async (judge, admin, expected) => {
    render(<AccountMenu me={{ ...ME, is_judge: judge, is_admin: admin }} myPath="/players/me"
      onOpenOnboarding={vi.fn()} onRecord={vi.fn()} onOpenAdmin={vi.fn()} onLogout={vi.fn()} dot />);
    const toggle = screen.getByRole('button', { name: /小明/ });
    expect(toggle).toHaveAccessibleName('小明，有待办');
    await userEvent.setup().click(toggle);
    const menu = screen.getByRole('group', { name: '账户菜单' });
    expect([...menu.querySelectorAll('a,button')].map((item) => item.textContent)).toEqual(expected);
    expect(within(menu).getByRole('link', { name: '我的' })).toHaveAttribute('href', '/players/me');
  });
  it('closes on Escape and restores the toggle, or on an outside mouse press', async () => {
    render(<AccountMenu me={ME} myPath="/players/me" onOpenOnboarding={vi.fn()} onLogout={vi.fn()} />);
    const user = userEvent.setup(); const toggle = screen.getByRole('button', { name: '小明' });
    await user.click(toggle); screen.getByRole('button', { name: '编辑身份' }).focus();
    await user.keyboard('{Escape}'); expect(toggle).toHaveFocus(); expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle); fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('group', { name: '账户菜单' })).not.toBeInTheDocument();
  });
  it('runs the existing onboarding, record, admin and logout callbacks and closes each time', async () => {
    const onboarding = vi.fn(), record = vi.fn(), admin = vi.fn(), logout = vi.fn();
    render(<AccountMenu me={{ ...ME, is_admin: true }} myPath="/players/me" onOpenOnboarding={onboarding}
      onRecord={record} onOpenAdmin={admin} onLogout={logout} />);
    const user = userEvent.setup();
    for (const label of ['编辑身份', '通知与 Discord', '记一笔', '管理', '退出登录']) {
      await user.click(screen.getByRole('button', { name: '小明' })); await user.click(screen.getByRole('button', { name: label }));
      expect(screen.queryByRole('group', { name: '账户菜单' })).not.toBeInTheDocument();
    }
    expect(onboarding).toHaveBeenCalledTimes(2); expect(record).toHaveBeenCalledOnce();
    expect(admin).toHaveBeenCalledOnce(); expect(logout).toHaveBeenCalledOnce();
  });
});

describe('bottom navigation', () => {
  it('has four destinations with an inbox count and an account attention marker', () => {
    render(<BottomTabs me={ME} route={{ name: 'home' }} todoCount={3} meDot myPath="/players/me" />);
    const nav = screen.getByRole('navigation', { name: '主导航' });
    expect(within(nav).getAllByRole('link')).toHaveLength(4);
    expect(within(nav).getByRole('link', { name: /大厅，要你处理\s*3/ })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: '信誉榜' })).toHaveAttribute('href', '/board');
    expect(within(nav).getByRole('link', { name: '组一局' })).toHaveAttribute('href', '/sessions/new');
    expect(within(nav).getByRole('link', { name: '我的，有待办' })).toHaveAttribute('href', '/players/me');
  });
  it('marks board subpages and my own page, without an empty badge', () => {
    const { rerender } = render(<BottomTabs me={ME} route={{ name: 'board', tab: 'feed' }} todoCount={0} meDot={false} myPath="/players/me" />);
    expect(screen.getByRole('link', { name: '信誉榜' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: '大厅' })).not.toHaveAttribute('aria-current');
    rerender(<BottomTabs me={ME} route={{ name: 'player', userId: 'me' }} todoCount={0} meDot={false} myPath="/players/me" />);
    expect(screen.getByRole('link', { name: '我的' })).toHaveAttribute('aria-current', 'page');
  });
  it('uses a login link for visitors and saves the create destination before login', () => {
    render(<BottomTabs me={null} route={{ name: 'home' }} todoCount={0} meDot={false} myPath="/" />);
    const create = screen.getByRole('link', { name: '组一局' });
    expect(create).toHaveAttribute('href', '/auth/login');
    expect(screen.getByRole('link', { name: '我的' })).toHaveAttribute('href', '/auth/login');
    create.addEventListener('click', (event) => event.preventDefault()); fireEvent.click(create);
    expect(JSON.parse(window.sessionStorage.getItem('edg.return')!).path).toBe('/sessions/new');
  });
  it.each([{ name: 'sessionNew' }, { name: 'rollcall', sessionId: 5 }] satisfies Route[])('is absent on $name pages', (route) => {
    expect(showsBottomTabs(route)).toBe(false);
    render(<BottomTabs me={ME} route={route} todoCount={0} meDot={false} myPath="/players/me" />);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(showsBottomTabs({ name: 'board', tab: 'rules' })).toBe(true);
  });
});

describe('loading skeleton', () => {
  it('announces the block as busy without creating headings or exposing its bars', () => {
    const { container } = render(<Skeleton label="约局加载中" lines={2} className="extra" />);
    const skeleton = container.querySelector('.skel');
    expect(skeleton).toHaveAttribute('aria-busy', 'true'); expect(skeleton).toHaveClass('extra');
    expect(screen.getByText('约局加载中')).toHaveClass('visually-hidden');
    expect(skeleton?.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
    expect(container.querySelector('h1,h2,h3,h4,h5,h6')).toBeNull();
  });
});


function homeFetch(): void {
  const participants = Array.from({ length: 12 }, (_, i) => ({ ...ME, id: i === 11 ? ME.id : `p${i}`, username: i === 11 ? ME.username : `玩家${i}`, score: 100 - i }));
  const json = (body: unknown): Response => ({ ok: true, status: 200, text: async () => JSON.stringify(body) }) as Response;
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const path = String(input);
    if (path === '/api/config') return Promise.resolve(json(CONFIG));
    if (path === '/api/me') return Promise.resolve(json({ user: { ...ME, score: 89 }, pending: { statements: 0, appeals: 0 } }));
    if (path === '/api/leaderboard') return Promise.resolve(json({ participants }));
    if (path === '/api/records?limit=50') return Promise.resolve(json({ records: [] }));
    if (path === '/api/report/latest') return Promise.resolve(json({ report: null }));
    if (path === '/api/me/discord') return Promise.resolve({ ok: false, status: 404, text: async () => '{}' } as Response);
    return Promise.resolve(json({ sessions: [] }));
  }));
}
afterEach(() => { vi.unstubAllGlobals(); });
describe('home layout integration', () => {
  it('desktop DOM puts inbox and sessions before a sticky side with score and nine rows plus me', async () => {
    useDesktopViewport(); homeFetch(); render(<App />); await screen.findByText('没有待办，清清爽爽 ✨');
    const main = document.querySelector('.app__lobby-main')!; const side = document.querySelector('.app__lobby-side')!;
    expect(main.compareDocumentPosition(side) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(main as HTMLElement).getAllByRole('heading').map((h) => h.textContent)).toEqual(['要你处理', '📅 约局', '最近结束']);
    expect(side.querySelector('.msl--card')).not.toBeNull(); expect(side.querySelectorAll('.lb-row')).toHaveLength(10);
    expect(within(side as HTMLElement).getByRole('button', { name: '第 12 名 小明，89 分' })).toBeInTheDocument();
    expect(side.querySelector('.lb__ellipsis')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('navigation', { name: '主导航' })).not.toBeInTheDocument();
  });
  it('phone DOM puts score after the inbox, then sessions and a five-row board plus me', async () => {
    homeFetch(); render(<App />); await screen.findByText('没有待办，清清爽爽 ✨');
    const main = document.querySelector('.app__main')!;
    const blocks = [...main.children].filter((el) => el.tagName === 'SECTION');
    expect(blocks.map((el) => el.classList[0])).toEqual(['todo', 'msl', 'sessions', 'lb', 'recent']);
    expect(main.querySelectorAll('.lb-row')).toHaveLength(6); expect(screen.getByRole('link', { name: '完整榜' })).toHaveAttribute('href', '/board');
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument();
  });
  it('first load has a header and three busy skeletons, with no headings or navigation', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {}))); render(<App />);
    expect(screen.getByText('信誉分加载中…').closest('[role="status"]')).not.toBeNull(); expect(document.querySelectorAll('.skel')).toHaveLength(3);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument(); expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });
});
