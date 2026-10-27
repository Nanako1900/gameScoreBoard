import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import type { User } from '../../src/types';
import { useDesktopViewport } from './viewport';
import { preventNavigation } from './history';

const ME: User = { id: 'me', username: '玩家', oauth_username: '玩家', avatar_url: null, is_participant: true,
  is_judge: false, is_admin: false, score: 100, created_at: '2026-10-01 00:00:00' };
const BOUND = { discord_username: 'own_name', linked_at: '2026-10-01 00:00:00', notify_dm: true, dm_ok: true };
interface Call { path: string; method: string; body: unknown }
function json(status: number, body: unknown): Response { return { ok: status >= 200 && status < 300, status,
  text: async () => JSON.stringify(body) } as Response; }
function stub(me: User | null, link: unknown, extras: Record<string, () => Response | Promise<Response>> = {}) {
  const calls: Call[] = [];
  const routes: Record<string, () => Response | Promise<Response>> = {
    'GET /api/config': () => json(200, { violations: [], tiers: [], weeklyHeal: 5, statementWindowHours: 12,
      aiEnabled: false, maxBatchSubjects: 5, nextResetAt: '2099-11-01T16:00:00Z' }),
    'GET /api/me': () => json(200, { user: me, pending: { statements: 0, appeals: 0 } }),
    'GET /api/leaderboard': () => json(200, { participants: me ? [me] : [] }),
    'GET /api/records?limit=50': () => json(200, { records: [] }),
    'GET /api/report/latest': () => json(200, { report: null }),
    'GET /api/me/discord': () => json(200, { link }), ...extras,
  };
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace(/^https?:\/\/[^/]+/, ''); const method = init?.method ?? 'GET';
    calls.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    return Promise.resolve(routes[`${method} ${path}`]?.() ?? json(404, { error: '未支持' }));
  }));
  return calls;
}
const section = (step: number): HTMLElement => screen.getByTestId(`welcome-step-${step}`);
const expanded = (step: number): HTMLElement => within(section(step)).getByRole('button', { expanded: true });
afterEach(() => vi.unstubAllGlobals());

describe('welcome page', () => {
  it('offers only login to a guest and remembers /welcome before leaving', async () => {
    stub(null, null); window.history.replaceState(null, '', '/welcome'); render(<App />);
    await screen.findByRole('heading', { name: '入户' });
    expect(expanded(1)).toBeInTheDocument();
    const login = within(section(1)).getByRole('link', { name: '用 Nanako 账号登录' });
    const restore = preventNavigation(); try { fireEvent.click(login); } finally { restore(); }
    expect(JSON.parse(sessionStorage.getItem('edg.return')!).path).toBe('/welcome');
    for (const id of [2, 3, 4, 5]) {
      expect(within(section(id)).getByRole('button')).toBeDisabled();
      expect(within(section(id)).queryByRole('link')).not.toBeInTheDocument();
    }
  });
  it.each([false, true])('opens binding first, shares its one read, and is a full page: desktop=%s', async (desktop) => {
    if (desktop) useDesktopViewport();
    const calls = stub(ME, null); window.history.replaceState(null, '', '/welcome'); render(<App />);
    await screen.findByRole('link', { name: '绑定 Discord' });
    expect(expanded(2)).toBeInTheDocument();
    expect(document.querySelector('.app__main')).toHaveAttribute('hidden');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls.filter((call) => call.path === '/api/me/discord')).toHaveLength(1);
    await userEvent.setup().click(within(section(3)).getByRole('button'));
    expect(within(section(3)).getByText('先完成上一步')).toBeInTheDocument();
  });
  it('opens the DM step when off and uses the returned server flags after enabling', async () => {
    const calls = stub(ME, { ...BOUND, notify_dm: false }, {
      'POST /api/me/discord/notify': () => json(200, { link: BOUND }),
    }); window.history.replaceState(null, '', '/welcome'); render(<App />);
    const toggle = await screen.findByRole('switch', { name: '开启私信通知' });
    expect(expanded(3)).toBeInTheDocument(); expect(toggle).not.toBeChecked();
    expect(screen.queryByRole('button', { name: '再发一次' })).not.toBeInTheDocument();
    await userEvent.setup().click(toggle);
    expect(calls.find((call) => call.path.endsWith('/notify'))).toMatchObject({ method: 'POST', body: { on: true } });
    await waitFor(() => expect(expanded(5)).toBeInTheDocument());
    expect(expanded(5)).toHaveFocus();
  });
  it.each([false, true])('explains actual DM delivery status, supports resend and never polls: dm_ok=%s', async (dm_ok) => {
    const calls = stub(ME, { ...BOUND, dm_ok }, { 'POST /api/me/discord/welcome': () => json(200, { ok: true }) });
    window.history.replaceState(null, '', '/welcome'); render(<App />);
    await screen.findByRole('heading', { name: '入户' });
    await waitFor(() => expect(calls.some((call) => call.path === '/api/me/discord')).toBe(true));
    if (dm_ok) await userEvent.setup().click(within(section(3)).getByRole('button'));
    expect(within(section(3)).queryByText(/上次私信没送到/)!==null).toBe(!dm_ok);
    if (dm_ok) expect(within(section(3)).getByText('已开启。没收到欢迎私信？点「再发一次」')).toBeInTheDocument();
    await userEvent.setup().click(within(section(3)).getByRole('button', { name: '再发一次' }));
    expect(await screen.findByText('已让机器人再发一次，去 Discord 看看；没收到就刷新本页看原因')).toBeInTheDocument();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(calls.filter((call) => call.path === '/api/me/discord')).toHaveLength(1);
    expect(calls.filter((call) => call.path.endsWith('/welcome') && call.method === 'POST')).toHaveLength(1);
  });
  it('shows server errors for resend without claiming it was sent', async () => {
    stub(ME, { ...BOUND, dm_ok: false }, { 'POST /api/me/discord/welcome': () => json(429, { error: '24 小时内已经重发 3 次，稍后再试' }) });
    window.history.replaceState(null, '', '/welcome'); render(<App />);
    await userEvent.setup().click(await screen.findByRole('button', { name: '再发一次' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('24 小时内已经重发 3 次，稍后再试');
    expect(screen.queryByText(/已让机器人再发一次/)).not.toBeInTheDocument();
  });
  it('finishes at the guide when server steps are complete, then returns home', async () => {
    stub(ME, BOUND); window.history.replaceState(null, '', '/welcome'); render(<App />);
    expect(await screen.findByRole('button', { name: '完成，去首页' })).toBeInTheDocument();
    expect(expanded(5)).toBeInTheDocument();
    expect(within(section(5)).getByText('/help')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: '完成，去首页' }));
    expect(window.location.pathname).toBe('/');
  });
  it('hides unsupported Discord controls while allowing identity setup', async () => {
    stub({ ...ME, is_participant: false }, null, { 'GET /api/me/discord': () => json(404, {}) });
    window.history.replaceState(null, '', '/welcome'); render(<App />);
    await screen.findByRole('heading', { name: '入户' });
    await waitFor(() => expect(within(section(2)).getByRole('button')).toHaveTextContent('当前后端不支持'));
    expect(expanded(2)).toBeInTheDocument();
    await userEvent.setup().click(within(section(4)).getByRole('button'));
    expect(screen.getByRole('radiogroup', { name: '选择身份' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '绑定 Discord' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '再发一次' })).not.toBeInTheDocument();
    expect(within(section(2)).getByRole('button')).not.toHaveTextContent('✓ 已完成');
    expect(within(section(3)).getByRole('button')).not.toHaveTextContent('✓ 已完成');
    await userEvent.setup().click(within(section(5)).getByRole('button'));
    expect(screen.getByRole('button', { name: '完成，去首页' })).toBeDisabled();
  });
  it('hides only unsupported new operations after a 404', async () => {
    stub(ME, { ...BOUND, dm_ok: false }); window.history.replaceState(null, '', '/welcome'); render(<App />);
    await userEvent.setup().click(await screen.findByRole('button', { name: '再发一次' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '再发一次' })).not.toBeInTheDocument());
    expect(screen.getByRole('switch')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('switch'));
    await waitFor(() => expect(screen.queryByRole('switch')).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('updates binding and DM completion immediately after unlink and keeps focus on the bind link', async () => {
    const calls = stub(ME, BOUND, { 'POST /api/me/discord/unlink': () => json(200, { ok: true }) });
    window.history.replaceState(null, '', '/welcome'); render(<App />);
    await screen.findByRole('button', { name: '完成，去首页' });
    const user = userEvent.setup();
    await user.click(within(section(2)).getByRole('button'));
    await user.click(screen.getByRole('button', { name: '解绑' }));
    await user.click(screen.getByRole('button', { name: '确认解绑' }));
    const bind = await screen.findByRole('link', { name: '绑定 Discord' });
    expect(bind).toHaveFocus();
    expect(expanded(2)).toBeInTheDocument();
    for (const id of [2, 3]) expect(within(section(id)).getByRole('button')).not.toHaveTextContent('✓ 已完成');
    expect(calls.filter((call) => call.path === '/api/me/discord')).toHaveLength(1);
  });
  it('keeps unsaved identity state mounted while opening binding and carries it through its full navigation', async () => {
    stub({ ...ME, is_participant: false, is_admin: true }, null); window.history.replaceState(null, '', '/welcome'); render(<App />);
    await screen.findByRole('link', { name: '绑定 Discord' }); const user = userEvent.setup();
    await user.click(within(section(4)).getByRole('button'));
    await user.click(screen.getByRole('radio', { name: /^裁判/ }));
    await user.click(within(section(2)).getByRole('button'));
    const restore = preventNavigation(); try { await user.click(screen.getByRole('link', { name: '绑定 Discord' })); } finally { restore(); }
    expect(JSON.parse(sessionStorage.getItem('edg.draft.onboarding')!).value.choice).toBe('judge');
  });
});

describe('guide page', () => {
  it.each([false, true])('is a public full page with help and a real back button, desktop=%s', async (desktop) => {
    if (desktop) useDesktopViewport(); stub(null, null); window.history.replaceState(null, '', '/guide'); render(<App />);
    expect(await screen.findByRole('heading', { name: '机器人指南' })).toHaveFocus();
    expect(screen.getByText('/help')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '返回' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.querySelector('.app__main')).toHaveAttribute('hidden');
  });
});
