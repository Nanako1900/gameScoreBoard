import { describe, expect, it } from 'vitest';
import { defaultMusicState, MUSIC_QUEUE_LIMIT, type MusicQueueItem, type MusicState, type MusicTrack } from '../../shared/music';
import { CommunityStoreError } from '../src/community/store';
import { advance, applyMusicCommand, type MusicCommandInput, type MusicReducerContext } from '../src/music/queue';

const NOW = Date.parse('2026-11-17T10:00:00.000Z');
const ISO = (ms: number) => new Date(ms).toISOString();

function makeCtx(overrides: Partial<MusicReducerContext> = {}): MusicReducerContext {
  let n = 0;
  return { now: NOW, random: () => 0, newKey: () => `k${++n}`, ...overrides };
}

function track(n: number, durationMs = 180_000): MusicTrack {
  return { id: `netease:${n}`, title: `Song ${n}`, artists: ['A'], album: 'Al', durationMs, coverUrl: null };
}
function item(n: number, durationMs = 180_000): MusicQueueItem {
  return { key: `q${n}`, track: track(n, durationMs), addedBy: 'm1' };
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}
function playing(extra: Partial<MusicState> = {}, queueSize = 2): MusicState {
  return {
    ...defaultMusicState(),
    current: item(1),
    queue: Array.from({ length: queueSize }, (_, i) => item(i + 2)),
    positionAt: ISO(NOW - 5_000),
    positionMs: 1_000,
    ...extra,
  };
}
function cmd(kind: MusicCommandInput['kind'], payload: Record<string, unknown> = {}): MusicCommandInput {
  return { kind, payload, actor: 'm1' };
}
function run(state: MusicState, command: MusicCommandInput, ctx = makeCtx()) {
  return applyMusicCommand(deepFreeze(state), deepFreeze(command), ctx);
}
function expectError(fn: () => unknown, status: number, code: string) {
  try { fn(); } catch (err) {
    expect(err).toBeInstanceOf(CommunityStoreError);
    expect((err as CommunityStoreError).status).toBe(status);
    expect((err as CommunityStoreError).code).toBe(code);
    return;
  }
  throw new Error('expected error');
}

describe('enqueue', () => {
  it('starts the first track when idle and queues the rest', () => {
    const r = run(defaultMusicState(), cmd('enqueue', { tracks: [track(1), track(2)] }));
    expect(r.effect).toBe('start');
    expect(r.state.current).toMatchObject({ key: 'k1', addedBy: 'm1', track: track(1) });
    expect(r.state.queue.map((q) => q.key)).toEqual(['k2']);
    expect(r.state.positionMs).toBe(0);
    expect(r.state.positionAt).toBe(ISO(NOW));
    expect(r.state.paused).toBe(false);
  });
  it('appends while playing with no effect', () => {
    const r = run(playing(), cmd('enqueue', { tracks: [track(9)] }));
    expect(r.effect).toBe('none');
    expect(r.state.queue.map((q) => q.track.id)).toEqual(['netease:2', 'netease:3', 'netease:9']);
    expect(r.state.current?.key).toBe('q1');
  });
  it('clears the notice when it starts playback', () => {
    const r = run({ ...defaultMusicState(), notice: 'old' }, cmd('enqueue', { tracks: [track(1)] }));
    expect(r.state.notice).toBeNull();
  });
  it('accepts exactly the limit and rejects one more with 409', () => {
    const ok = Array.from({ length: MUSIC_QUEUE_LIMIT }, (_, i) => track(i + 1));
    expect(run(defaultMusicState(), cmd('enqueue', { tracks: ok })).state.queue).toHaveLength(MUSIC_QUEUE_LIMIT - 1);
    const full = playing({}, MUSIC_QUEUE_LIMIT - 1);
    expectError(() => run(full, cmd('enqueue', { tracks: [track(500)] })), 409, 'queue_full');
    expect(run(playing({}, MUSIC_QUEUE_LIMIT - 2), cmd('enqueue', { tracks: [track(500)] })).state.queue).toHaveLength(MUSIC_QUEUE_LIMIT - 1);
  });
  it.each([
    ['no payload tracks', {}],
    ['empty list', { tracks: [] }],
    ['201 tracks', { tracks: Array.from({ length: 201 }, (_, i) => track(i + 1)) }],
    ['non-array', { tracks: 'x' }],
    ['bad id', { tracks: [{ ...track(1), id: 'spotify:1' }] }],
    ['empty title', { tracks: [{ ...track(1), title: '' }] }],
    ['long title', { tracks: [{ ...track(1), title: 'x'.repeat(201) }] }],
    ['artists not array', { tracks: [{ ...track(1), artists: 'A' }] }],
    ['11 artists', { tracks: [{ ...track(1), artists: Array(11).fill('a') }] }],
    ['long artist', { tracks: [{ ...track(1), artists: ['a'.repeat(101)] }] }],
    ['long album', { tracks: [{ ...track(1), album: 'a'.repeat(201) }] }],
    ['zero duration', { tracks: [{ ...track(1), durationMs: 0 }] }],
    ['fractional duration', { tracks: [{ ...track(1), durationMs: 1.5 }] }],
    ['too long duration', { tracks: [{ ...track(1), durationMs: 86_400_001 }] }],
    ['http cover', { tracks: [{ ...track(1), coverUrl: 'http://x.test/a.jpg' }] }],
    ['garbage cover', { tracks: [{ ...track(1), coverUrl: 'nope' }] }],
    ['long cover', { tracks: [{ ...track(1), coverUrl: `https://p1.music.126.net/${'a'.repeat(476)}` }] }],
    ['foreign cover host', { tracks: [{ ...track(1), coverUrl: 'https://x.test/a.jpg' }] }],
    ['look-alike cover host', { tracks: [{ ...track(1), coverUrl: 'https://p1.music.126.net.evil.test/a.jpg' }] }],
    ['cover with credentials', { tracks: [{ ...track(1), coverUrl: 'https://u:p@p1.music.126.net/a.jpg' }] }],
    ['201 code point title', { tracks: [{ ...track(1), title: '😀'.repeat(201) }] }],
    ['undefined cover', { tracks: [{ ...track(1), coverUrl: undefined }] }],
    ['null track', { tracks: [null] }],
  ])('rejects %s with 400', (_n, payload) => {
    expectError(() => run(defaultMusicState(), cmd('enqueue', payload as Record<string, unknown>)), 400, 'invalid_input');
  });
  it('accepts boundary values', () => {
    const edge = { id: 'netease:1', title: 'x'.repeat(200), artists: Array(10).fill('a'.repeat(100)), album: '😀'.repeat(200), durationMs: 86_400_000, coverUrl: `https://p1.music.126.net/${'a'.repeat(475)}` };
    expect(edge.coverUrl).toHaveLength(500);
    const emoji = { ...edge, title: '😀'.repeat(200), artists: ['😀'.repeat(100)], durationMs: 1, coverUrl: null };
    expect(run(defaultMusicState(), cmd('enqueue', { tracks: [edge, emoji] })).state.current).not.toBeNull();
  });
});

describe('queue editing', () => {
  it('removes a queued item by key', () => {
    expect(run(playing(), cmd('remove', { key: 'q2' })).state.queue.map((q) => q.key)).toEqual(['q3']);
  });
  it('ignores unknown keys and the current key', () => {
    const state = playing();
    for (const key of ['nope', 'q1']) {
      const r = run(state, cmd('remove', { key }));
      expect(r.effect).toBe('none');
      expect(r.state).toEqual(state);
    }
  });
  it('moves an item to the front', () => {
    const r = run(playing({}, 3), cmd('move_next', { key: 'q4' }));
    expect(r.state.queue.map((q) => q.key)).toEqual(['q4', 'q2', 'q3']);
    expect(r.effect).toBe('none');
    expect(run(playing(), cmd('move_next', { key: 'zzz' })).effect).toBe('none');
  });
  it('rejects bad keys', () => {
    for (const key of [undefined, 5, '', 'x'.repeat(201)]) {
      expectError(() => run(playing(), cmd('remove', { key })), 400, 'invalid_input');
      expectError(() => run(playing(), cmd('move_next', { key })), 400, 'invalid_input');
    }
  });
  it('clear keeps the current track', () => {
    const r = run(playing(), cmd('clear'));
    expect(r.state.queue).toEqual([]);
    expect(r.state.current?.key).toBe('q1');
    expect(r.effect).toBe('none');
  });
});

describe('pause and play', () => {
  it('pause settles the position', () => {
    const r = run(playing(), cmd('pause'));
    expect(r.effect).toBe('pause');
    expect(r.state).toMatchObject({ paused: true, positionMs: 6_000, positionAt: null });
  });
  it('pause is a no-op when paused or idle', () => {
    const paused = playing({ paused: true, positionAt: null });
    expect(run(paused, cmd('pause'))).toEqual({ state: paused, effect: 'none' });
    expect(run(defaultMusicState(), cmd('pause')).effect).toBe('none');
  });
  it('play resumes from the settled position', () => {
    const r = run(playing({ paused: true, positionAt: null, positionMs: 7_000 }), cmd('play'));
    expect(r.effect).toBe('resume');
    expect(r.state).toMatchObject({ paused: false, positionMs: 7_000, positionAt: ISO(NOW) });
  });
  it('play is a no-op while playing', () => {
    const state = playing();
    expect(run(state, cmd('play'))).toEqual({ state, effect: 'none' });
  });
  it('play starts the queue when nothing is current', () => {
    const r = run({ ...defaultMusicState(), queue: [item(2), item(3)], notice: 'x' }, cmd('play'));
    expect(r.effect).toBe('start');
    expect(r.state.current?.key).toBe('q2');
    expect(r.state.queue.map((q) => q.key)).toEqual(['q3']);
    expect(r.state.notice).toBeNull();
    expect(run(defaultMusicState(), cmd('play')).effect).toBe('none');
  });
});

describe('seek', () => {
  it('moves the position and restarts', () => {
    const r = run(playing(), cmd('seek', { positionMs: 30_000 }));
    expect(r.effect).toBe('restart');
    expect(r.state).toMatchObject({ positionMs: 30_000, positionAt: ISO(NOW), paused: false });
  });
  it('clamps to the duration and accepts 0', () => {
    expect(run(playing(), cmd('seek', { positionMs: 999_999_999 })).state.positionMs).toBe(180_000);
    expect(run(playing(), cmd('seek', { positionMs: 0 })).state.positionMs).toBe(0);
  });
  it('keeps the paused flag', () => {
    const r = run(playing({ paused: true, positionAt: null }), cmd('seek', { positionMs: 5_000 }));
    expect(r.state).toMatchObject({ paused: true, positionAt: null, positionMs: 5_000 });
  });
  it('does nothing without a current track', () => {
    expect(run(defaultMusicState(), cmd('seek', { positionMs: 5 })).effect).toBe('none');
  });
  it.each([-1, 1.5, '5', null, undefined, NaN])('rejects %s', (positionMs) => {
    expectError(() => run(playing(), cmd('seek', { positionMs })), 400, 'invalid_input');
  });
});

describe('volume', () => {
  it('restarts from the settled position when it changes during playback', () => {
    const r = run(playing(), cmd('volume', { volume: 40 }));
    expect(r.effect).toBe('restart');
    expect(r.state).toMatchObject({ volume: 40, positionMs: 6_000, positionAt: ISO(NOW) });
  });
  it('does not restart when paused, idle or unchanged', () => {
    const paused = playing({ paused: true, positionAt: null });
    expect(run(paused, cmd('volume', { volume: 10 }))).toMatchObject({ effect: 'none', state: { volume: 10, positionMs: 1_000 } });
    expect(run(defaultMusicState(), cmd('volume', { volume: 10 })).effect).toBe('none');
    expect(run(playing(), cmd('volume', { volume: 100 })).effect).toBe('none');
  });
  it('accepts 0 and 100 and rejects out of range', () => {
    expect(run(playing(), cmd('volume', { volume: 0 })).state.volume).toBe(0);
    for (const volume of [-1, 101, 1.5, '50', undefined]) {
      expectError(() => run(playing(), cmd('volume', { volume })), 400, 'invalid_input');
    }
  });
});

describe('mode and leave', () => {
  it('switches mode and resets history', () => {
    const r = run(playing({ history: ['a', 'b'] }), cmd('mode', { mode: 'shuffle' }));
    expect(r.state.mode).toBe('shuffle');
    expect(r.state.history).toEqual([]);
    expect(r.effect).toBe('none');
  });
  it('rejects unknown modes', () => {
    expectError(() => run(playing(), cmd('mode', { mode: 'random' })), 400, 'invalid_input');
    expectError(() => run(playing(), cmd('mode', {})), 400, 'invalid_input');
  });
  it('leave resets but keeps volume and mode', () => {
    const r = run(playing({ volume: 33, mode: 'loop', notice: 'n' }), cmd('leave'));
    expect(r.effect).toBe('leave');
    expect(r.state).toEqual({ ...defaultMusicState(), volume: 33, mode: 'loop' });
  });
  it('rejects unknown command kinds', () => {
    expectError(() => run(playing(), cmd('bogus' as never)), 400, 'invalid_input');
  });
});

describe('advance', () => {
  const adv = (state: MusicState, reason: 'ended' | 'skip' | 'failed', failure?: string, ctx = makeCtx()) =>
    advance(deepFreeze(state), ctx, reason, failure);
  const started = (r: ReturnType<typeof advance>, key: string) => {
    expect(r.effect).toBe('start');
    expect(r.state.current?.key).toBe(key);
    expect(r.state).toMatchObject({ positionMs: 0, positionAt: ISO(NOW), paused: false });
  };

  describe.each(['ended', 'skip', 'failed'] as const)('order mode, %s', (reason) => {
    it('drops current and plays the queue head', () => {
      const r = adv(playing(), reason, 'boom');
      started(r, 'q2');
      expect(r.state.queue.map((q) => q.key)).toEqual(['q3']);
    });
    it('stops with an empty queue', () => {
      const r = adv(playing({}, 0), reason, 'boom');
      expect(r.effect).toBe('stop');
      expect(r.state).toMatchObject({ current: null, queue: [], positionMs: 0, positionAt: null, paused: false });
    });
  });

  describe.each(['ended', 'skip', 'failed'] as const)('loop mode, %s', (reason) => {
    const base = () => playing({ mode: 'loop' });
    it('appends current (except on failure) then plays the head', () => {
      const r = adv(base(), reason, 'boom');
      started(r, 'q2');
      expect(r.state.queue.map((q) => q.key)).toEqual(reason === 'failed' ? ['q3'] : ['q3', 'q1']);
    });
    it('a lone track loops unless it failed', () => {
      const r = adv(playing({ mode: 'loop' }, 0), reason, 'boom');
      if (reason === 'failed') expect(r.effect).toBe('stop');
      else { started(r, 'q1'); expect(r.state.queue).toEqual([]); }
    });
  });

  describe.each(['ended', 'skip', 'failed'] as const)('single mode, %s', (reason) => {
    it(reason === 'ended' ? 'replays the current track' : 'moves on', () => {
      const r = adv(playing({ mode: 'single' }), reason, 'boom');
      if (reason === 'ended') {
        started(r, 'q1');
        expect(r.state.queue.map((q) => q.key)).toEqual(['q2', 'q3']);
      } else {
        started(r, 'q2');
        expect(r.state.queue.map((q) => q.key)).toEqual(['q3']);
      }
    });
  });

  describe.each(['ended', 'skip', 'failed'] as const)('shuffle mode, %s', (reason) => {
    it('picks with ctx.random, drops the played item and records history', () => {
      const r = adv(playing({ mode: 'shuffle', history: ['old'] }, 3), reason, 'boom', makeCtx({ random: () => 0.5 }));
      started(r, 'q3');
      expect(r.state.queue.map((q) => q.key)).toEqual(['q2', 'q4']);
      expect(r.state.history).toEqual(['old', 'q1']);
    });
    it('handles random() near 1 and caps history at 200', () => {
      const history = Array.from({ length: 200 }, (_, i) => `h${i}`);
      const r = adv(playing({ mode: 'shuffle', history }, 2), reason, 'boom', makeCtx({ random: () => 0.999999 }));
      started(r, 'q3');
      expect(r.state.history).toHaveLength(200);
      expect(r.state.history.at(-1)).toBe('q1');
      expect(r.state.history[0]).toBe('h1');
    });
    it('never repeats until the queue is exhausted', () => {
      let state: MusicState = playing({ mode: 'shuffle' }, 4);
      const seen = new Set<string>([state.current!.key]);
      const ctx = makeCtx({ random: () => 0.3 });
      for (let i = 0; i < 4; i += 1) {
        state = advance(state, ctx, 'ended').state;
        expect(seen.has(state.current!.key)).toBe(false);
        seen.add(state.current!.key);
      }
      expect(advance(state, ctx, 'ended').effect).toBe('stop');
    });
  });

  it('starts the queue when nothing is current', () => {
    const r = adv({ ...defaultMusicState(), queue: [item(2)] }, 'skip');
    started(r, 'q2');
  });
  it('stops cleanly when idle', () => {
    expect(adv(defaultMusicState(), 'skip').effect).toBe('stop');
  });
  it('failed sets a notice with the track title; skip clears it', () => {
    expect(adv(playing(), 'failed', '没有版权').state.notice).toBe('Song 1：没有版权');
    expect(adv(playing({}, 0), 'failed', '没有版权').state.notice).toBe('Song 1：没有版权');
    expect(adv(playing({ notice: 'old' }), 'skip').state.notice).toBeNull();
    expect(adv(playing({ notice: 'old' }), 'ended').state.notice).toBe('old');
  });
  it('the skip command delegates to advance', () => {
    const r = run(playing({ notice: 'old' }), cmd('skip'));
    started(r, 'q2');
    expect(r.state.notice).toBeNull();
  });
  it('does not mutate or share structure with the input', () => {
    const state = deepFreeze(playing());
    const r = advance(state, makeCtx(), 'skip');
    expect(r.state.queue).not.toBe(state.queue);
    expect(state.current?.key).toBe('q1');
  });
});
