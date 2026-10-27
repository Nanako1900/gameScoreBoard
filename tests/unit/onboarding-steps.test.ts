import { describe, expect, it } from 'vitest';
import { missingOnboardingSteps } from '../../src/lib/onboardingSteps';

const member = { is_participant: true, is_judge: false };
const visitor = { is_participant: false, is_judge: false };

describe('missing onboarding steps from server facts', () => {
  it('has no signed-in onboarding reminder for a visitor', () => {
    expect(missingOnboardingSteps(null, null)).toEqual([]);
  });
  it.each([undefined, 'error'] as const)('does not invent Discord progress while its read is %s', (discord) => {
    expect(missingOnboardingSteps(member, discord)).toEqual([]);
    expect(missingOnboardingSteps(visitor, discord)).toEqual([4]);
  });
  it('counts binding, DM permission and identity separately', () => {
    expect(missingOnboardingSteps(visitor, null)).toEqual([2, 3, 4]);
    expect(missingOnboardingSteps(member, null)).toEqual([2, 3]);
    expect(missingOnboardingSteps(member, { notify_dm: false, dm_ok: true })).toEqual([3]);
    expect(missingOnboardingSteps(member, { notify_dm: true, dm_ok: false })).toEqual([3]);
    expect(missingOnboardingSteps(member, {})).toEqual([3]);
  });
  it('accepts either server identity role and requires both DM flags', () => {
    const ready = { notify_dm: true, dm_ok: true };
    expect(missingOnboardingSteps(member, ready)).toEqual([]);
    expect(missingOnboardingSteps({ is_participant: false, is_judge: true }, ready)).toEqual([]);
    expect(missingOnboardingSteps(visitor, ready)).toEqual([4]);
  });
});
