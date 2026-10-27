// The six local drafts (spec §5 #4): their shapes, and validators for what
// comes back out of storage. Storage is outside data — a draft from an older
// build, another tab or a hand edit must not crash a form or smuggle in a value
// the form could not produce. Anything that no longer fits (a person who left
// the roster, a slot that passed, a judge role the user lacks) is dropped.
// Pure: unit-tested in tests/unit/draft-shapes.test.ts.

import { isAttendance, SESSION_GAME_MAX, SESSION_NOTE_MAX, type Attendance } from '@shared/attendance';
import { APPEAL_MAX, MAX_NARRATIVE_LEN } from '@shared/scoring';
import type { SessionPlayer } from '../types';

/** CaseDialog's per-person note (单独补一句). */
export const CASE_EXTRA_MAX = 300;
/** OnboardingDialog's custom display name. */
export const DISPLAY_NAME_MAX = 24;
/** RollCallDialog's minutes-late field — the API's MAX_LATE_MINUTES (worker/sessions.ts:49). */
export const LATE_MINUTES_MAX = 24 * 60;

export interface CaseDraftValue {
  picked: string[];
  claim: string;
  extras: Record<string, string>;
}
export interface StoredMark {
  attendance: Attendance;
  late_minutes?: number;
}
/** Only the marks made on this device, by user id; the server's show through underneath. */
export type RollCallDraftValue = Record<string, StoredMark>;
export interface SessionDraftValue {
  invite: string[];
  custom: string;
  chosen: string | null;
  more?: { game: string; capacity: string; durationMin: string; note: string };
}
export type OnboardingChoice = 'participant' | 'judge' | 'both';
export interface OnboardingDraftValue {
  choice: OnboardingChoice;
  useNanako: boolean;
  customName: string;
}
/** What step 1 of the roll call edits: the minutes stay a string while being typed. */
export interface MarkInput {
  attendance: Attendance | null;
  lateMinutes: string;
}

const ONBOARDING_CHOICES: readonly string[] = ['participant', 'judge', 'both'];
/** A `datetime-local` value: YYYY-MM-DDTHH:MM. */
const DATETIME_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

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

export function isLateMinutes(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= LATE_MINUTES_MAX;
}

function parseMark(raw: unknown): StoredMark | null {
  if (!isRecord(raw)) return null;
  const { attendance, late_minutes: late } = raw;
  if (typeof attendance !== 'string' || !isAttendance(attendance)) return null;
  return isLateMinutes(late) ? { attendance, late_minutes: late } : { attendance };
}

export function validateRollCallDraft(raw: unknown, rosterIds: readonly string[]): RollCallDraftValue | null {
  if (!isRecord(raw)) return null;
  const marks = Object.entries(raw).flatMap(([id, value]): [string, StoredMark][] => {
    const mark = rosterIds.includes(id) ? parseMark(value) : null;
    return mark ? [[id, mark]] : [];
  });
  return Object.fromEntries(marks);
}

export function isRollCallDraftEmpty(value: RollCallDraftValue): boolean {
  return Object.keys(value).length === 0;
}

/** The server's marks with this device's on top — what step 1 shows. */
export function mergeMarks(
  roster: readonly Pick<SessionPlayer, 'user' | 'attendance' | 'late_minutes'>[],
  draft: RollCallDraftValue,
): Record<string, MarkInput> {
  return Object.fromEntries(
    roster.map((p) => {
      const mine = draft[p.user.id];
      const late = mine ? mine.late_minutes : p.late_minutes ?? undefined;
      const input: MarkInput = {
        attendance: mine?.attendance ?? p.attendance,
        lateMinutes: late === undefined ? '' : String(late),
      };
      return [p.user.id, input];
    }),
  );
}

/** One person's step-1 input as the draft keeps it; null until an attendance is picked. */
export function toStoredMark(input: MarkInput): StoredMark | null {
  if (input.attendance === null) return null;
  const minutes = input.lateMinutes.trim() === '' ? Number.NaN : Number(input.lateMinutes);
  return isLateMinutes(minutes)
    ? { attendance: input.attendance, late_minutes: minutes }
    : { attendance: input.attendance };
}

function sessionMore(raw: unknown): SessionDraftValue['more'] {
  if (!isRecord(raw)) return undefined;
  const { game, capacity, durationMin, note } = raw;
  if (typeof game !== 'string' || game.length > SESSION_GAME_MAX || typeof note !== 'string' || note.length > SESSION_NOTE_MAX
    || typeof capacity !== 'string' || typeof durationMin !== 'string') return undefined;
  return { game, capacity, durationMin, note };
}

export function validateSessionDraft(
  raw: unknown,
  invitableIds: readonly string[],
  slotIsos: readonly string[],
): SessionDraftValue | null {
  if (!isRecord(raw)) return null;
  const invite = stringList(raw.invite);
  const { custom, chosen } = raw;
  if (invite === null || typeof custom !== 'string') return null;
  if (custom !== '' && !DATETIME_LOCAL.test(custom)) return null;
  if (chosen !== null && typeof chosen !== 'string') return null;
  const more = sessionMore(raw.more);
  return {
    invite: invite.filter((id) => invitableIds.includes(id)),
    custom,
    chosen: typeof chosen === 'string' && slotIsos.includes(chosen) ? chosen : null,
    ...(more ? { more } : {}),
  };
}

/** Only people make a session form worth guarding (spec §3.6 离开保护). */
export function isSessionDraftEmpty(value: SessionDraftValue): boolean {
  return value.invite.length === 0;
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
