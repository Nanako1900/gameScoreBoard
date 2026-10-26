// The browser half of the timestamp story (src/lib/time.ts). The API hands back
// SQLite's `YYYY-MM-DD HH:MM:SS` — UTC, but with no zone marker. V8 accepts that
// shape and reads it as LOCAL time, so for a viewer in Beijing every timestamp
// came out 8h early: a brand-new record said "8小时前", and a 12h statement
// window showed only 4h left. These run under several zones because the bug is
// invisible when the test process happens to run in UTC.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  formatRemaining,
  parseTimestamp,
  relativeTime,
} from '../../src/lib/time';

const ORIGINAL_TZ = process.env.TZ;

function restoreTz(): void {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
}

const AT_0800_UTC = Date.UTC(2026, 9, 25, 8, 0, 0);

describe.each(['Asia/Shanghai', 'UTC', 'America/Los_Angeles'])('parseTimestamp in %s', (tz) => {
  beforeAll(() => {
    process.env.TZ = tz;
  });
  afterAll(restoreTz);

  it('reads a SQLite datetime as UTC, whatever the local zone', () => {
    expect(parseTimestamp('2026-10-25 08:00:00')).toBe(AT_0800_UTC);
  });

  it('keeps fractional seconds on a SQLite datetime', () => {
    expect(parseTimestamp('2026-10-25 08:00:00.250')).toBe(AT_0800_UTC + 250);
  });

  it('leaves ISO strings with an explicit zone alone', () => {
    expect(parseTimestamp('2026-10-25T08:00:00.000Z')).toBe(AT_0800_UTC);
    expect(parseTimestamp('2026-10-25T16:00:00+08:00')).toBe(AT_0800_UTC);
  });

  it('returns NaN for garbage', () => {
    expect(parseTimestamp('')).toBeNaN();
    expect(parseTimestamp('not a date')).toBeNaN();
  });

  it('calls a record filed 30s ago 刚刚', () => {
    expect(relativeTime('2026-10-25 08:00:00', AT_0800_UTC + 30_000)).toBe('刚刚');
  });

  it('shows the full statement window on a fresh deadline', () => {
    const deadline = '2026-10-25 20:00:00'; // 12h after AT_0800_UTC
    expect(formatRemaining(deadline, AT_0800_UTC)).toBe('还剩 12 小时 0 分');
  });
});

describe('the TZ override this file relies on', () => {
  beforeAll(() => {
    process.env.TZ = 'Asia/Shanghai';
  });
  afterAll(restoreTz);

  it('is actually live, so the Asia/Shanghai cases above are not vacuous', () => {
    expect(new Date(AT_0800_UTC).getHours()).toBe(16);
  });
});
