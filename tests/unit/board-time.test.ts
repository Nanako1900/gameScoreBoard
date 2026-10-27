// P2-4: the board's time zone (RESET_TZ_OFFSET), on the web and in the bot —
// spec §4.2「时区与时段」, §11 #8. Every case here must read the same in any
// process time zone, so the shared functions run under several zones
// (process.env.TZ, as in client-time.test.ts).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boardTzLabel } from '../../shared/boardTime';
import { formatWhen } from '../../src/lib/time';

const ZONES = ['Asia/Shanghai', 'UTC', 'America/Los_Angeles'] as const;
const ORIGINAL_TZ = process.env.TZ;

function restoreTz(): void {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
}

/** Monday 2026-10-26, 12:00 at UTC+8. */
const NOW = Date.parse('2026-10-26T04:00:00.000Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe('boardTzLabel', () => {
  it('says 北京时间 for +8, UTC for 0, and UTC±H[:MM] otherwise', () => {
    expect(boardTzLabel(8)).toBe('北京时间');
    expect(boardTzLabel(0)).toBe('UTC');
    expect(boardTzLabel(9)).toBe('UTC+9');
    expect(boardTzLabel(-5)).toBe('UTC-5');
    expect(boardTzLabel(5.5)).toBe('UTC+5:30');
    expect(boardTzLabel(-3.5)).toBe('UTC-3:30');
    expect(boardTzLabel(5.75)).toBe('UTC+5:45');
    expect(boardTzLabel(14)).toBe('UTC+14');
  });
});

// --- src/lib/time.ts: the board's clock on the web (spec §5 #9, §11 #8) -------

/** Run `fn` with the process in `tz`, then put the zone back. */
function inZone<T>(tz: string, fn: () => T): T {
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    restoreTz();
  }
}

/** Friday 2026-10-30, 21:00 at UTC+8. */
const FRI_2100_BJ = '2026-10-30T13:00:00.000Z';

describe('formatWhen without a board offset is unchanged (browser zone)', () => {
  const CASES: Record<(typeof ZONES)[number], Array<[string, string]>> = {
    // NOW is Monday 12:00 here.
    'Asia/Shanghai': [
      ['2026-10-26T12:00:00.000Z', '今天 20:00'],
      ['2026-10-27 12:00:00', '明天 20:00'],
      [FRI_2100_BJ, '周五 21:00'],
      ['2026-11-06T13:00:00.000Z', '11月6日 21:00'],
    ],
    // NOW is Monday 04:00 here.
    UTC: [
      ['2026-10-26T12:00:00.000Z', '今天 12:00'],
      ['2026-10-27 12:00:00', '明天 12:00'],
      [FRI_2100_BJ, '周五 13:00'],
      ['2026-11-06T13:00:00.000Z', '11月6日 13:00'],
    ],
    // NOW is Sunday 21:00 here (PDT); PST from 1 November.
    'America/Los_Angeles': [
      ['2026-10-26T12:00:00.000Z', '明天 05:00'],
      ['2026-10-27 12:00:00', '周二 05:00'],
      [FRI_2100_BJ, '周五 06:00'],
      ['2026-11-06T13:00:00.000Z', '11月6日 05:00'],
    ],
  };

  it.each(ZONES)('in %s', (tz) => {
    inZone(tz, () => {
      for (const [value, label] of CASES[tz]) expect(formatWhen(value, NOW), value).toBe(label);
      expect(formatWhen('not a date', NOW)).toBe('');
    });
  });
});

describe.each(ZONES)("formatWhen on the board's clock, with the process in %s", (tz) => {
  beforeAll(() => {
    process.env.TZ = tz;
  });
  afterAll(restoreTz);

  it('reads the wall clock at the given offset', () => {
    expect(formatWhen(FRI_2100_BJ, NOW, 8)).toBe('周五 21:00');
    expect(formatWhen(FRI_2100_BJ, NOW, 0)).toBe('周五 13:00');
    expect(formatWhen(FRI_2100_BJ, NOW, 5.5)).toBe('周五 18:30');
    expect(formatWhen('2026-11-06T13:00:00.000Z', NOW, 8)).toBe('11月6日 21:00');
    expect(formatWhen('not a date', NOW, 8)).toBe('');
  });

  it("buckets 今天 / 明天 by the board's day, not the viewer's", () => {
    const mon2330 = Date.parse('2026-10-26T15:30:00.000Z'); // Monday 23:30 at UTC+8
    const tue0030 = '2026-10-26T16:30:00.000Z'; // Tuesday 00:30 at UTC+8, still Monday in UTC
    expect(formatWhen(tue0030, mon2330, 8)).toBe('明天 00:30');
    expect(formatWhen(tue0030, mon2330, 0)).toBe('今天 16:30');
    // NOW is Sunday 23:00 at UTC-5: Monday 07:00 there is tomorrow.
    expect(formatWhen('2026-10-26T12:00:00.000Z', NOW, -5)).toBe('明天 07:00');
  });
});
