import { describe, expect, it } from 'vitest';
import {
  FUTURE_HOUR,
  MAX_SLOTS,
  MIN_LEAD_MINUTES,
  TODAY_HOURS,
  quickSlots,
  synthesizeTitle,
} from '../../shared/quickTime';

/** Local-time constructor so the assertions read in the same frame as the code. */
function at(y: number, m: number, d: number, h: number, min = 0): Date {
  return new Date(y, m - 1, d, h, min, 0, 0);
}

describe('quickSlots', () => {
  it('offers the remaining evening hours today', () => {
    // Wednesday 2026-07-22, 18:00 local — all three evening slots still ahead.
    const slots = quickSlots(at(2026, 7, 22, 18));
    const labels = slots.map((s) => s.label);
    expect(labels[0]).toBe(`今晚 ${TODAY_HOURS[0]}:00`);
    expect(labels).toContain('今晚 21:00');
  });

  it('drops today slots that have already passed', () => {
    const slots = quickSlots(at(2026, 7, 22, 21, 30));
    expect(slots.map((s) => s.label)).not.toContain('今晚 20:00');
    expect(slots.map((s) => s.label)).not.toContain('今晚 21:00');
  });

  it('honours the minimum lead time', () => {
    // 19:45 — 20:00 is only 15 minutes out, below the floor.
    const slots = quickSlots(at(2026, 7, 22, 19, 45));
    expect(slots.map((s) => s.label)).not.toContain('今晚 20:00');
    expect(MIN_LEAD_MINUTES).toBeGreaterThan(15);
  });

  it('labels tomorrow explicitly and later days by weekday', () => {
    const labels = quickSlots(at(2026, 7, 22, 18)).map((s) => s.label);
    expect(labels).toContain(`明晚 ${FUTURE_HOUR}:00`);
    // 2026-07-22 is a Wednesday, so Friday is two days out.
    expect(labels.some((l) => l.startsWith('周五'))).toBe(true);
  });

  it('never reaches past the end of this week', () => {
    // Monday: the furthest slot may be Sunday, never the following Monday.
    const slots = quickSlots(at(2026, 7, 20, 9));
    const labels = slots.map((s) => s.label);
    expect(labels).not.toContain('周一 20:00');
    for (const s of slots) {
      // Within 7 days, which bounds "today through this week".
      expect(s.at - at(2026, 7, 20, 9).getTime()).toBeLessThan(7 * 86_400_000);
    }
  });

  it('still offers something on a late Sunday night, when the week is spent', () => {
    // Sunday 23:30: no evening slots left and no days left this week.
    const slots = quickSlots(at(2026, 7, 26, 23, 30));
    expect(slots.length).toBeGreaterThan(0);
  });

  it('returns slots in chronological order, capped', () => {
    const slots = quickSlots(at(2026, 7, 20, 8));
    expect(slots.length).toBeLessThanOrEqual(MAX_SLOTS);
    for (let i = 1; i < slots.length; i += 1) {
      expect(slots[i].at).toBeGreaterThan(slots[i - 1].at);
    }
  });

  it('emits parseable ISO strings that match the reported epoch', () => {
    for (const s of quickSlots(at(2026, 7, 22, 18))) {
      expect(Date.parse(s.iso)).toBe(s.at);
    }
  });

  it('never offers a slot in the past', () => {
    const now = at(2026, 7, 24, 20, 10);
    for (const s of quickSlots(now)) {
      expect(s.at).toBeGreaterThan(now.getTime());
    }
  });
});

describe('synthesizeTitle', () => {
  it('reads the weekday and time in the board timezone, not UTC', () => {
    // 2026-07-24T12:00Z is Friday 20:00 in UTC+8.
    expect(synthesizeTitle('2026-07-24T12:00:00.000Z', 8)).toBe('周五 20:00 开黑');
  });

  it('shifts correctly across the date line', () => {
    // 2026-07-24T17:00Z is Saturday 01:00 in UTC+8.
    expect(synthesizeTitle('2026-07-24T17:00:00.000Z', 8)).toBe('周六 01:00 开黑');
  });

  it('degrades to a usable title on garbage input', () => {
    expect(synthesizeTitle('not-a-date', 8)).toBe('开黑');
  });
});
