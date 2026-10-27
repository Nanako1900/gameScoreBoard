// Completion comes only from current server facts, never drafts or browser marks.
export type OnboardingStepId = 2 | 3 | 4;
interface Identity { is_participant: boolean; is_judge: boolean }
interface DiscordDelivery { notify_dm?: boolean; dm_ok?: boolean }

export function missingOnboardingSteps(
  me: Identity | null,
  discord: DiscordDelivery | null | undefined | 'error',
): readonly OnboardingStepId[] {
  if (me === null) return [];
  const missing: OnboardingStepId[] = [];
  if (discord === null) missing.push(2, 3);
  else if (discord !== undefined && discord !== 'error' && (discord.notify_dm !== true || discord.dm_ok !== true)) missing.push(3);
  if (!me.is_participant && !me.is_judge) missing.push(4);
  return missing;
}
