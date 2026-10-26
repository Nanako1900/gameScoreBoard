import { describe, expect, it } from 'vitest';
import { weekOver } from '../src/outbox/report-delivery';

describe('weekOver', () => {
  it('ends the week at Monday 00:00 board time, whichever side of UTC', () => {
    // The week of 2026-10-19 ends at 2026-10-26 00:00 local.
    expect(weekOver('2026-10-19', 8, Date.parse('2026-10-25T15:59:59Z'))).toBe(false);
    expect(weekOver('2026-10-19', 8, Date.parse('2026-10-25T16:00:00Z'))).toBe(true);
    expect(weekOver('2026-10-19', -5, Date.parse('2026-10-26T04:59:59Z'))).toBe(false);
    expect(weekOver('2026-10-19', -5, Date.parse('2026-10-26T05:00:00Z'))).toBe(true);
    expect(weekOver('not a day', 8, Date.now())).toBe(false);
  });
});
