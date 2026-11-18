import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { MUSIC_MAX_CONSECUTIVE_FAILURES } from '../src/music/runtime';
import { MUSIC_ACCOUNT_DROPPED_NOTICE, MUSIC_RESUME_MAX_PAUSE_MS } from '../src/music/runtime-playback';
import { activeHarness } from './music-runtime.fixture';

describe('music runtime: playback', () => {
  it('enqueue resolves the track with the account cookie and plays at the current position and volume', async () => {
    const h = await activeHarness();
    h.store.sessions = h.store.sessions.map((s) => ({ ...s, accountOwner: 'owner', state: { ...s.state, volume: 40 } }));
    h.control.cookie = 'MUSIC_U=abc';
    const id = h.store.enqueue(1, 2);
    await h.runtime.tick();
    expect(h.resolved).toEqual([{ trackId: 'netease:1', cookie: 'MUSIC_U=abc' }]);
    expect(h.audio).toEqual(['https://m701.music.126.net/netease:1.mp3']);
    expect(h.voice.plays.map(({ seekMs, volume }) => ({ seekMs, volume }))).toEqual([{ seekMs: 0, volume: 40 }]);
    expect(h.store.state().current!.track.id).toBe('netease:1');
    expect(h.store.state().queue.map((q) => q.track.id)).toEqual(['netease:2']);
    expect(h.store.result(id)).toEqual({ status: 'done', error: null });
  });

  it('seek restarts playback from the requested position', async () => {
    const h = await activeHarness();
    h.store.enqueue(1);
    await h.runtime.tick();
    h.store.command('seek', { positionMs: 30_000 });
    await h.runtime.tick();
    expect(h.voice.plays.at(-1)!.seekMs).toBe(30_000);
  });

  it('plays a new track from its start even when resolving took a while, then re-anchors the position', async () => {
    let clockRef: { advance(ms: number): void } | null = null;
    const h = await activeHarness({
      openAudio: async () => { clockRef!.advance(3_000); return Readable.from([Buffer.from('x')]); },
    });
    clockRef = h.clock;
    h.store.enqueue(1);
    await h.runtime.tick();
    expect(h.voice.plays.map((p) => p.seekMs)).toEqual([0]);
    expect(h.store.state().positionMs).toBe(0);
    expect(h.store.state().positionAt).toBe(new Date(h.clock.now()).toISOString());
  });

  it('applies a volume changed while paused by restarting at the paused position', async () => {
    const h = await activeHarness();
    h.store.enqueue(1);
    await h.runtime.tick();
    h.clock.advance(20_000);
    h.store.command('pause');
    await h.runtime.tick();
    h.store.command('volume', { volume: 30 });
    await h.runtime.tick();
    h.store.command('play');
    await h.runtime.tick();
    expect(h.voice.calls).not.toContain('resume');
    expect(h.voice.plays.at(-1)).toMatchObject({ seekMs: 20_000, volume: 30 });
  });

  it('restarts instead of resuming after a pause longer than a minute', async () => {
    const h = await activeHarness();
    h.store.enqueue(1);
    await h.runtime.tick();
    h.clock.advance(5_000);
    h.store.command('pause');
    await h.runtime.tick();
    h.clock.advance(MUSIC_RESUME_MAX_PAUSE_MS + 1);
    h.store.command('play');
    await h.runtime.tick();
    expect(h.voice.calls).not.toContain('resume');
    expect(h.voice.plays).toHaveLength(2);
    expect(h.voice.plays.at(-1)!.seekMs).toBe(5_000);
  });

  it('ignores an end event from a stream that a seek already replaced', async () => {
    const h = await activeHarness();
    h.store.enqueue(1, 2);
    await h.runtime.tick();
    const first = h.voice.lastPlayId();
    h.store.command('seek', { positionMs: 30_000 });
    await h.runtime.tick();
    h.voice.end(null, first);
    await h.runtime.tick();
    expect(h.store.state().current!.track.id).toBe('netease:1');
    h.voice.end(null);
    await h.runtime.tick();
    expect(h.store.state().current!.track.id).toBe('netease:2');
  });

  it('drops an account that can no longer be used and tells members', async () => {
    const h = await activeHarness();
    h.store.sessions = h.store.sessions.map((s) => ({ ...s, accountOwner: 'owner' }));
    h.control.cookie = null;
    h.store.enqueue(1);
    await h.runtime.tick();
    expect(h.store.ownerChanges).toEqual([{ ref: h.store.live()!.ref, owner: null }]);
    expect(h.store.live()!.accountOwner).toBeNull();
    expect(h.store.state().notice).toBe(MUSIC_ACCOUNT_DROPPED_NOTICE);
    expect(h.resolved).toEqual([{ trackId: 'netease:1', cookie: null }]);
    expect(h.voice.plays).toHaveLength(1);
  });

  it('maps pause and play to the voice player', async () => {
    const h = await activeHarness();
    h.store.enqueue(1);
    await h.runtime.tick();
    h.store.command('pause');
    await h.runtime.tick();
    h.store.command('play');
    await h.runtime.tick();
    expect(h.voice.calls.slice(-2)).toEqual(['pause', 'resume']);
  });

  it('skips an unplayable track and plays the next one', async () => {
    const h = await activeHarness();
    h.control.unplayable.add('netease:1');
    h.store.enqueue(1, 2);
    await h.runtime.tick();
    expect(h.resolved.map((r) => r.trackId)).toEqual(['netease:1', 'netease:2']);
    expect(h.voice.plays).toHaveLength(1);
    expect(h.store.state().current!.track.id).toBe('netease:2');
    expect(h.store.state().notice).toContain('需要会员');
  });

  it('treats a resolve that throws as a failed track', async () => {
    const h = await activeHarness();
    h.control.throwing.add('netease:1');
    h.store.enqueue(1, 2);
    await h.runtime.tick();
    expect(h.store.state().current!.track.id).toBe('netease:2');
    expect(h.errors.length).toBeGreaterThan(0);
  });

  it('pauses with a notice after 5 consecutive failures', async () => {
    const h = await activeHarness();
    for (let n = 1; n <= 7; n += 1) h.control.unplayable.add(`netease:${n}`);
    h.store.enqueue(1, 2, 3, 4, 5, 6, 7);
    await h.runtime.tick();
    expect(h.resolved).toHaveLength(MUSIC_MAX_CONSECUTIVE_FAILURES);
    expect(h.voice.plays).toHaveLength(0);
    expect(h.store.state().paused).toBe(true);
    expect(h.store.state().notice).toContain('连续');
    await h.runtime.tick();
    expect(h.resolved).toHaveLength(MUSIC_MAX_CONSECUTIVE_FAILURES);
  });

  it('advances to the next track on a natural end', async () => {
    const h = await activeHarness();
    h.store.enqueue(1, 2);
    await h.runtime.tick();
    h.voice.end(null);
    await h.runtime.tick();
    expect(h.store.state().current!.track.id).toBe('netease:2');
    expect(h.voice.plays).toHaveLength(2);
    h.voice.end(null);
    await h.runtime.tick();
    expect(h.store.state().current).toBeNull();
  });

  it('counts a stream error as a failed track', async () => {
    const h = await activeHarness();
    h.store.enqueue(1, 2);
    await h.runtime.tick();
    h.voice.end(new Error('ffmpeg exited'));
    await h.runtime.tick();
    expect(h.store.state().current!.track.id).toBe('netease:2');
    expect(h.store.state().notice).toContain('Song 1');
  });

  it('finishes a command with the member-facing message of a CommunityStoreError', async () => {
    const h = await activeHarness();
    const bad = h.store.command('volume', { volume: 500 });
    const good = h.store.command('mode', { mode: 'loop' });
    await h.runtime.tick();
    expect(h.store.result(bad)).toEqual({ status: 'failed', error: '音量无效' });
    expect(h.store.result(good)).toEqual({ status: 'done', error: null });
    expect(h.store.state().mode).toBe('loop');
  });

  it('finishes with a generic message when an unexpected error occurs', async () => {
    const h = await activeHarness();
    const original = h.store.saveState.bind(h.store);
    h.store.saveState = async () => { throw new Error('connection reset'); };
    const id = h.store.command('mode', { mode: 'loop' });
    await h.runtime.tick();
    h.store.saveState = original;
    expect(h.store.result(id).status).toBe('failed');
    expect(h.store.result(id).error).not.toContain('connection reset');
    expect(h.errors.some((e) => e instanceof Error && e.message === 'connection reset')).toBe(true);
  });

  it('finishes commands with a maintenance message while read-only', async () => {
    const h = await activeHarness();
    h.control.readOnly = true;
    const id = h.store.enqueue(1);
    await h.runtime.tick();
    expect(h.store.result(id).status).toBe('failed');
    expect(h.store.result(id).error).toContain('维护');
    expect(h.voice.plays).toHaveLength(0);
  });

  it('re-applies a command on fresh state after a version conflict', async () => {
    const h = await activeHarness();
    h.store.conflictsBeforeSave = 1;
    const first = h.store.command('mode', { mode: 'shuffle' });
    const second = h.store.command('volume', { volume: 30 });
    await h.runtime.tick();
    expect(h.store.result(first)).toEqual({ status: 'done', error: null });
    expect(h.store.result(second)).toEqual({ status: 'done', error: null });
    expect(h.store.state().mode).toBe('shuffle');
    expect(h.store.state().volume).toBe(30);
  });

  it('surfaces a persistent conflict without losing later commands', async () => {
    const h = await activeHarness();
    h.store.conflictsBeforeSave = 3;
    const first = h.store.command('mode', { mode: 'shuffle' });
    const second = h.store.command('volume', { volume: 30 });
    await h.runtime.tick();
    expect(h.store.result(first)).toEqual({ status: 'failed', error: '播放状态已变化，请刷新后重试' });
    expect(h.store.result(second)).toEqual({ status: 'done', error: null });
    expect(h.store.state().volume).toBe(30);
  });
});
