import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiscordLinkCard } from '../../src/components/DiscordLinkCard';
import { useTodoSources } from '../../src/lib/useTodoSources';
import type { DiscordLinkValue } from '../../src/lib/discordLinkState';
import type { RecordItem, User } from '../../src/types';

const ME: User = { id: 'me', username: '玩家', oauth_username: '玩家', avatar_url: null, is_participant: true,
  is_judge: false, is_admin: true, score: 100, created_at: '2026-10-01 00:00:00' };
const OLD = { discord_username: 'own-name', linked_at: '', notify_dm: false, dm_ok: false };
const FRESH = { ...OLD, notify_dm: true, dm_ok: true };
function json(body: unknown): Response { return { ok: true, status: 200, text: async () => JSON.stringify(body) } as Response; }
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}
afterEach(() => vi.unstubAllGlobals());

describe('shared Discord state', () => {
  it('keeps a successful mutation over a late read while still accepting the concurrent appeals result', async () => {
    const discord = deferred(); const appeals = deferred();
    const record = { id: 71, status: 'appealed' } as RecordItem;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => String(input).startsWith('/api/records') ? appeals.promise : discord.promise));
    const { result } = renderHook(() => useTodoSources({ me: ME, pendingAppeals: 1, refreshKey: 0 }));
    expect(result.current.discordRead.loading).toBe(true);
    act(() => result.current.setDiscord(FRESH));
    expect(result.current.discord).toEqual(FRESH);
    await act(async () => { appeals.resolve(json({ records: [record] })); discord.resolve(json({ link: OLD })); });
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.discordRead).toEqual({ value: FRESH, loading: false, error: undefined });
    expect(result.current.appealed).toEqual([record]);
  });

  it('hides a former owner immediately and ignores their outstanding mutation callback', async () => {
    const next = deferred(); let calls = 0;
    vi.stubGlobal('fetch', vi.fn(() => ++calls === 1 ? Promise.resolve(json({ link: OLD })) : next.promise));
    const snapshots: ReturnType<typeof useTodoSources>[] = [];
    const { result, rerender } = renderHook(({ me }) => {
      const state = useTodoSources({ me, pendingAppeals: 0, refreshKey: 0 }); snapshots.push(state); return state;
    }, { initialProps: { me: ME } });
    await waitFor(() => expect(result.current.settled).toBe(true));
    const formerSetter = result.current.setDiscord;
    snapshots.length = 0; rerender({ me: { ...ME, id: 'someone-else' } });
    expect(snapshots.every((value) => value.discord === undefined && value.discordRead.loading)).toBe(true);
    act(() => formerSetter(null));
    expect(result.current.discord).toBeUndefined();
    await act(async () => next.resolve(json({ link: FRESH })));
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.discord).toEqual(FRESH);
  });

  it('does not let a refresh begun before unlink restore the removed binding', async () => {
    const refresh = deferred(); let calls = 0;
    vi.stubGlobal('fetch', vi.fn(() => ++calls === 1 ? Promise.resolve(json({ link: FRESH })) : refresh.promise));
    const { result, rerender } = renderHook(({ refreshKey }) => useTodoSources({ me: ME, pendingAppeals: 0, refreshKey }),
      { initialProps: { refreshKey: 0 } });
    await waitFor(() => expect(result.current.settled).toBe(true));
    rerender({ refreshKey: 1 });
    act(() => result.current.setDiscord(null));
    await act(async () => refresh.resolve(json({ link: FRESH })));
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.discord).toBeNull();
  });

  it('uses the supplied read without another GET and reports confirmed unlink to the shared owner', async () => {
    const changes = vi.fn();
    const fetch = vi.fn(async () => json({ ok: true })); vi.stubGlobal('fetch', fetch);
    function Host(): JSX.Element {
      const [value, setValue] = useState<DiscordLinkValue>(FRESH);
      return <DiscordLinkCard linkState={{ value, loading: false }} onChanged={(next) => { changes(next); setValue(next); }} />;
    }
    render(<Host />);
    expect(screen.getByText('@own-name')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '解绑' }));
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: '确认解绑' }));
    expect(changes).toHaveBeenCalledExactlyOnceWith(null);
    expect(await screen.findByRole('link', { name: '绑定 Discord' })).toHaveFocus();
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/me/discord/unlink', expect.objectContaining({ method: 'POST' }));
  });
  it('ignores a confirmed unlink after the component unmounts', async () => {
    const response = deferred(); const changes = vi.fn();
    vi.stubGlobal('fetch', vi.fn(() => response.promise));
    const view = render(<DiscordLinkCard linkState={{ value: FRESH, loading: false }} onChanged={changes} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '解绑' }));
    await user.click(screen.getByRole('button', { name: '确认解绑' }));
    view.unmount();
    await act(async () => response.resolve(json({ ok: true })));
    expect(changes).not.toHaveBeenCalled();
  });

});
