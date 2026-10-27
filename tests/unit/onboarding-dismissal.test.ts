import { describe, expect, it } from 'vitest';
import { isOnboardingDismissed } from '../../src/lib/todoMarks';
const NOW = Date.parse('2026-10-27T12:00:00Z');
const DAY = 86_400_000;
const mark = { userId: 'me', dismissedAt: NOW, missing: [2, 3] as const };
describe('seven-day onboarding dismissal', () => {
  it('hides the same or fewer missing steps only for the account that dismissed them', () => {
    expect(isOnboardingDismissed(mark, 'me', [2, 3], NOW)).toBe(true);
    expect(isOnboardingDismissed(mark, 'me', [3], NOW + DAY)).toBe(true);
    expect(isOnboardingDismissed(mark, 'other', [2, 3], NOW)).toBe(false);
  });
  it('resurfaces when a different missing step appears, even if the count is unchanged', () => {
    expect(isOnboardingDismissed(mark, 'me', [3, 4], NOW + DAY)).toBe(false);
    expect(isOnboardingDismissed(mark, 'me', [2, 3, 4], NOW + DAY)).toBe(false);
  });
  it('expires at seven days, and cannot hide for a damaged or future timestamp', () => {
    expect(isOnboardingDismissed(mark, 'me', [2], NOW + 7 * DAY - 1)).toBe(true);
    expect(isOnboardingDismissed(mark, 'me', [2], NOW + 7 * DAY)).toBe(false);
    for (const dismissedAt of [NOW + 1, NaN, Infinity, -1]) {
      expect(isOnboardingDismissed({ ...mark, dismissedAt }, 'me', [2], NOW)).toBe(false);
    }
    expect(isOnboardingDismissed(null, 'me', [2], NOW)).toBe(false);
  });
});
