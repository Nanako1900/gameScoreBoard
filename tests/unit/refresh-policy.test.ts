// P0-3: when the home page refetches (spec §5 #10) and what the stale notice says.
import { describe, expect, it } from 'vitest';
import { ALL_CORE_KEYS, CHANGE_KEYS, VISIBLE_KEYS } from '../../src/lib/coreKeys';
import {
  resetCrossed,
  shouldRefreshOnVisible,
  staleMessage,
  visibleRefreshKeys,
} from '../../src/lib/refreshPolicy';

const RESET = '2026-11-01T16:00:00.000Z';
const RESET_MS = Date.parse(RESET);
const MIN = 60_000;

describe('key sets', () => {
  it('a write invalidates the board, the feed and me — not config or the report', () => {
    expect([...CHANGE_KEYS].sort()).toEqual(['leaderboard', 'me', 'records']);
  });

  it('coming back never includes config by itself', () => {
    expect(VISIBLE_KEYS).not.toContain('config');
  });

  it('the first load covers every key, in the order today’s requests go out', () => {
    expect(ALL_CORE_KEYS).toEqual(['config', 'leaderboard', 'records', 'me', 'report']);
  });
});

describe('shouldRefreshOnVisible', () => {
  it('waits until the last refresh is more than the interval old', () => {
    expect(shouldRefreshOnVisible(0, 30_000, MIN)).toBe(false);
    expect(shouldRefreshOnVisible(0, MIN, MIN)).toBe(false);
    expect(shouldRefreshOnVisible(0, MIN + 1, MIN)).toBe(true);
  });

  it('refreshes when the last refresh time is unknown', () => {
    expect(shouldRefreshOnVisible(Number.NaN, 0, MIN)).toBe(true);
  });
});

describe('visibleRefreshKeys', () => {
  it('before the reset: the visible keys only', () => {
    expect(visibleRefreshKeys(RESET, RESET_MS - 1)).toEqual(VISIBLE_KEYS);
  });

  it('at or after the reset: config as well', () => {
    expect(visibleRefreshKeys(RESET, RESET_MS)).toEqual([...VISIBLE_KEYS, 'config']);
  });

  it('an unparsable reset time never adds config', () => {
    expect(visibleRefreshKeys('soon', RESET_MS)).toEqual(VISIBLE_KEYS);
  });
});

describe('resetCrossed', () => {
  it('fires once the clock has passed, once per value', () => {
    expect(resetCrossed(RESET, RESET_MS - 1, null)).toBe(false);
    expect(resetCrossed(RESET, RESET_MS, null)).toBe(true);
    expect(resetCrossed(RESET, RESET_MS + MIN, RESET)).toBe(false);
  });

  it('a new reset time can fire again', () => {
    const next = '2026-11-08T16:00:00.000Z';
    expect(resetCrossed(next, Date.parse(next), RESET)).toBe(true);
  });
});

describe('staleMessage', () => {
  it('says how many minutes old the data is', () => {
    expect(staleMessage(0, 2 * MIN + 5_000, false)).toBe('没刷新出来，显示的是 2 分钟前的数据。');
  });

  it('under a minute: 刚才的数据', () => {
    expect(staleMessage(0, 59_000, false)).toBe('没刷新出来，显示的是刚才的数据。');
  });

  it('503: maintenance wording', () => {
    expect(staleMessage(0, 3 * MIN, true)).toBe('系统维护中，暂时只能看，显示的是 3 分钟前的数据。');
    expect(staleMessage(0, 0, true)).toBe('系统维护中，暂时只能看，显示的是刚才的数据。');
  });
});
