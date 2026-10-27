// src/lib/routeCopy.ts — what the router's pages say (spec §2.2). Pure: tests/unit imports it.
// The two case sentences are pinned by tests (deep-link.test.tsx, p8-app.test.tsx).

import { CASE_STATUS_LABEL } from '@shared/scoring';
import type { RecordItem } from '../types';
import { PENDING_HIDDEN_LABEL, isPendingHidden, violationLabel } from './recordView';

export const SESSIONS_OFF = '约局功能已下线';
export const SESSIONS_OFF_DESCRIPTION = '约人直接在 Discord 里喊；迟到、放鸽子由裁判记录。';

export const NOT_FOUND_TITLE = '这页不存在';
export const SESSION_NOT_FOUND = '找不到这局，链接可能写错了。';
export const PLAYER_NOT_FOUND = '找不到这位选手。';
export const CASE_GONE = '链接里的案件不存在了。';
export const CASE_UNAVAILABLE = '打不开链接里的案件，稍后再试。';
export const BACK_HOME = '回大厅';
export const SEE_HISTORY = '看约局历史';
export const SEE_BOARD = '看信誉榜';
export const CASE_OPENING = '正在打开案件…';
/** PageBar's button: history decides where it goes, so it does not promise 大厅 (contract §8 #11). */
export const PAGE_BACK_LABEL = '返回';
/** aria-label of the pinned case on /players/:id/cases/:caseId (spec §3.8). */
export const PINNED_CASE_LABEL = '你点开的这一起';

type EyebrowRecord = Pick<RecordItem, 'id' | 'type' | 'status' | 'pending_hidden'>;

/**
 * 「案件 #7 · 放鸽子 · 待说明」 for whoever may read the case; 「案件 #7 · 处理中」 for
 * the rest before the verdict (B1-1). A decided case has no status label, so it
 * ends at the charge.
 */
export function pinnedCaseEyebrow(record: EyebrowRecord): string {
  const head = `案件 #${record.id}`;
  if (isPendingHidden(record)) return `${head} · ${PENDING_HIDDEN_LABEL}`;
  return [head, violationLabel(record.type), CASE_STATUS_LABEL[record.status]]
    .filter((part) => part !== '')
    .join(' · ');
}
