// P2-4: the board's time zone (RESET_TZ_OFFSET), on the web and in the bot —
// spec §4.2「时区与时段」, §11 #8. Every case here must read the same in any
// process time zone, so the shared functions run under several zones
// (process.env.TZ, as in client-time.test.ts).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BOARD_SLOTS,
  BOARD_SLOT_MIN_LEAD_MS,
  boardSlots,
  boardTzLabel,
  slotIso,
} from '../../shared/quickTime';
import { formatBoardDateTime, formatViewerAside, formatWhen } from '../../src/lib/time';

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

describe('BOARD_SLOTS', () => {
  it("are /yue's five choices, in order, and a slot must be 15 minutes ahead", () => {
    expect(BOARD_SLOTS.map((s) => [s.value, s.name, s.dayOffset, s.hour])).toEqual([
      ['tonight20', '今晚 20:00', 0, 20],
      ['tonight21', '今晚 21:00', 0, 21],
      ['tonight22', '今晚 22:00', 0, 22],
      ['tomorrow20', '明晚 20:00', 1, 20],
      ['dayafter20', '后天 20:00', 2, 20],
    ]);
    expect(BOARD_SLOT_MIN_LEAD_MS).toBe(15 * MINUTE);
  });
});

describe.each(ZONES)('board slots with the process in %s', (tz) => {
  beforeAll(() => {
    process.env.TZ = tz;
  });
  afterAll(restoreTz);

  it('slotIso is board-local: 20:00 at UTC+8 is 12:00 UTC, across the date line too', () => {
    expect(slotIso(0, 20, 8, NOW)).toBe('2026-10-26T12:00:00.000Z');
    expect(slotIso(1, 20, 8, NOW)).toBe('2026-10-27T12:00:00.000Z');
    // 01:00 on the 27th at UTC+8 is still the 26th in UTC: "tonight" is the 27th's.
    expect(slotIso(0, 20, 8, Date.parse('2026-10-26T17:00:00.000Z'))).toBe('2026-10-27T12:00:00.000Z');
    expect(slotIso(0, 20, 5.5, NOW)).toBe('2026-10-26T14:30:00.000Z');
    expect(slotIso(0, 20, -5, NOW)).toBe('2026-10-26T01:00:00.000Z');
  });

  it('boardSlots offers all five at noon, labelled with their names, in order', () => {
    const slots = boardSlots(NOW, 8);
    expect(slots.map((s) => [s.value, s.label, s.iso])).toEqual([
      ['tonight20', '今晚 20:00', '2026-10-26T12:00:00.000Z'],
      ['tonight21', '今晚 21:00', '2026-10-26T13:00:00.000Z'],
      ['tonight22', '今晚 22:00', '2026-10-26T14:00:00.000Z'],
      ['tomorrow20', '明晚 20:00', '2026-10-27T12:00:00.000Z'],
      ['dayafter20', '后天 20:00', '2026-10-28T12:00:00.000Z'],
    ]);
    for (const s of slots) expect(s.at).toBe(Date.parse(s.iso));
  });

  it('drops a slot that has passed or is less than 15 minutes away (exactly 15 stays)', () => {
    const at2045 = Date.parse('2026-10-26T12:45:00.000Z'); // 20:45 at UTC+8
    expect(boardSlots(at2045, 8).map((s) => s.value)).toEqual(['tonight21', 'tonight22', 'tomorrow20', 'dayafter20']);
    expect(boardSlots(at2045 + 1, 8).map((s) => s.value)).toEqual(['tonight22', 'tomorrow20', 'dayafter20']);
  });

  it("reads the board's day, not UTC's: at 23:00 on the 25th (UTC-5) tonight is gone", () => {
    // NOW is 23:00 on Sunday the 25th at UTC-5.
    expect(boardSlots(NOW, -5).map((s) => [s.value, s.iso])).toEqual([
      ['tomorrow20', '2026-10-27T01:00:00.000Z'],
      ['dayafter20', '2026-10-28T01:00:00.000Z'],
    ]);
  });

  it('is never empty: 明晚 20:00 is always ahead', () => {
    for (const offset of [8, 0, -5, 5.5, 14, -12]) {
      for (let t = NOW; t < NOW + 48 * HOUR; t += 15 * MINUTE) {
        expect(boardSlots(t, offset).map((s) => s.value)).toContain('tomorrow20');
      }
    }
  });
});

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

  it('formatBoardDateTime: weekday, M/D, time and the zone label', () => {
    expect(formatBoardDateTime(FRI_2100_BJ, 8)).toBe('周五 10/30 21:00（北京时间）');
    expect(formatBoardDateTime('2026-10-30 13:00:00', 8)).toBe('周五 10/30 21:00（北京时间）');
    expect(formatBoardDateTime(FRI_2100_BJ, 0)).toBe('周五 10/30 13:00（UTC）');
    expect(formatBoardDateTime(FRI_2100_BJ, 5.5)).toBe('周五 10/30 18:30（UTC+5:30）');
    expect(formatBoardDateTime(FRI_2100_BJ, -5)).toBe('周五 10/30 08:00（UTC-5）');
    // 01:00 on Saturday at UTC+8 is still Friday in UTC.
    expect(formatBoardDateTime('2026-10-30T17:00:00.000Z', 8)).toBe('周六 10/31 01:00（北京时间）');
    expect(formatBoardDateTime('not a date', 8)).toBe('');
  });
});

describe('formatViewerAside: 你那边, only when the viewer is elsewhere', () => {
  it('is null when the browser keeps the board time, or the value is unparseable', () => {
    expect(inZone('Asia/Shanghai', () => formatViewerAside(FRI_2100_BJ, 8))).toBeNull();
    expect(inZone('UTC', () => formatViewerAside(FRI_2100_BJ, 0))).toBeNull();
    expect(inZone('Asia/Kolkata', () => formatViewerAside(FRI_2100_BJ, 5.5))).toBeNull();
    expect(inZone('Asia/Tokyo', () => formatViewerAside('not a date', 8))).toBeNull();
  });

  it("gives the viewer's time when the zones differ", () => {
    expect(inZone('Asia/Tokyo', () => formatViewerAside(FRI_2100_BJ, 8))).toBe('你那边 22:00');
    expect(inZone('America/Los_Angeles', () => formatViewerAside(FRI_2100_BJ, 8))).toBe('你那边 06:00');
    expect(inZone('Asia/Kolkata', () => formatViewerAside(FRI_2100_BJ, 8))).toBe('你那边 18:30');
  });

  it("adds the viewer's weekday when their date is not the board's", () => {
    // Friday 23:30 at UTC+8 is already Saturday in Tokyo.
    expect(inZone('Asia/Tokyo', () => formatViewerAside('2026-10-30T15:30:00.000Z', 8))).toBe('你那边 周六 00:30');
    // Saturday 01:00 at UTC+8 is still Friday morning in Los Angeles.
    expect(inZone('America/Los_Angeles', () => formatViewerAside('2026-10-30T17:00:00.000Z', 8))).toBe('你那边 周五 10:00');
  });

  it("compares the viewer's offset at that instant (daylight saving)", () => {
    // Los Angeles is UTC-7 until 1 November 2026, then UTC-8.
    expect(inZone('America/Los_Angeles', () => formatViewerAside(FRI_2100_BJ, -7))).toBeNull();
    expect(inZone('America/Los_Angeles', () => formatViewerAside('2026-11-06T13:00:00.000Z', -7))).toBe('你那边 05:00');
  });
});
