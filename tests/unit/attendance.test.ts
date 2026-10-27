import { describe, expect, it } from 'vitest';
import { isAllowedTypeOverride } from '../../shared/attendance';

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
