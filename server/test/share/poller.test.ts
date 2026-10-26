import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPoller,
  isReportedLoadError,
  REFRESH_INTERVAL_MS,
  STALE_MS,
  UpstreamFailedError,
  UpstreamLoadingError,
} from '../../src/share/poller';
import type { StoredSnapshot } from '../../src/share/snapshot';

const T0 = Date.parse('2026-10-26T12:00:00.000Z');

function snap(fetchedAt: number, name = 'Guild'): StoredSnapshot {
  return {
    id: '1114391825336250432',
    name,
    createdAt: '2023-06-01T00:00:00.000Z',
    inviteUrl: null,
    guild: null,
    widget: null,
    sources: { guild: null, widget: null },
    fetchedAt: new Date(fetchedAt).toISOString(),
    stale: false,
    rejectedInviteCode: 'Secret',
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

describe('createPoller', () => {
  it('loads on start, then once per interval', async () => {
    const load = vi.fn(async () => snap(Date.now()));
    const poller = createPoller({ load });
    poller.start();
    poller.start(); // idempotent
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS * 3);
    expect(load).toHaveBeenCalledTimes(4);
    poller.stop();
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS * 3);
    expect(load).toHaveBeenCalledTimes(4);
  });

  it('makes the first requests wait for the first load, then answers from memory', async () => {
    let resolve!: (s: StoredSnapshot) => void;
    const load = vi.fn(() => new Promise<StoredSnapshot>((r) => (resolve = r)));
    const poller = createPoller({ load });
    poller.start();
    const waiting = Promise.all([poller.get(), poller.get(), poller.get()]);
    resolve(snap(Date.now()));
    const results = await waiting;
    expect(results.map((r) => r.name)).toEqual(['Guild', 'Guild', 'Guild']);
    await poller.get();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent refreshes into one load', async () => {
    const load = vi.fn(async () => snap(Date.now()));
    const poller = createPoller({ load });
    await Promise.all([poller.refresh(), poller.refresh(), poller.refresh()]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('serves public fields only — internal state never leaves', async () => {
    const poller = createPoller({ load: async () => snap(Date.now()) });
    await poller.refresh();
    const served = await poller.get();
    expect(served).not.toHaveProperty('rejectedInviteCode');
    expect(JSON.stringify(served)).not.toContain('Secret');
  });

  it('keeps the previous snapshot when a refresh fails, and hands it to the next load', async () => {
    const onError = vi.fn();
    const load = vi
      .fn<(previous: StoredSnapshot | null) => Promise<StoredSnapshot>>()
      .mockResolvedValueOnce(snap(T0, 'First'))
      .mockRejectedValueOnce(new Error('discord down'))
      .mockImplementation(async (previous) => snap(Date.now(), `after ${previous?.name}`));
    const poller = createPoller({ load, onError });

    await poller.refresh();
    await poller.refresh();
    expect(onError).toHaveBeenCalledTimes(1);
    expect((await poller.get()).name).toBe('First');

    await poller.refresh();
    expect(load.mock.calls[2]?.[0]?.name).toBe('First');
    expect((await poller.get()).name).toBe('after First');
  });

  it('rejects with UpstreamFailedError only while nothing has ever loaded', async () => {
    const onError = vi.fn();
    const poller = createPoller({ load: async () => Promise.reject(new Error('nope')), onError });
    await poller.refresh();
    await expect(poller.get()).rejects.toBeInstanceOf(UpstreamFailedError);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('survives a load that throws synchronously and can refresh again', async () => {
    let calls = 0;
    const load = (() => {
      calls += 1;
      if (calls === 1) throw new Error('sync boom');
      return Promise.resolve(snap(Date.now()));
    }) as (previous: StoredSnapshot | null) => Promise<StoredSnapshot>;
    const poller = createPoller({ load, onError: () => undefined });
    await poller.refresh();
    await poller.refresh();
    expect(calls).toBe(2);
    expect((await poller.get()).name).toBe('Guild');
  });

  it('flags a snapshot stale once it is older than STALE_MS', async () => {
    const poller = createPoller({ load: async () => snap(Date.now()) });
    await poller.refresh();
    expect((await poller.get()).stale).toBe(false);
    vi.setSystemTime(T0 + STALE_MS + 1);
    expect((await poller.get()).stale).toBe(true);
  });
});

describe('createPoller — across restarts', () => {
  it('serves the persisted snapshot (aged, so stale) until a refresh succeeds', async () => {
    const onError = vi.fn();
    const poller = createPoller({
      initial: snap(T0 - STALE_MS - 1, 'From disk'),
      load: async () => Promise.reject(new Error('discord down')),
      onError,
    });
    await poller.refresh();
    const served = await poller.get();
    expect(served.name).toBe('From disk');
    expect(served.stale).toBe(true);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('hands every successful snapshot to onSnapshot, and only those', async () => {
    const saved: string[] = [];
    const load = vi
      .fn<(previous: StoredSnapshot | null) => Promise<StoredSnapshot>>()
      .mockResolvedValueOnce(snap(T0, 'one'))
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce(snap(T0, 'two'));
    const poller = createPoller({ load, onError: () => undefined, onSnapshot: (s) => saved.push(s.name) });
    await poller.refresh();
    await poller.refresh();
    await poller.refresh();
    expect(saved).toEqual(['one', 'two']);
  });
});

describe('isReportedLoadError', () => {
  it('recognises the poller’s own rejections and nothing else', () => {
    expect(isReportedLoadError(new UpstreamFailedError('x'))).toBe(true);
    expect(isReportedLoadError(new UpstreamLoadingError('x'))).toBe(true);
    expect(isReportedLoadError(new Error('x'))).toBe(false);
  });
});
