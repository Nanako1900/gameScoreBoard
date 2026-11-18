import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MusicPage } from '../../src/components/MusicPage';
import { MUSIC_CONSENT_TEXT } from '../../src/components/MusicLogin';
import { formatExpiry } from '../../src/lib/musicFormat';
import {
  installMusicServer, json, musicState, musicView, myAccount, queueItem, roomRef, session, track, viewPath,
  type RecordedPost,
} from './music-fixtures';
import { MUSIC_END_REASONS, type MusicEndReason, type MusicView } from '../../shared/music';

let current: () => Response;
let extra: (path: string, init?: RequestInit) => Response | Promise<Response> | undefined;
let posts: RecordedPost[];

const serve = (view: MusicView): void => { current = () => json(view); };
const commandPosts = (): RecordedPost[] => posts.filter((post) => post.path.endsWith('/commands'));
const lastCommand = (): Record<string, unknown> => commandPosts().at(-1)?.body ?? {};

beforeEach(() => {
  extra = () => undefined;
  serve(musicView());
  posts = installMusicServer({ view: () => current(), extra: (path, init) => extra(path, init) });
});

afterEach(() => { vi.useRealTimers(); });

const activeView = (over: Partial<MusicView> = {}, stateOver = {}, version = 1): MusicView =>
  musicView({ session: session({ version, state: musicState(stateOver) }), ...over });

describe('page states', () => {
  it('shows loading first, then the room', async () => {
    render(<MusicPage roomRef={roomRef} />);
    expect(screen.getByRole('status')).toHaveTextContent('音乐播放器加载中…');
    expect(await screen.findByRole('heading', { name: '深夜电台', level: 1 })).toBeInTheDocument();
  });

  it('offers a login link when unauthenticated', async () => {
    current = () => json({ error: '请先登录' }, 401);
    render(<MusicPage roomRef={roomRef} />);
    expect(await screen.findByText('登录后使用音乐播放器')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '登录 Nanako' })).toBeInTheDocument();
  });

  it('says the room is missing or hidden on 404', async () => {
    current = () => json({ error: 'Not found' }, 404);
    render(<MusicPage roomRef={roomRef} />);
    expect(await screen.findByText('房间不存在或你无权查看')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '邀请 Music 进房' })).not.toBeInTheDocument();
  });

  it('shows the server reason on 403 instead of blaming the room', async () => {
    current = () => json({ error: '请先绑定 Discord', code: 'membership_required' }, 403);
    render(<MusicPage roomRef={roomRef} />);
    expect(await screen.findByText('请先绑定 Discord')).toBeInTheDocument();
    expect(screen.queryByText('房间不存在或你无权查看')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重新加载' })).not.toBeInTheDocument();
  });

  it.each([401, 403, 404])('clears all private data when a later poll answers %i', async (status) => {
    serve(activeView({ myAccount }, { current: queueItem(1), queue: [queueItem(2)] }));
    render(<MusicPage roomRef={roomRef} />);
    expect(await screen.findByText('歌曲2')).toBeInTheDocument();
    expect(screen.getByText(myAccount.nickname)).toBeInTheDocument();
    current = () => json({ error: 'gone' }, status);
    fireEvent.focus(window);
    await waitFor(() => expect(screen.queryByText('歌曲2')).not.toBeInTheDocument());
    expect(screen.queryByText('歌曲1')).not.toBeInTheDocument();
    expect(screen.queryByText(myAccount.nickname)).not.toBeInTheDocument();
    expect(screen.queryByText('深夜电台')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('keeps the view and shows a retry hint on a transient error', async () => {
    render(<MusicPage roomRef={roomRef} />);
    await screen.findByRole('heading', { name: '深夜电台' });
    current = () => json({ error: 'boom' }, 500);
    fireEvent.focus(window);
    expect(await screen.findByText('与服务器的连接不稳定，正在重试…')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '深夜电台' })).toBeInTheDocument();
  });
});

describe('inviting Music', () => {
  it('disables the invite when the bot is offline', async () => {
    serve(musicView({ bot: { online: false, busyElsewhere: false } }));
    render(<MusicPage roomRef={roomRef} />);
    expect(await screen.findByText('Music 机器人离线')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '邀请 Music 进房' })).toBeDisabled();
  });

  it('explains when Music is busy in another room', async () => {
    serve(musicView({ bot: { online: true, busyElsewhere: true } }));
    render(<MusicPage roomRef={roomRef} />);
    expect(await screen.findByText('Music 正在其他房间使用，稍后再试')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '邀请 Music 进房' })).toBeDisabled();
  });

  it('shows the server reason when the member cannot invite', async () => {
    serve(musicView({ canInvite: false, inviteBlocked: '房间里需要至少有一位成员' }));
    render(<MusicPage roomRef={roomRef} />);
    expect(await screen.findByText('房间里需要至少有一位成员')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '邀请 Music 进房' })).toBeDisabled();
  });

  it('invites without an account option when the member has no saved account', async () => {
    extra = (path) => (path.endsWith('/invite') ? json(musicView({ session: session({ status: 'requested' }) }), 202) : undefined);
    render(<MusicPage roomRef={roomRef} />);
    expect(screen.queryByRole('checkbox', { name: '同时使用我的网易云账号' })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: '邀请 Music 进房' }));
    expect(await screen.findByText('Music 正在进房…')).toBeInTheDocument();
    const invite = posts.find((post) => post.path === `${viewPath}/invite`);
    expect(invite?.body).not.toHaveProperty('useMyAccount');
    expect(invite?.body.requestKey).toEqual(expect.any(String));
  });

  it.each([[true, true], [false, false]])('sends useMyAccount=%s according to the checkbox', async (_label, expected) => {
    serve(musicView({ myAccount }));
    extra = (path) => (path.endsWith('/invite') ? json(musicView({ myAccount, session: session({ status: 'connecting' }) }), 202) : undefined);
    render(<MusicPage roomRef={roomRef} />);
    const box = await screen.findByRole('checkbox', { name: '同时使用我的网易云账号' });
    expect(box).toBeChecked();
    if (!expected) fireEvent.click(box);
    fireEvent.click(screen.getByRole('button', { name: '邀请 Music 进房' }));
    await screen.findByText('Music 正在进房…');
    expect(posts.find((post) => post.path.endsWith('/invite'))?.body.useMyAccount).toBe(expected);
  });

  it('shows connecting for requested and connecting sessions', async () => {
    serve(musicView({ session: session({ status: 'connecting' }) }));
    render(<MusicPage roomRef={roomRef} />);
    expect(await screen.findByText('Music 正在进房…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '邀请 Music 进房' })).not.toBeInTheDocument();
  });

  it('returns to the invite when the session ends', async () => {
    serve(activeView());
    render(<MusicPage roomRef={roomRef} />);
    await screen.findByRole('region', { name: '播放器' });
    serve(musicView({ session: session({ status: 'ended' }) }));
    fireEvent.focus(window);
    expect(await screen.findByRole('button', { name: '邀请 Music 进房' })).toBeEnabled();
    expect(screen.queryByRole('region', { name: '播放器' })).not.toBeInTheDocument();
  });

  it('shows an invite error inline', async () => {
    extra = (path) => (path.endsWith('/invite') ? json({ error: '房间里没有真人' }, 409) : undefined);
    render(<MusicPage roomRef={roomRef} />);
    fireEvent.click(await screen.findByRole('button', { name: '邀请 Music 进房' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('房间里没有真人');
  });
});

describe('player', () => {
  it('shows the empty state when nothing is playing', async () => {
    serve(activeView());
    render(<MusicPage roomRef={roomRef} />);
    expect(await screen.findByText('队列是空的，搜一首歌开始吧')).toBeInTheDocument();
  });

  it('shows title, artists, a cover fallback and the status notice', async () => {
    serve(activeView({}, { current: queueItem(1), notice: '歌曲3 无法播放，已跳过' }));
    render(<MusicPage roomRef={roomRef} />);
    expect(await screen.findByRole('heading', { name: '歌曲1' })).toBeInTheDocument();
    expect(screen.getByText('歌手甲 / 歌手乙')).toBeInTheDocument();
    expect(screen.getByText('歌曲3 无法播放，已跳过').closest('[role=status]')).not.toBeNull();
    expect(document.querySelector('.music-player img')).toBeNull();
  });

  it('renders covers lazily without a referrer and with empty alt', async () => {
    serve(activeView({}, { current: queueItem(1, { track: track(1, { coverUrl: 'https://p1.music.126.net/a.jpg' }) }) }));
    render(<MusicPage roomRef={roomRef} />);
    const image = await waitFor(() => {
      const found = document.querySelector<HTMLImageElement>('.music-player img');
      if (!found) throw new Error('no cover');
      return found;
    });
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(image).toHaveAttribute('alt', '');
  });

  it('advances the progress bar from musicPosition on a 500 ms timer without calling the network', async () => {
    const now = Date.parse('2026-11-17T12:00:00Z');
    vi.useFakeTimers({ shouldAdvanceTime: true, now });
    serve(activeView({}, { current: queueItem(1), positionMs: 10_000, positionAt: new Date(now).toISOString() }));
    render(<MusicPage roomRef={roomRef} />);
    const bar = await screen.findByRole('slider', { name: '播放进度' });
    expect(bar).toHaveAttribute('aria-valuetext', '0:10 / 3:20');
    const calls = vi.mocked(fetch).mock.calls.length;
    act(() => { vi.advanceTimersByTime(1500); });
    expect(bar).toHaveAttribute('aria-valuetext', '0:11 / 3:20');
    expect(vi.mocked(fetch).mock.calls.length).toBe(calls);
  });

  it('freezes the progress bar while paused', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    serve(activeView({}, { current: queueItem(1), paused: true, positionMs: 42_000 }));
    render(<MusicPage roomRef={roomRef} />);
    const bar = await screen.findByRole('slider', { name: '播放进度' });
    act(() => { vi.advanceTimersByTime(3000); });
    expect(bar).toHaveAttribute('aria-valuetext', '0:42 / 3:20');
    expect(screen.getByRole('button', { name: '播放' })).toBeInTheDocument();
  });
});

describe('commands', () => {
  beforeEach(() => {
    extra = (path) => (path.endsWith('/commands') ? json({ accepted: true }, 202) : undefined);
  });

  it('sends pause, shows 处理中 and clears it only when the session version changes', async () => {
    serve(activeView({}, { current: queueItem(1) }, 1));
    render(<MusicPage roomRef={roomRef} />);
    fireEvent.click(await screen.findByRole('button', { name: '暂停' }));
    expect(await screen.findByRole('button', { name: '处理中' })).toBeDisabled();
    expect(lastCommand()).toMatchObject({ kind: 'pause' });
    expect(lastCommand().requestKey).toEqual(expect.any(String));
    expect(screen.queryByText('已完成')).not.toBeInTheDocument();
    serve(activeView({}, { current: queueItem(1), paused: true }, 2));
    fireEvent.focus(window);
    expect(await screen.findByRole('button', { name: '播放' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '处理中' })).not.toBeInTheDocument();
  });

  it('stops waiting after 5 seconds when the version never changes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    serve(activeView({}, { current: queueItem(1) }, 1));
    render(<MusicPage roomRef={roomRef} />);
    fireEvent.click(await screen.findByRole('button', { name: '暂停' }));
    await screen.findByRole('button', { name: '处理中' });
    act(() => { vi.advanceTimersByTime(5100); });
    expect(await screen.findByRole('button', { name: '暂停' })).toBeEnabled();
  });

  it('ignores a second click while a command is pending', async () => {
    serve(activeView({}, { current: queueItem(1) }));
    render(<MusicPage roomRef={roomRef} />);
    fireEvent.click(await screen.findByRole('button', { name: '下一首' }));
    await screen.findByRole('button', { name: '处理中' });
    expect(screen.getByRole('button', { name: '播放模式：顺序，点击切换为列表循环' })).toBeDisabled();
    expect(commandPosts()).toHaveLength(1);
  });

  it('shows an API error inline and re-enables the control', async () => {
    extra = (path) => (path.endsWith('/commands') ? json({ error: '队列已满' }, 409) : undefined);
    serve(activeView({}, { current: queueItem(1) }));
    render(<MusicPage roomRef={roomRef} />);
    fireEvent.click(await screen.findByRole('button', { name: '下一首' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('队列已满');
    expect(screen.getByRole('button', { name: '下一首' })).toBeEnabled();
  });

  it('cycles the play mode', async () => {
    serve(activeView({}, { current: queueItem(1), mode: 'shuffle' }));
    render(<MusicPage roomRef={roomRef} />);
    fireEvent.click(await screen.findByRole('button', { name: '播放模式：随机，点击切换为顺序' }));
    await waitFor(() => expect(lastCommand()).toMatchObject({ kind: 'mode', mode: 'order' }));
  });

  it('sends the volume once on commit, not on every drag tick', async () => {
    serve(activeView({}, { current: queueItem(1), volume: 80 }));
    render(<MusicPage roomRef={roomRef} />);
    const slider = await screen.findByRole('slider', { name: '音量' });
    expect(slider).toHaveAttribute('aria-valuetext', '音量 80%');
    fireEvent.input(slider, { target: { value: '60' } });
    fireEvent.input(slider, { target: { value: '40' } });
    expect(commandPosts()).toHaveLength(0);
    expect(slider).toHaveAttribute('aria-valuetext', '音量 40%');
    fireEvent.change(slider, { target: { value: '40' } });
    await waitFor(() => expect(commandPosts()).toHaveLength(1));
    expect(lastCommand()).toMatchObject({ kind: 'volume', volume: 40 });
  });

  it('seeks when the progress bar is released', async () => {
    serve(activeView({}, { current: queueItem(1) }));
    render(<MusicPage roomRef={roomRef} />);
    fireEvent.change(await screen.findByRole('slider', { name: '播放进度' }), { target: { value: '90' } });
    await waitFor(() => expect(lastCommand()).toMatchObject({ kind: 'seek', positionMs: 90_000 }));
  });

  it('asks before making Music leave', async () => {
    serve(activeView({}, { current: queueItem(1) }));
    render(<MusicPage roomRef={roomRef} />);
    fireEvent.click(await screen.findByRole('button', { name: '让 Music 离开' }));
    expect(commandPosts()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.getByRole('button', { name: '让 Music 离开' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '让 Music 离开' }));
    fireEvent.click(screen.getByRole('button', { name: '确认离开' }));
    await waitFor(() => expect(lastCommand()).toMatchObject({ kind: 'leave' }));
  });
});

describe('queue', () => {
  beforeEach(() => {
    extra = (path) => (path.endsWith('/commands') ? json({ accepted: true }, 202) : undefined);
    serve(activeView({}, { current: queueItem(1), queue: [queueItem(2), queueItem(3, { unplayable: '需要会员' })] }));
  });

  it('lists upcoming songs with their count against the limit', async () => {
    render(<MusicPage roomRef={roomRef} />);
    const queue = await screen.findByRole('region', { name: '播放队列' });
    expect(within(queue).getByText('3 / 200')).toBeInTheDocument();
    expect(within(queue).getByText('歌曲2')).toBeInTheDocument();
    expect(within(queue).getAllByText('3:20')).toHaveLength(2);
    expect(within(queue).getByText('无法播放：需要会员')).toBeInTheDocument();
  });

  it('moves a song next, removes it, and clears the queue', async () => {
    render(<MusicPage roomRef={roomRef} />);
    const queue = await screen.findByRole('region', { name: '播放队列' });
    fireEvent.click(within(queue).getAllByRole('button', { name: '下一首播放' })[1]);
    await waitFor(() => expect(lastCommand()).toMatchObject({ kind: 'move_next', key: 'k3' }));
    serve(activeView({}, { current: queueItem(1), queue: [queueItem(3), queueItem(2)] }, 2));
    fireEvent.focus(window);
    await waitFor(() => expect(within(queue).getAllByRole('button', { name: '移除' })[0]).toBeEnabled());
    fireEvent.click(within(queue).getAllByRole('button', { name: '移除' })[0]);
    await waitFor(() => expect(lastCommand()).toMatchObject({ kind: 'remove', key: 'k3' }));
    serve(activeView({}, { current: queueItem(1), queue: [queueItem(2)] }, 3));
    fireEvent.focus(window);
    await waitFor(() => expect(within(queue).getByRole('button', { name: '清空队列' })).toBeEnabled());
    fireEvent.click(within(queue).getByRole('button', { name: '清空队列' }));
    await waitFor(() => expect(lastCommand()).toMatchObject({ kind: 'clear' }));
  });
});

describe('search and playlist import', () => {
  const found = [track(11), track(12)];
  beforeEach(() => {
    serve(activeView({}, { current: queueItem(1), queue: [queueItem(2)] }));
    extra = (path) => {
      if (path.startsWith('/api/community/music/search')) return json({ tracks: found });
      if (path.endsWith('/commands')) return json({ accepted: true }, 202);
      return undefined;
    };
  });

  it('searches and queues a result', async () => {
    render(<MusicPage roomRef={roomRef} />);
    fireEvent.change(await screen.findByLabelText('搜索歌曲'), { target: { value: '晴天' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    const list = await screen.findByRole('list', { name: '搜索结果' });
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url) === '/api/community/music/search?q=%E6%99%B4%E5%A4%A9')).toBe(true);
    fireEvent.click(within(list).getAllByRole('button', { name: '加入队列' })[1]);
    await waitFor(() => expect(lastCommand()).toMatchObject({ kind: 'enqueue', tracks: [found[1]] }));
  });

  it('disables the search button for one second after each request', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<MusicPage roomRef={roomRef} />);
    fireEvent.change(await screen.findByLabelText('搜索歌曲'), { target: { value: '晴天' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    await screen.findByRole('list', { name: '搜索结果' });
    expect(screen.getByRole('button', { name: '搜索' })).toBeDisabled();
    act(() => { vi.advanceTimersByTime(1100); });
    expect(screen.getByRole('button', { name: '搜索' })).toBeEnabled();
  });

  it('shows a rate-limit answer politely as a status, not an alert', async () => {
    extra = (path) => (path.startsWith('/api/community/music/search') ? json({ error: '搜索太频繁，请稍后再试' }, 429) : undefined);
    render(<MusicPage roomRef={roomRef} />);
    fireEvent.change(await screen.findByLabelText('搜索歌曲'), { target: { value: '晴天' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    expect(await screen.findByText('搜索太频繁，请稍后再试')).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not blank the page when search answers 404', async () => {
    extra = (path) => (path.startsWith('/api/community/music/search') ? json({ error: '网易云暂不可用' }, 404) : undefined);
    render(<MusicPage roomRef={roomRef} />);
    fireEvent.change(await screen.findByLabelText('搜索歌曲'), { target: { value: '晴天' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('网易云暂不可用');
    expect(screen.getByRole('heading', { name: '深夜电台' })).toBeInTheDocument();
  });

  it('imports a playlist up to the remaining capacity and says what was left out', async () => {
    const many = Array.from({ length: 203 }, (_, index) => track(100 + index));
    serve(activeView({}, { current: queueItem(1), queue: Array.from({ length: 5 }, (_, index) => queueItem(200 + index)) }));
    extra = (path) => {
      if (path.startsWith('/api/community/music/playlist')) return json({ name: '我的歌单', tracks: many });
      if (path.endsWith('/commands')) return json({ accepted: true }, 202);
      return undefined;
    };
    render(<MusicPage roomRef={roomRef} />);
    fireEvent.change(await screen.findByLabelText('歌单链接或 ID'), { target: { value: 'https://music.163.com/playlist?id=7' } });
    fireEvent.click(screen.getByRole('button', { name: '读取歌单' }));
    expect(await screen.findByText(/我的歌单/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '全部加入' }));
    await waitFor(() => expect(commandPosts()).toHaveLength(1));
    expect((lastCommand().tracks as unknown[]).length).toBe(194);
    expect(await screen.findByText(/余下的 9 首没有加入/)).toBeInTheDocument();
  });
});

describe('netease login', () => {
  const qr = { key: 'qk', url: 'https://music.163.com/login?codekey=qk' };

  it('explains when login is unavailable and offers no QR', async () => {
    serve(musicView({ loginAvailable: false }));
    render(<MusicPage roomRef={roomRef} />);
    expect(await screen.findByText(/网易云登录暂不可用/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '显示二维码' })).not.toBeInTheDocument();
  });

  it('requires the risk acknowledgement before a QR is requested', async () => {
    extra = (path) => (path.endsWith('/login/qr') ? json(qr) : undefined);
    render(<MusicPage roomRef={roomRef} />);
    expect(await screen.findByText(/这是网易云的非官方接入，账号存在被风控的可能，请自行决定是否登录。登录态加密保存 30 天，可随时在此退出；带入房间后，房内成员可用它播放歌曲，并能看到你的网易云昵称，但看不到其他账号资料。/)).toBeInTheDocument();
    const show = screen.getByRole('button', { name: '显示二维码' });
    expect(show).toBeDisabled();
    expect(posts.some((post) => post.path.endsWith('/login/qr'))).toBe(false);
    fireEvent.click(screen.getByRole('checkbox', { name: '我已了解，继续' }));
    expect(show).toBeEnabled();
    fireEvent.click(show);
    expect(await screen.findByRole('img', { name: '网易云登录二维码' })).toBeInTheDocument();
    expect(screen.getByText('请用网易云音乐 App 扫码')).toBeInTheDocument();
  });

  it('follows scan → done every 2 seconds and then stops polling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const answers = ['waiting', 'scanned', 'done'];
    let loggedIn = false;
    serve(musicView());
    current = () => json(musicView({ myAccount: loggedIn ? myAccount : null }));
    const checks = (): number => vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/login/qr/qk')).length;
    extra = (path) => {
      if (path.endsWith('/login/qr')) return json(qr);
      if (path.includes('/login/qr/qk')) {
        const status = answers[Math.min(checks() - 1, 2)];
        if (status === 'done') loggedIn = true;
        return json({ status, account: status === 'done' ? myAccount : undefined });
      }
      return undefined;
    };
    render(<MusicPage roomRef={roomRef} />);
    fireEvent.click(await screen.findByRole('checkbox', { name: '我已了解，继续' }));
    fireEvent.click(screen.getByRole('button', { name: '显示二维码' }));
    await screen.findByRole('img', { name: '网易云登录二维码' });
    for (let poll = 0; poll < 3; poll += 1) await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
    expect(await screen.findByText(myAccount.nickname)).toBeInTheDocument();
    expect(screen.getByText('会员')).toBeInTheDocument();
    expect(screen.getByText(`有效期至 ${formatExpiry(myAccount.expiresAt)}`)).toBeInTheDocument();
    const settled = checks();
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(checks()).toBe(settled);
    expect(screen.getByRole('button', { name: '退出网易云登录' })).toBeInTheDocument();
  });

  it('shows the scanned prompt, then expiry with a refresh button', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const replies = [{ status: 'scanned' }, { status: 'expired' }];
    let index = 0;
    extra = (path) => {
      if (path.endsWith('/login/qr')) return json(qr);
      if (path.includes('/login/qr/qk')) return json(replies[Math.min(index++, 1)]);
      return undefined;
    };
    render(<MusicPage roomRef={roomRef} />);
    fireEvent.click(await screen.findByRole('checkbox', { name: '我已了解，继续' }));
    fireEvent.click(screen.getByRole('button', { name: '显示二维码' }));
    await screen.findByRole('img', { name: '网易云登录二维码' });
    await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
    expect(await screen.findByText('已扫码，请在手机上确认')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
    expect(await screen.findByText('二维码已过期')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: '网易云登录二维码' })).not.toBeInTheDocument();
    const polled = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/login/qr/qk')).length;
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/login/qr/qk')).length).toBe(polled);
    fireEvent.click(screen.getByRole('button', { name: '刷新二维码' }));
    expect(await screen.findByRole('img', { name: '网易云登录二维码' })).toBeInTheDocument();
  });

  it('stops polling the QR when the page unmounts', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    extra = (path) => (path.endsWith('/login/qr') ? json(qr) : path.includes('/login/qr/qk') ? json({ status: 'waiting' }) : undefined);
    const view = render(<MusicPage roomRef={roomRef} />);
    fireEvent.click(await screen.findByRole('checkbox', { name: '我已了解，继续' }));
    fireEvent.click(screen.getByRole('button', { name: '显示二维码' }));
    await screen.findByRole('img', { name: '网易云登录二维码' });
    view.unmount();
    const before = vi.mocked(fetch).mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(vi.mocked(fetch).mock.calls.length).toBe(before);
  });

  it('logs out of netease', async () => {
    serve(musicView({ myAccount }));
    extra = (path) => (path.endsWith('/logout') ? json({ ok: true }) : undefined);
    render(<MusicPage roomRef={roomRef} />);
    fireEvent.click(await screen.findByRole('button', { name: '退出网易云登录' }));
    await waitFor(() => expect(posts.some((post) => post.path.endsWith('/logout'))).toBe(true));
  });
});

describe('session account line', () => {
  const accountReply = (view: MusicView) => (path: string): Response | undefined =>
    (path.endsWith('/account') ? json(view) : undefined);

  it('offers my account when none is in use', async () => {
    serve(activeView({ myAccount }));
    extra = accountReply(activeView({ myAccount, session: session({ account: { nickname: myAccount.nickname, vip: true, mine: true, canStop: true } }) }));
    render(<MusicPage roomRef={roomRef} />);
    expect(await screen.findByText('当前未使用网易云账号，仅可播放免登录歌曲')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '用我的账号播放' }));
    expect(await screen.findByText('正在使用你的账号')).toBeInTheDocument();
    expect(posts.find((post) => post.path.endsWith('/account'))?.body).toMatchObject({ action: 'use' });
  });

  it('shows no switch button to a member without an account', async () => {
    serve(activeView());
    render(<MusicPage roomRef={roomRef} />);
    await screen.findByText('当前未使用网易云账号，仅可播放免登录歌曲');
    expect(screen.queryByRole('button', { name: '用我的账号播放' })).not.toBeInTheDocument();
  });

  it("names someone else's account and lets me replace it", async () => {
    serve(activeView({ myAccount, session: session({ account: { nickname: '阿杰', vip: false, mine: false, canStop: false } }) }));
    render(<MusicPage roomRef={roomRef} />);
    expect(await screen.findByText('正在使用 阿杰 的账号')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '换成我的账号' }));
    await waitFor(() => expect(posts.some((post) => post.path.endsWith('/account'))).toBe(true));
  });

  it('lets me stop sharing my own account', async () => {
    serve(activeView({ myAccount, session: session({ account: { nickname: myAccount.nickname, vip: true, mine: true, canStop: true } }) }));
    extra = accountReply(activeView({ myAccount }));
    render(<MusicPage roomRef={roomRef} />);
    expect(await screen.findByText('正在使用你的账号')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '停止使用' }));
    expect(await screen.findByText('当前未使用网易云账号，仅可播放免登录歌曲')).toBeInTheDocument();
    expect(posts.find((post) => post.path.endsWith('/account'))?.body).toMatchObject({ action: 'stop' });
  });
});

describe('polling', () => {
  const viewCalls = (): number =>
    vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url) === viewPath && init?.method !== 'POST').length;

  const setVisibility = (state: 'visible' | 'hidden'): void => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  };
  afterEach(() => setVisibility('visible'));

  it('polls every 2 seconds while visible and pauses while hidden', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<MusicPage roomRef={roomRef} />);
    await screen.findByRole('heading', { name: '深夜电台' });
    const start = viewCalls();
    await act(async () => { await vi.advanceTimersByTimeAsync(4100); });
    expect(viewCalls()).toBeGreaterThanOrEqual(start + 2);
    setVisibility('hidden');
    const hidden = viewCalls();
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(viewCalls()).toBe(hidden);
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(viewCalls()).toBeGreaterThan(hidden));
  });

  it('refreshes immediately on focus', async () => {
    render(<MusicPage roomRef={roomRef} />);
    await screen.findByRole('heading', { name: '深夜电台' });
    const before = viewCalls();
    fireEvent.focus(window);
    await waitFor(() => expect(viewCalls()).toBe(before + 1));
  });

  it('ignores a stale response that arrives after a newer one', async () => {
    let release: (response: Response) => void = () => undefined;
    let calls = 0;
    current = () => json(musicView());
    extra = (path, init) => {
      if (path !== viewPath || init?.method === 'POST') return undefined;
      calls += 1;
      if (calls === 1) return new Promise<Response>((resolve) => { release = resolve; });
      return json(musicView({ room: { ref: roomRef, name: '新房名' } }));
    };
    render(<MusicPage roomRef={roomRef} />);
    await waitFor(() => expect(calls).toBe(1));
    fireEvent.focus(window);
    expect(await screen.findByRole('heading', { name: '新房名' })).toBeInTheDocument();
    await act(async () => { release(json(musicView({ room: { ref: roomRef, name: '旧房名' } }))); });
    expect(screen.getByRole('heading', { name: '新房名' })).toBeInTheDocument();
    expect(screen.queryByText('旧房名')).not.toBeInTheDocument();
  });
});

const OFFLINE_BANNER = 'Music 机器人离线，暂时无法控制播放';
const offlineBot = { online: false, busyElsewhere: false };

describe('bot offline with a live session', () => {
  beforeEach(() => {
    extra = (path) => (path.endsWith('/commands') ? json({ accepted: true }, 202) : undefined);
  });

  it('shows a status banner and disables every control while the view keeps polling', async () => {
    const live = { current: queueItem(1), queue: [queueItem(2)] };
    const account = { nickname: '阿杰', vip: false, mine: false, canStop: true };
    serve(activeView({ bot: offlineBot, myAccount, session: session({ state: musicState(live), account }) }));
    render(<MusicPage roomRef={roomRef} />);
    expect(await screen.findByText(OFFLINE_BANNER)).toHaveAttribute('role', 'status');
    for (const name of ['暂停', '下一首', '让 Music 离开', '清空队列', '下一首播放', '移除', '换成我的账号', '停止使用']) {
      for (const button of screen.getAllByRole('button', { name })) expect(button).toBeDisabled();
    }
    expect(screen.getByRole('slider', { name: '音量' })).toBeDisabled();
    expect(screen.getByRole('slider', { name: '播放进度' })).toBeDisabled();
    const calls = (): number => vi.mocked(fetch).mock.calls.filter(([url]) => String(url) === viewPath).length;
    const before = calls();
    fireEvent.focus(window);
    await waitFor(() => expect(calls()).toBeGreaterThan(before));
  });

  it('disables search add and playlist import while offline, and recovers when the bot returns', async () => {
    const live = { current: queueItem(1) };
    extra = (path) => (path.startsWith('/api/community/music/search') ? json({ tracks: [track(11)] }) : undefined);
    serve(activeView({ bot: offlineBot }, live));
    render(<MusicPage roomRef={roomRef} />);
    fireEvent.change(await screen.findByLabelText('搜索歌曲'), { target: { value: '晴天' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    expect(await screen.findByRole('button', { name: '加入队列' })).toBeDisabled();
    serve(activeView({}, live));
    fireEvent.focus(window);
    await waitFor(() => expect(screen.queryByText(OFFLINE_BANNER)).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: '加入队列' })).toBeEnabled();
  });
});

describe('why Music left', () => {
  const REASON_TEXT: Record<MusicEndReason, string> = {
    left: 'Music 已离开房间',
    empty: '房间里没有人了，Music 已自动离开',
    idle: '长时间没有播放，Music 已自动离开',
    room_closed: '房间已关闭，Music 已离开',
    disconnected: 'Music 与语音的连接中断了，可以重新邀请',
    connect_failed: 'Music 没能进入房间，可能缺少进入该房间的权限，请联系管理员',
    bot_restarted: 'Music 机器人刚刚重启，可以重新邀请',
    shutdown: 'Music 机器人刚刚重启，可以重新邀请',
    offline: 'Music 机器人离线，播放已结束',
  };

  it.each(MUSIC_END_REASONS)('explains %s above the invite form', async (reason) => {
    serve(musicView({ lastEnded: { reason, endedAt: '2026-11-17T12:00:00Z' } }));
    render(<MusicPage roomRef={roomRef} />);
    const line = await screen.findByText(REASON_TEXT[reason]);
    expect(line).toHaveAttribute('role', 'status');
    const invite = screen.getByRole('button', { name: '邀请 Music 进房' });
    expect(line.compareDocumentPosition(invite) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('says nothing while a session is live', async () => {
    serve(activeView({ lastEnded: { reason: 'left', endedAt: '2026-11-17T12:00:00Z' } }));
    render(<MusicPage roomRef={roomRef} />);
    await screen.findByRole('region', { name: '播放器' });
    expect(screen.queryByText('Music 已离开房间')).not.toBeInTheDocument();
  });
});

describe('commands that fail after being accepted', () => {
  beforeEach(() => {
    extra = (path) => (path.endsWith('/commands') ? json({ accepted: true }, 202) : undefined);
  });

  it('shows a new myLastError once, clears pending at once, and dismisses it after 8 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    serve(activeView({}, { current: queueItem(1) }, 1));
    render(<MusicPage roomRef={roomRef} />);
    fireEvent.click(await screen.findByRole('button', { name: '下一首' }));
    await screen.findByRole('button', { name: '处理中' });
    serve(activeView({ myLastError: { id: 'e1', message: '这首歌没有版权' } }, { current: queueItem(1) }, 1));
    fireEvent.focus(window);
    expect(await screen.findByRole('alert')).toHaveTextContent('这首歌没有版权');
    expect(screen.queryByRole('button', { name: '处理中' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一首' })).toBeEnabled();
    act(() => { vi.advanceTimersByTime(8100); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.focus(window);
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(3));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('dismisses the error on the next successful command', async () => {
    serve(activeView({ myLastError: { id: 'e1', message: '这首歌没有版权' } }, { current: queueItem(1) }, 1));
    render(<MusicPage roomRef={roomRef} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('这首歌没有版权');
    fireEvent.click(screen.getByRole('button', { name: '下一首' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('releases the controls after two polls with an unchanged version, long before 5 seconds', async () => {
    serve(activeView({}, { current: queueItem(1), paused: true }, 1));
    render(<MusicPage roomRef={roomRef} />);
    fireEvent.click(await screen.findByRole('button', { name: '播放' }));
    await screen.findByRole('button', { name: '处理中' });
    fireEvent.focus(window);
    expect(await screen.findByRole('button', { name: '播放' })).toBeEnabled();
  });
});

describe('queue capacity counts the current track', () => {
  const FULL = Array.from({ length: 199 }, (_, index) => queueItem(300 + index));

  it('disables 加入队列 when current plus queue reach 200', async () => {
    extra = (path) => (path.startsWith('/api/community/music/search') ? json({ tracks: [track(11)] }) : undefined);
    serve(activeView({}, { current: queueItem(1), queue: FULL }));
    render(<MusicPage roomRef={roomRef} />);
    fireEvent.change(await screen.findByLabelText('搜索歌曲'), { target: { value: '晴天' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    expect(await screen.findByRole('button', { name: '加入队列' })).toBeDisabled();
    expect(screen.getByText('200 / 200')).toBeInTheDocument();
  });

  it('still allows adding when only the queue is at 199 and nothing plays', async () => {
    extra = (path) => (path.startsWith('/api/community/music/search') ? json({ tracks: [track(11)] }) : undefined);
    serve(activeView({}, { queue: FULL }));
    render(<MusicPage roomRef={roomRef} />);
    fireEvent.change(await screen.findByLabelText('搜索歌曲'), { target: { value: '晴天' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    expect(await screen.findByRole('button', { name: '加入队列' })).toBeEnabled();
  });
});

describe('clock skew', () => {
  it('places the progress bar with the server clock, not the browser clock', async () => {
    const browserNow = Date.parse('2026-11-17T12:00:00Z');
    const serverNow = browserNow + 3_600_000;
    vi.useFakeTimers({ shouldAdvanceTime: true, now: browserNow });
    serve(activeView(
      { serverNow: new Date(serverNow).toISOString() },
      { current: queueItem(1), positionMs: 10_000, positionAt: new Date(serverNow - 5_000).toISOString() },
    ));
    render(<MusicPage roomRef={roomRef} />);
    expect(await screen.findByRole('slider', { name: '播放进度' })).toHaveAttribute('aria-valuetext', '0:15 / 3:20');
  });

  it('falls back to no offset when serverNow is missing', async () => {
    const now = Date.parse('2026-11-17T12:00:00Z');
    vi.useFakeTimers({ shouldAdvanceTime: true, now });
    const view = activeView({}, { current: queueItem(1), positionMs: 10_000, positionAt: new Date(now - 5_000).toISOString() });
    serve({ ...view, serverNow: undefined } as unknown as MusicView);
    render(<MusicPage roomRef={roomRef} />);
    expect(await screen.findByRole('slider', { name: '播放进度' })).toHaveAttribute('aria-valuetext', '0:15 / 3:20');
  });
});

describe('account controls and consent', () => {
  it('lets an admin stop an account that is not theirs', async () => {
    serve(activeView({ session: session({ account: { nickname: '阿杰', vip: false, mine: false, canStop: true } }) }));
    render(<MusicPage roomRef={roomRef} />);
    expect(await screen.findByRole('button', { name: '停止使用' })).toBeEnabled();
  });

  it('hides stop when the caller may not stop it', async () => {
    serve(activeView({ session: session({ account: { nickname: '阿杰', vip: false, mine: false, canStop: false } }) }));
    render(<MusicPage roomRef={roomRef} />);
    await screen.findByText('正在使用 阿杰 的账号');
    expect(screen.queryByRole('button', { name: '停止使用' })).not.toBeInTheDocument();
  });

  it('tells the member the room can see their nickname', async () => {
    render(<MusicPage roomRef={roomRef} />);
    expect(await screen.findByText(MUSIC_CONSENT_TEXT)).toBeInTheDocument();
    expect(MUSIC_CONSENT_TEXT).toBe(
      '这是网易云的非官方接入，账号存在被风控的可能，请自行决定是否登录。登录态加密保存 30 天，可随时在此退出；带入房间后，房内成员可用它播放歌曲，并能看到你的网易云昵称，但看不到其他账号资料。',
    );
  });
});
