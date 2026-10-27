import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RouteView } from '../../src/components/RouteView';
import { ToastProvider } from '../../src/components/Toast';
import { WelcomePage } from '../../src/components/WelcomePage';
import type { DiscordLinkRead } from '../../src/lib/discordLinkState';
import type { Config, User } from '../../src/types';

const ME: User = { id: 'a', username: '玩家甲', oauth_username: '玩家甲', avatar_url: null, is_participant: true,
  is_judge: false, is_admin: false, score: 100, created_at: '2026-10-01 00:00:00' };
const BOUND = { discord_username: 'own-name', linked_at: '', notify_dm: true, dm_ok: false };
const props = { me: ME, discord: { value: BOUND, loading: false }, onDiscordChanged() {}, onSaved() {}, onComplete() {} };
afterEach(() => vi.unstubAllGlobals());

describe('welcome lifecycle', () => {
  it('can resend after StrictMode replays mount effects', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => '{"ok":true}' })));
    render(<StrictMode><ToastProvider><WelcomePage {...props} /></ToastProvider></StrictMode>);
    await userEvent.setup().click(screen.getByRole('button', { name: '再发一次' }));
    expect(await screen.findByText('已让机器人再发一次，去 Discord 看看；没收到就刷新本页看原因')).toBeInTheDocument();
  });

  it('replaces the previous account identity fields when the route receives a different user', async () => {
    const config: Config = { violations: [], tiers: [], weeklyHeal: 5, statementWindowHours: 12,
      aiEnabled: false, maxBatchSubjects: 5, nextResetAt: '2099-11-01T16:00:00Z' };
    const route = (me: User) => <ToastProvider><RouteView location={{ pathname: '/welcome', search: '', route: { name: 'welcome' } }}
      layout="page" me={me} config={config} pinned={null} playerRefreshKey={0} onPinned={() => {}}
      onChanged={() => {}} onOpenStatement={() => {}} discordRead={{ value: { ...BOUND, dm_ok: true }, loading: false }} /></ToastProvider>;
    const view = render(route(ME)); const user = userEvent.setup();
    await user.click(within(screen.getByTestId('welcome-step-4')).getByRole('button'));
    await user.click(screen.getByRole('radio', { name: /自定义/ }));
    await user.type(screen.getByRole('textbox', { name: '自定义显示名字' }), '旧账号的未保存名字');
    view.rerender(route({ ...ME, id: 'b', username: '玩家乙', oauth_username: '玩家乙' }));
    expect(screen.queryByDisplayValue('旧账号的未保存名字')).not.toBeInTheDocument();
    await user.click(within(screen.getByTestId('welcome-step-4')).getByRole('button'));
    expect(screen.getByRole('radio', { name: /用 Nanako 名字.*玩家乙/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('does not continue an old account save or publish its result after the account changes', async () => {
    let release!: (value: Response) => void;
    const delayed = new Promise<Response>((resolve) => { release = resolve; });
    const fetch = vi.fn(() => delayed); vi.stubGlobal('fetch', fetch);
    const saved = vi.fn();
    const route = (me: User) => <ToastProvider><RouteView location={{ pathname: '/welcome', search: '', route: { name: 'welcome' } }}
      layout="page" me={me} config={{} as Config} pinned={null} playerRefreshKey={0} onPinned={() => {}}
      onChanged={() => {}} onOpenStatement={() => {}} onMeUpdated={saved}
      discordRead={{ value: { ...BOUND, dm_ok: true }, loading: false }} /></ToastProvider>;
    const view = render(route(ME)); const user = userEvent.setup();
    await user.click(within(screen.getByTestId('welcome-step-4')).getByRole('button'));
    await user.click(screen.getByRole('button', { name: '确认' }));
    expect(fetch).toHaveBeenCalledTimes(1);
    view.rerender(route({ ...ME, id: 'b', username: '玩家乙', oauth_username: '玩家乙' }));
    await act(async () => release({ ok: true, status: 200, text: async () => JSON.stringify({ user: ME }) } as Response));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(saved).not.toHaveBeenCalled();
  });

  it.each<DiscordLinkRead>([{ value: undefined, loading: true }, { value: 'error', loading: false, error: '读取失败' }])(
    'does not turn loading or a failed Discord read into server completion: %o', (discord) => {
      render(<ToastProvider><WelcomePage {...props} discord={discord} /></ToastProvider>);
      for (const step of [2, 3]) {
        const card = screen.getByTestId(`welcome-step-${step}`);
        expect(within(card).getByRole('button')).not.toHaveTextContent('✓ 已完成');
      }
      expect(within(screen.getByTestId('welcome-step-2')).getByRole('button')).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('button', { name: '完成，去首页', hidden: true })).toBeDisabled();
    },
  );
});
