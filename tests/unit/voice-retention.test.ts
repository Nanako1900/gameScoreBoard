import { describe, expect, it } from 'vitest';
import { firstAvailableVoiceDate, voiceRangeBounds } from '../../shared/voiceDays';
import { VOICE_RETENTION_DAYS } from '../../shared/voice';
const DAY = 86_400_000;
const ms = (text: string) => Date.parse(text.replace(' ', 'T') + 'Z');
describe('first complete board day still within retention', () => {
  it('includes the exact 90-day boundary at board midnight', () => {
    expect(firstAvailableVoiceDate('2026-10-27 00:00:00', 0)).toBe('2026-07-29');
    expect(firstAvailableVoiceDate('2026-10-26 16:00:00', 8)).toBe('2026-07-29');
  });
  it('rejects a partially expired day even when only its first second expired', () => {
    expect(firstAvailableVoiceDate('2026-10-27 00:00:01', 0)).toBe('2026-07-30');
    expect(firstAvailableVoiceDate('2026-10-26 16:00:01', 8)).toBe('2026-07-30');
  });
  it.each([0, 8, 5.5, -3.5])('finds the first whole valid day using board offset %s', (offset) => {
    const now = '2026-10-27 01:00:00';
    const date = firstAvailableVoiceDate(now, offset);
    const cutoff = ms(now) - VOICE_RETENTION_DAYS * DAY;
    expect(ms(voiceRangeBounds(date, date, offset).start)).toBeGreaterThanOrEqual(cutoff);
    const previous = new Date(Date.parse(date + 'T00:00:00Z') - DAY).toISOString().slice(0, 10);
    expect(ms(voiceRangeBounds(previous, previous, offset).start)).toBeLessThan(cutoff);
  });
  it('keeps leap days and validates its instant and offset inputs', () => {
    expect(firstAvailableVoiceDate('2024-05-29 00:00:00', 0)).toBe('2024-02-29');
    expect(() => firstAvailableVoiceDate('2026-02-30 00:00:00', 8)).toThrow(RangeError);
    expect(() => firstAvailableVoiceDate('2026-10-27 00:00:00', NaN)).toThrow(RangeError);
  });
});
