import { describe, expect, it } from 'vitest';
import { defaultMusicState, isMusicTrackId, MUSIC_QUEUE_LIMIT, musicPosition, musicQueueCapacity, type MusicQueueItem, type MusicState } from '../../shared/music';

const item: MusicQueueItem = {
  key: 'k1', addedBy: '00000000-0000-4000-8000-000000000001',
  track: { id: 'netease:1', title: '歌', artists: ['人'], album: '专辑', durationMs: 200_000, coverUrl: null },
};
const playing = (patch: Partial<MusicState>): MusicState => ({ ...defaultMusicState(), current: item, ...patch });

describe('shared music contract', () => {
  it('starts idle with an empty queue', () => {
    expect(defaultMusicState()).toEqual({
      current: null, queue: [], history: [], mode: 'order', volume: 100, paused: false,
      positionMs: 0, positionAt: null, notice: null,
    });
  });

  it('returns a fresh state object every time', () => {
    const first = defaultMusicState();
    first.queue.push(item);
    expect(defaultMusicState().queue).toEqual([]);
  });

  it('reports no position without a current track', () => {
    expect(musicPosition(defaultMusicState(), Date.now())).toBe(0);
  });

  it('keeps the stored position while paused', () => {
    expect(musicPosition(playing({ paused: true, positionMs: 42_000, positionAt: null }), 9_999_999)).toBe(42_000);
  });

  it('advances from the anchor while playing', () => {
    const at = '2026-11-17T00:00:00.000Z';
    expect(musicPosition(playing({ positionMs: 10_000, positionAt: at }), Date.parse(at) + 5_000)).toBe(15_000);
  });

  it('never exceeds the track duration or goes backwards', () => {
    const at = '2026-11-17T00:00:00.000Z';
    expect(musicPosition(playing({ positionMs: 10_000, positionAt: at }), Date.parse(at) + 900_000)).toBe(200_000);
    expect(musicPosition(playing({ positionMs: 10_000, positionAt: at }), Date.parse(at) - 60_000)).toBe(10_000);
  });

  it('treats an unreadable anchor as paused', () => {
    expect(musicPosition(playing({ positionMs: 7_000, positionAt: 'not a date' }), Date.now())).toBe(7_000);
  });

  it('accepts only source-prefixed track ids', () => {
    expect(isMusicTrackId('netease:123456')).toBe(true);
    for (const bad of ['123', 'netease:', 'netease:12a', 'other:1', '', null, 'netease:' + '1'.repeat(30)]) {
      expect(isMusicTrackId(bad)).toBe(false);
    }
  });

  it('counts the current track towards the queue limit', () => {
    expect(musicQueueCapacity(defaultMusicState())).toBe(MUSIC_QUEUE_LIMIT);
    expect(musicQueueCapacity(playing({ queue: [item, item] }))).toBe(MUSIC_QUEUE_LIMIT - 3);
    const full = Array.from({ length: MUSIC_QUEUE_LIMIT + 5 }, () => item);
    expect(musicQueueCapacity(playing({ queue: full }))).toBe(0);
  });
});
