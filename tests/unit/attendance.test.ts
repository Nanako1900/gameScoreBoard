import { describe, expect, it } from 'vitest';
import {
  ATTENDANCES,
  LATE_MAJOR_MAX,
  LATE_MINOR_MAX,
  draftClaim,
  isAllowedTypeOverride,
  isAttendance,
  isRsvp,
  violationForAttendance,
} from '../../shared/attendance';
import { VIOLATION_MAP } from '../../shared/scoring';

describe('violationForAttendance', () => {
  it('maps the non-late outcomes', () => {
    expect(violationForAttendance('on_time', null)).toBe('on_time_bonus');
    expect(violationForAttendance('excused', null)).toBeNull();
    expect(violationForAttendance('left_early', null)).toBe('mid_quit');
    expect(violationForAttendance('no_show', null)).toBe('no_show');
  });

  it('never auto-escalates a no-show to the -25 group-wipe variant', () => {
    // Only a human who was there can know the session actually collapsed.
    expect(violationForAttendance('no_show', 999)).toBe('no_show');
  });

  it('grades lateness at the documented thresholds', () => {
    expect(violationForAttendance('late', 0)).toBe('late_minor');
    expect(violationForAttendance('late', LATE_MINOR_MAX - 1)).toBe('late_minor');
    expect(violationForAttendance('late', LATE_MINOR_MAX)).toBe('late_major');
    expect(violationForAttendance('late', LATE_MAJOR_MAX)).toBe('late_major');
    expect(violationForAttendance('late', LATE_MAJOR_MAX + 1)).toBe('late_severe');
  });

  it('treats a missing minute count as "barely late" rather than severe', () => {
    expect(violationForAttendance('late', null)).toBe('late_minor');
    expect(violationForAttendance('late', Number.NaN)).toBe('late_minor');
  });

  it('only ever yields types the scoring module knows about', () => {
    for (const a of ATTENDANCES) {
      const type = violationForAttendance(a, 20);
      if (type !== null) expect(VIOLATION_MAP[type]).toBeDefined();
    }
  });
});

describe('isAllowedTypeOverride', () => {
  it('permits the single legitimate human re-classification', () => {
    expect(isAllowedTypeOverride('no_show', 'no_show_group')).toBe(true);
  });

  it('permits a no-op', () => {
    expect(isAllowedTypeOverride('late_minor', 'late_minor')).toBe(true);
  });

  it('rejects escalating a small lateness into anything else', () => {
    // The attack this blocks: a tampered settle request turning 小迟到 (-3) into
    // 团灭级放鸽 (-25).
    expect(isAllowedTypeOverride('late_minor', 'no_show_group')).toBe(false);
    expect(isAllowedTypeOverride('late_minor', 'no_show')).toBe(false);
    expect(isAllowedTypeOverride('on_time_bonus', 'no_show_group')).toBe(false);
    expect(isAllowedTypeOverride('mid_quit', 'no_show_group')).toBe(false);
  });

  it('rejects downgrading a penalty into a bonus', () => {
    expect(isAllowedTypeOverride('no_show', 'on_time_bonus')).toBe(false);
  });
});

describe('guards', () => {
  it('validates rsvp and attendance strings', () => {
    expect(isRsvp('going')).toBe(true);
    expect(isRsvp('GOING')).toBe(false);
    expect(isAttendance('no_show')).toBe(true);
    expect(isAttendance('drop_table')).toBe(false);
  });
});

describe('draftClaim', () => {
  it('names the session and the outcome', () => {
    const claim = draftClaim('周五五排', '7月25日 20:00', 'late', 22);
    expect(claim).toContain('周五五排');
    expect(claim).toContain('7月25日 20:00');
    expect(claim).toContain('22');
  });

  it('produces a usable claim for every outcome', () => {
    for (const a of ATTENDANCES) {
      expect(draftClaim('局', '今天', a, 5).length).toBeGreaterThan(5);
    }
  });
});
