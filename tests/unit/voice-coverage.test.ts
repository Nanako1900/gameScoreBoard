import { describe, expect, it } from 'vitest';
import { intersectVoiceCoverage } from '../../shared/voiceCoverage';
import type { CoverageRow } from '../../shared/voiceDays';

const row = (start: string, end: string): CoverageRow => ({ started_at: `2026-10-27 ${start}`, last_seen_at: `2026-10-27 ${end}` });

describe('coverage retained across segment reads', () => {
  it('intersects both unions rather than pairing individual unordered rows', () => {
    const before = [row('08:00:00', '11:00:00'), row('00:00:00', '04:00:00'), row('03:00:00', '06:00:00')];
    const after = [row('09:00:00', '12:00:00'), row('02:00:00', '05:00:00'), row('05:00:00', '10:00:00')];
    expect(intersectVoiceCoverage(before, after)).toEqual([row('02:00:00', '06:00:00'), row('08:00:00', '11:00:00')]);
  });
  it.each([[[], []], [[row('00:00:00', '12:00:00')], []], [[], [row('00:00:00', '12:00:00')]]])
    ('does not infer coverage when either snapshot is empty: %j / %j', (before, after) => {
      expect(intersectVoiceCoverage(before, after)).toEqual([]);
    });
  it('ignores coverage added or extended after the segments snapshot', () => {
    expect(intersectVoiceCoverage([row('02:00:00', '04:00:00')], [row('00:00:00', '12:00:00')]))
      .toEqual([row('02:00:00', '04:00:00')]);
  });
  it('removes coverage revoked after the first coverage snapshot', () => {
    expect(intersectVoiceCoverage([row('00:00:00', '12:00:00')], [row('02:00:00', '04:00:00'), row('08:00:00', '09:00:00')]))
      .toEqual([row('02:00:00', '04:00:00'), row('08:00:00', '09:00:00')]);
  });
  it('does not bridge disjoint old and replacement coverage', () => {
    expect(intersectVoiceCoverage([row('00:00:00', '06:00:00')], [row('08:00:00', '12:00:00')])).toEqual([]);
  });
  it('preserves the one observed point where closed intervals meet', () => {
    expect(intersectVoiceCoverage([row('00:00:00', '12:00:00')], [row('12:00:00', '13:00:00')]))
      .toEqual([row('12:00:00', '12:00:00')]);
    expect(intersectVoiceCoverage([row('12:00:00', '12:00:00')], [row('12:00:00', '12:00:00')]))
      .toEqual([row('12:00:00', '12:00:00')]);
  });
  it('does not lose boundary points alongside separate spans', () => {
    expect(intersectVoiceCoverage([row('01:00:00', '02:00:00'), row('04:00:00', '06:00:00')],
      [row('02:00:00', '04:00:00'), row('05:00:00', '07:00:00')]))
      .toEqual([row('02:00:00', '02:00:00'), row('04:00:00', '04:00:00'), row('05:00:00', '06:00:00')]);
  });
  it('returns fresh public rows without mutating frozen snapshots', () => {
    const before = Object.freeze([Object.freeze({ ...row('00:00:00', '12:00:00'), id: 42 })]);
    const after = Object.freeze([Object.freeze(row('02:00:00', '04:00:00'))]);
    const result = intersectVoiceCoverage(before, after);
    expect(result).toEqual([row('02:00:00', '04:00:00')]);
    expect(result[0]).not.toBe(before[0]); expect(result[0]).not.toBe(after[0]);
  });
  it.each([
    { started_at: '2026-02-30 00:00:00', last_seen_at: '2026-10-27 12:00:00' },
    { started_at: '2026-10-27T00:00:00Z', last_seen_at: '2026-10-27 12:00:00' },
    row('12:00:00', '00:00:00'),
  ])('rejects malformed or reversed persisted intervals: %j', (invalid) => {
    expect(() => intersectVoiceCoverage([invalid], [])).toThrow(RangeError);
    expect(() => intersectVoiceCoverage([], [invalid])).toThrow(RangeError);
  });
});
