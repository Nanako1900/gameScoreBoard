import type { OnboardingStepId } from './onboardingSteps';

export const ONBOARDING_DISMISSED_KEY = 'edg.todo.onboarding-dismissed';
const OLD_UNBOUND_KEY = 'edg.todo.unbound-dismissed';
const SEVEN_DAYS = 7 * 86_400_000;
export interface OnboardingDismissal {
  userId: string;
  dismissedAt: number;
  missing: readonly OnboardingStepId[];
}

/** A dismissal is a notice preference, never evidence that a server step is done. */
export function isOnboardingDismissed(mark: OnboardingDismissal | null, userId: string,
  missing: readonly OnboardingStepId[], now: number): boolean {
  if (mark === null || mark.userId !== userId || !Number.isFinite(mark.dismissedAt) || mark.dismissedAt < 0) return false;
  const age = now - mark.dismissedAt;
  return age >= 0 && age < SEVEN_DAYS && missing.every((id) => mark.missing.includes(id));
}

type Store = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };
function storage(): Store | null {
  try { return (globalThis as unknown as { localStorage?: Store }).localStorage ?? null; }
  catch { return null; }
}
export function readOnboardingDismissed(): OnboardingDismissal | null {
  try {
    const raw: unknown = JSON.parse(storage()?.getItem(ONBOARDING_DISMISSED_KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return null;
    const { userId, dismissedAt, missing } = raw as Record<string, unknown>;
    if (typeof userId !== 'string' || !userId || typeof dismissedAt !== 'number' || !Number.isFinite(dismissedAt)
      || dismissedAt < 0 || !Array.isArray(missing) || missing.length === 0 || missing.length > 3
      || !missing.every((id) => id === 2 || id === 3 || id === 4) || new Set(missing).size !== missing.length) return null;
    return { userId, dismissedAt, missing: missing as OnboardingStepId[] };
  } catch { return null; }
}
export function dismissOnboarding(userId: string, missing: readonly OnboardingStepId[], now = Date.now()): OnboardingDismissal {
  const mark: OnboardingDismissal = { userId, dismissedAt: now, missing: [...missing] };
  try { storage()?.setItem(ONBOARDING_DISMISSED_KEY, JSON.stringify(mark)); } catch { /* Storage can be blocked. */ }
  return mark;
}
export function clearTodoMarks(): void {
  for (const key of [ONBOARDING_DISMISSED_KEY, OLD_UNBOUND_KEY]) {
    try { storage()?.removeItem(key); } catch { /* Storage can be blocked. */ }
  }
}
