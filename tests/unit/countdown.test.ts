// P0-3: the minute-level reset countdown, prose time-left, and the tab title.
import { describe, expect, it } from 'vitest';
import { formatResetCountdown, formatTimeLeft, RESET_PENDING_LABEL } from '../../src/lib/time';

const TARGET = '2026-11-01T16:00:00.000Z';
const T = Date.parse(TARGET);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('formatResetCountdown', () => {
  it('days, then hours:minutes', () => {
    expect(formatResetCountdown(TARGET, T - (2 * DAY + 6 * HOUR + 14 * MIN))).toBe('2天 06:14');
    expect(formatResetCountdown(TARGET, T - (6 * HOUR + 14 * MIN))).toBe('06:14');
  });

  it('rounds up to the minute, so the last seconds read 00:01', () => {
    expect(formatResetCountdown(TARGET, T - (6 * HOUR + 13 * MIN + 20_000))).toBe('06:14');
    expect(formatResetCountdown(TARGET, T - 30_000)).toBe('00:01');
    expect(formatResetCountdown(TARGET, T - 1)).toBe('00:01');
  });

  it('carries a full day', () => {
    expect(formatResetCountdown(TARGET, T - (7 * DAY - 31_000))).toBe('7天 00:00');
  });

  it('at and after the reset: 回血中…, never a negative number', () => {
    expect(RESET_PENDING_LABEL).toBe('回血中…');
    expect(formatResetCountdown(TARGET, T)).toBe('回血中…');
    expect(formatResetCountdown(TARGET, T + 5 * HOUR)).toBe('回血中…');
  });

  it('an unparsable target reads —', () => {
    expect(formatResetCountdown('soon', T)).toBe('—');
  });

  it('reads SQLite timestamps as UTC', () => {
    expect(formatResetCountdown('2026-11-01 16:00:00', T - 5 * MIN)).toBe('00:05');
  });
});

describe('formatTimeLeft', () => {
  it('the largest whole unit', () => {
    expect(formatTimeLeft(TARGET, T - (2 * DAY + 6 * HOUR))).toBe('还有 2 天');
    expect(formatTimeLeft(TARGET, T - (5 * HOUR + 59 * MIN))).toBe('还有 5 小时');
    expect(formatTimeLeft(TARGET, T - (12 * MIN + 30_000))).toBe('还有 12 分钟');
    expect(formatTimeLeft(TARGET, T - 59_000)).toBe('还有不到 1 分钟');
  });

  it('passed or unparsable: empty', () => {
    expect(formatTimeLeft(TARGET, T)).toBe('');
    expect(formatTimeLeft(TARGET, T + MIN)).toBe('');
    expect(formatTimeLeft('soon', T)).toBe('');
  });
});
