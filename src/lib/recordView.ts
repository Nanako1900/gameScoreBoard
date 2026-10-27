// B1-1: how the UI names a case, including one the API hid before its verdict
// (`pending_hidden`: no type, claim, note or range — only that it exists).
// Pure — tests/unit/record-view.test.ts.
import { VIOLATION_MAP, type ViolationDef, type ViolationType } from '@shared/scoring';
import type { RecordItem } from '../types';

/** What stands in for the type of a case the API hid (spec §11 #3 tier b). */
export const PENDING_HIDDEN_LABEL = '处理中';
/** Where the delta would be: never a 0 (CONTRACT.md Frontend expectations). */
export const PENDING_HIDDEN_DELTA = '分数变化：判决后公开';

export function isPendingHidden(record: Pick<RecordItem, 'pending_hidden'>): boolean {
  return record.pending_hidden === true;
}

/** 「老王有一起记录在处理中，判决后公开。」 */
export function pendingHiddenSentence(username: string): string {
  return `${username}有一起记录在处理中，判决后公开。`;
}

/** The type's rules entry; undefined for a hidden case (null) or a type this bundle does not know. */
export function violationDef(type: ViolationType | null): ViolationDef | undefined {
  return type === null ? undefined : VIOLATION_MAP[type];
}

/** 「大迟到」; 「处理中」 when the API hid the type; the raw type if this bundle does not know it. */
export function violationLabel(type: ViolationType | null): string {
  if (type === null) return PENDING_HIDDEN_LABEL;
  return violationDef(type)?.label ?? type;
}
