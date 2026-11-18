import { describe, expect, it } from 'vitest';
import { CommunityStoreError } from '../src/community/store';
import {
  MUSIC_CONNECT_TIMEOUT_MS, MUSIC_EMPTY_TIMEOUT_MS, MUSIC_HEARTBEAT_INTERVAL_MS, MUSIC_IDLE_TIMEOUT_MS,
  MUSIC_PURGE_INTERVAL_MS,
} from '../src/music/runtime';
import { activeHarness, CHANNEL, makeHarness, ROOM } from './music-runtime.fixture';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('music runtime: sessions', () => {
  it('ends a session left over from a previous process on the first tick', async () => {
    const h = makeHarness();
    const leftover = h.store.addSession({ status: 'active' });
    await h.runtime.tick();
    expect(h.store.ended).toEqual([{ ref: leftover.ref, reason: 'bot_restarted' }]);
    expect(h.voice.joins).toEqual([]);
  });

  it('ends a requested leftover only once it is older than the connect timeout', async () => {
    const h = makeHarness();
    const stale = h.store.addSession({ status: 'requested' });
    h.clock.advance(MUSIC_CONNECT_TIMEOUT_MS);
    await h.runtime.tick();
    expect(h.store.ended).toEqual([{ ref: stale.ref, reason: 'bot_restarted' }]);
  });

  it('claims a fresh requested session found on the first tick instead of ending it', async () => {
    const h = makeHarness();
    const fresh = h.store.addSession({ status: 'requested' });
    await h.runtime.tick();
    expect(h.store.ended).toEqual([]);
    expect(h.store.live()!.ref).toBe(fresh.ref);
    expect(h.store.live()!.status).toBe('active');
    expect(h.voice.joins).toEqual([CHANNEL]);
  });

  it('ends a connecting leftover as bot_restarted', async () => {
    const h = makeHarness();
    const leftover = h.store.addSession({ status: 'connecting' });
    await h.runtime.tick();
    expect(h.store.ended).toEqual([{ ref: leftover.ref, reason: 'bot_restarted' }]);
  });

  it('does not wait for the announcement to finish', async () => {
    const h = makeHarness();
    h.voice.announceHangs = true;
    await h.runtime.tick();
    h.store.addSession();
    await h.runtime.tick();
    expect(h.store.live()!.status).toBe('active');
  });

  it('claims a requested session, joins, activates and announces once', async () => {
    const h = await activeHarness();
    expect(h.voice.joins).toEqual([CHANNEL]);
    expect(h.store.live()!.status).toBe('active');
    expect(h.voice.announced).toEqual([{ channelId: CHANNEL, url: `https://example.test/community/music/${ROOM}` }]);
    await h.runtime.tick();
    await h.runtime.tick();
    expect(h.voice.joins).toHaveLength(1);
    expect(h.voice.announced).toHaveLength(1);
  });

  it('keeps the session when the announcement fails, reporting the error', async () => {
    const h = makeHarness();
    h.voice.announceError = new Error('missing access');
    await h.runtime.tick();
    h.store.addSession();
    await h.runtime.tick();
    expect(h.store.live()!.status).toBe('active');
    expect(h.errors).toContain(h.voice.announceError);
  });

  it('retries joining on every tick and ends connect_failed after 30 s', async () => {
    const h = makeHarness();
    h.voice.joinError = new Error('no access yet');
    await h.runtime.tick();
    h.store.addSession();
    await h.runtime.tick();
    h.clock.advance(10_000);
    await h.runtime.tick();
    expect(h.voice.joins.length).toBe(2);
    expect(h.store.live()!.status).toBe('connecting');
    h.clock.advance(MUSIC_CONNECT_TIMEOUT_MS);
    await h.runtime.tick();
    expect(h.store.ended.map((e) => e.reason)).toEqual(['connect_failed']);
    expect(h.voice.calls).toContain('leave');
  });

  it('joins on a later retry once access is granted', async () => {
    const h = makeHarness();
    h.voice.joinError = new Error('no access yet');
    await h.runtime.tick();
    h.store.addSession();
    await h.runtime.tick();
    h.voice.joinError = null;
    h.clock.advance(5_000);
    await h.runtime.tick();
    expect(h.store.live()!.status).toBe('active');
  });

  it('does not claim a new session while read-only', async () => {
    const h = makeHarness();
    h.control.readOnly = true;
    await h.runtime.tick();
    h.store.addSession();
    await h.runtime.tick();
    expect(h.voice.joins).toEqual([]);
    expect(h.store.live()!.status).toBe('requested');
  });

  it('ends room_closed when the room cannot be resolved', async () => {
    const h = await activeHarness();
    h.control.channel = null;
    await h.runtime.tick();
    expect(h.store.ended.map((e) => e.reason)).toEqual(['room_closed']);
    expect(h.voice.calls).toContain('leave');
  });

  it('ends disconnected when the voice adapter reports a disconnect', async () => {
    const h = await activeHarness();
    h.voice.disconnect();
    await h.runtime.tick();
    expect(h.store.ended.map((e) => e.reason)).toEqual(['disconnected']);
  });

  it('ends left on a leave command', async () => {
    const h = await activeHarness();
    const id = h.store.command('leave');
    await h.runtime.tick();
    expect(h.store.ended.map((e) => e.reason)).toEqual(['left']);
    expect(h.store.result(id)).toEqual({ status: 'done', error: null });
    expect(h.voice.calls).toContain('leave');
  });

  it('stop() ends the live session with reason shutdown and leaves voice', async () => {
    const h = await activeHarness();
    await h.runtime.stop();
    expect(h.store.ended.map((e) => e.reason)).toEqual(['shutdown']);
    expect(h.voice.calls).toContain('leave');
    h.store.addSession();
    await h.runtime.tick();
    expect(h.voice.joins).toHaveLength(1);
  });
});

describe('music runtime: timers and housekeeping', () => {
  it('ends empty after 60 s without humans', async () => {
    const h = await activeHarness();
    h.store.enqueue(1);
    await h.runtime.tick();
    h.voice.humanCount = 0;
    await h.runtime.tick();
    h.clock.advance(MUSIC_EMPTY_TIMEOUT_MS - 1);
    await h.runtime.tick();
    expect(h.store.ended).toEqual([]);
    h.clock.advance(1);
    await h.runtime.tick();
    expect(h.store.ended.map((e) => e.reason)).toEqual(['empty']);
  });

  it('a human resets the empty countdown and an unavailable snapshot never counts', async () => {
    const h = await activeHarness();
    h.store.enqueue(1);
    await h.runtime.tick();
    h.voice.humanCount = 0;
    await h.runtime.tick();
    h.clock.advance(40_000);
    h.voice.humanCount = 2;
    await h.runtime.tick();
    h.voice.humanCount = 0;
    await h.runtime.tick();
    h.clock.advance(40_000);
    h.voice.humanCount = null;
    await h.runtime.tick();
    h.clock.advance(MUSIC_EMPTY_TIMEOUT_MS * 2);
    await h.runtime.tick();
    expect(h.store.ended).toEqual([]);
  });

  it('ends idle after 10 minutes with nothing playing or queued', async () => {
    const h = await activeHarness();
    h.clock.advance(MUSIC_IDLE_TIMEOUT_MS - 1);
    await h.runtime.tick();
    expect(h.store.ended).toEqual([]);
    h.clock.advance(1);
    await h.runtime.tick();
    expect(h.store.ended.map((e) => e.reason)).toEqual(['idle']);
  });

  it('playing music resets the idle countdown', async () => {
    const h = await activeHarness();
    h.clock.advance(MUSIC_IDLE_TIMEOUT_MS - 1_000);
    h.store.enqueue(1);
    await h.runtime.tick();
    h.clock.advance(MUSIC_IDLE_TIMEOUT_MS);
    await h.runtime.tick();
    expect(h.store.ended).toEqual([]);
  });

  it('heartbeats on its own interval, not on ticks, and purges at most hourly', async () => {
    const h = makeHarness();
    await h.runtime.tick();
    expect(h.store.heartbeats).toBe(0);
    h.runtime.start();
    await flush();
    expect(h.timers.intervals()).toEqual([MUSIC_HEARTBEAT_INTERVAL_MS]);
    expect(h.store.heartbeats).toBe(1);
    expect(h.store.purges).toBe(1);
    h.clock.advance(MUSIC_HEARTBEAT_INTERVAL_MS);
    h.timers.fire();
    await flush();
    expect(h.store.heartbeats).toBe(2);
    expect(h.store.purges).toBe(1);
    h.clock.advance(MUSIC_PURGE_INTERVAL_MS);
    h.timers.fire();
    await flush();
    expect(h.store.purges).toBe(2);
    await h.runtime.stop();
    expect(h.timers.intervals()).toEqual([]);
  });

  it('keeps heartbeating while a tick is stuck', async () => {
    const h = makeHarness();
    h.store.activeSession = () => new Promise(() => undefined);
    void h.runtime.tick();
    h.runtime.start();
    await flush();
    h.timers.fire();
    await flush();
    expect(h.store.heartbeats).toBe(2);
  });

  it('never runs two ticks at the same time', async () => {
    const h = makeHarness();
    let inside = 0;
    let maxInside = 0;
    const original = h.store.activeSession.bind(h.store);
    h.store.activeSession = async () => {
      inside += 1;
      maxInside = Math.max(maxInside, inside);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inside -= 1;
      return original();
    };
    await Promise.all([h.runtime.tick(), h.runtime.tick(), h.runtime.tick()]);
    expect(maxInside).toBe(1);
  });

  it('reports store failures through onError instead of throwing', async () => {
    const h = makeHarness();
    h.store.activeSession = async () => { throw new CommunityStoreError(500, 'db', 'down'); };
    await expect(h.runtime.tick()).resolves.toBeUndefined();
    expect(h.errors).toHaveLength(1);
  });
});
