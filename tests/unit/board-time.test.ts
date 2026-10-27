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
