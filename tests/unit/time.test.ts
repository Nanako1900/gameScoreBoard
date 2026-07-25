import { describe, expect, it } from 'vitest';
import {
  parseSqlUtc,
  resetOffsetHours,
  sqlNow,
  sqlNowMinusMinutes,
  sqlNowPlusHours,
  toSqlUtc,
  weekStartLocal,
} from '../../worker/time';

const SQL_SHAPE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

describe('sqlite datetime helpers', () => {
  it('formats in the exact shape D1 stores', () => {
    // Deadlines are compared against created_at with plain SQL string comparison,
    // so any deviation from this format silently breaks the sweep.
    expect(toSqlUtc(new Date('2026-07-25T12:34:56Z'))).toBe('2026-07-25 12:34:56');
    expect(sqlNow()).toMatch(SQL_SHAPE);
    expect(sqlNowPlusHours(12)).toMatch(SQL_SHAPE);
    expect(sqlNowMinusMinutes(30)).toMatch(SQL_SHAPE);
  });

  it('round-trips through parseSqlUtc', () => {
    const d = new Date('2026-07-25T12:34:56Z');
    expect(parseSqlUtc(toSqlUtc(d))).toBe(d.getTime());
  });

  it('reads a sqlite datetime as UTC, not local time', () => {
    expect(parseSqlUtc('2026-07-25 00:00:00')).toBe(Date.parse('2026-07-25T00:00:00Z'));
  });

  it('also accepts ISO strings, which is how starts_at is stored', () => {
    expect(parseSqlUtc('2026-07-25T12:34:56.000Z')).toBe(Date.parse('2026-07-25T12:34:56Z'));
  });

  it('orders lexicographically the same way it orders chronologically', () => {
    const early = toSqlUtc(new Date('2026-07-25T09:00:00Z'));
    const late = toSqlUtc(new Date('2026-07-25T10:00:00Z'));
    expect(early < late).toBe(true);
  });

  it('places a future deadline after now and a past cutoff before it', () => {
    expect(sqlNowPlusHours(12) > sqlNow()).toBe(true);
    expect(sqlNowMinusMinutes(2) < sqlNow()).toBe(true);
  });
});

describe('resetOffsetHours', () => {
  it('defaults to Beijing and tolerates junk', () => {
    expect(resetOffsetHours(undefined)).toBe(8);
    expect(resetOffsetHours('not-a-number')).toBe(8);
    expect(resetOffsetHours('0')).toBe(0);
    expect(resetOffsetHours('-5')).toBe(-5);
  });
});

describe('weekStartLocal', () => {
  it('returns a plain YYYY-MM-DD date', () => {
    expect(weekStartLocal(8)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('lands on a Monday', () => {
    const d = new Date(`${weekStartLocal(8)}T00:00:00Z`);
    expect(d.getUTCDay()).toBe(1);
  });
});
