// The retained local drafts (spec §5 #4): their shapes, and validators for what
// comes back out of storage. Storage is outside data — a draft from an older
// build, another tab or a hand edit must not crash a form or smuggle in a value
// the form could not produce. Anything that no longer fits (a person who left
// the roster, a slot that passed, a judge role the user lacks) is dropped.
// Pure: unit-tested in tests/unit/draft-shapes.test.ts.

import { APPEAL_MAX, MAX_NARRATIVE_LEN } from '@shared/scoring';

/** CaseDialog's per-person note (单独补一句). */
export const CASE_EXTRA_MAX = 300;
/** IdentityForm's custom display name. */
export const DISPLAY_NAME_MAX = 24;

export interface CaseDraftValue {
  picked: string[];
  claim: string;
  extras: Record<string, string>;
}
export type OnboardingChoice = 'participant' | 'judge' | 'both';
export interface OnboardingDraftValue {
  choice: OnboardingChoice;
  useNanako: boolean;
  customName: string;
}

const ONBOARDING_CHOICES: readonly string[] = ['participant', 'judge', 'both'];

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

function stringList(raw: unknown): string[] | null {
  return Array.isArray(raw) && raw.every((item) => typeof item === 'string') ? (raw as string[]) : null;
}

export function isBlankText(text: string): boolean {
  return text.trim().length === 0;
}

/** A free-text draft (说明、申诉理由): a string within the field's cap. */
function textDraft(max: number): (raw: unknown) => string | null {
  return (raw) => (typeof raw === 'string' && raw.length <= max ? raw : null);
}

export const validateStatementDraft = textDraft(MAX_NARRATIVE_LEN);
export const validateAppealDraft = textDraft(APPEAL_MAX);

export function validateCaseDraft(
  raw: unknown,
  candidateIds: readonly string[],
  maxSubjects: number,
): CaseDraftValue | null {
  if (!isRecord(raw)) return null;
  const { picked: rawPicked, claim, extras: rawExtras } = raw;
  const picked = stringList(rawPicked);
  if (picked === null || typeof claim !== 'string' || claim.length > MAX_NARRATIVE_LEN || !isRecord(rawExtras)) {
    return null;
  }
  const kept = picked.filter((id) => candidateIds.includes(id)).slice(0, Math.max(0, maxSubjects));
  const extras = Object.fromEntries(
    Object.entries(rawExtras).filter(
      (entry): entry is [string, string] =>
        kept.includes(entry[0]) && typeof entry[1] === 'string' && entry[1].length <= CASE_EXTRA_MAX,
    ),
  );
  return { picked: kept, claim, extras };
}

export function isCaseDraftEmpty(value: CaseDraftValue): boolean {
  return value.picked.length === 0 && isBlankText(value.claim) && Object.values(value.extras).every(isBlankText);
}

export function validateOnboardingDraft(raw: unknown, canJudge: boolean): OnboardingDraftValue | null {
  if (!isRecord(raw)) return null;
  const { choice, useNanako, customName } = raw;
  if (typeof choice !== 'string' || !ONBOARDING_CHOICES.includes(choice)) return null;
  // The API refuses a self-granted judge role (worker/routes.ts /api/me/roles): never pre-pick one.
  if (!canJudge && choice !== 'participant') return null;
  if (typeof useNanako !== 'boolean' || typeof customName !== 'string' || customName.length > DISPLAY_NAME_MAX) {
    return null;
  }
  return { choice: choice as OnboardingChoice, useNanako, customName };
}
