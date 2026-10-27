// The reporter's revoke window as a countdown (spec §5 #6, §3.8). Pure.
// The server decides with `Date.now() - created_at <= REVOKE_WINDOW_MS`
// (worker/cases.ts revokeCase); this only says how much of it is left, so the
// button can show it and disappear once it is gone — never a negative number.

import { REVOKE_WINDOW_MS } from '@shared/scoring';
import { parseTimestamp } from './time';

const MINUTE_MS = 60_000;

/** ms left in the reporter's revoke window, clamped at 0 (an unreadable created_at counts as closed). */
export function revokeMsLeft(createdAt: string, now: number): number {
  const created = parseTimestamp(createdAt);
  if (Number.isNaN(created)) return 0;
  return Math.max(0, created + REVOKE_WINDOW_MS - now);
}

/**
 * '还剩 12 分钟' | '还剩不到 1 分钟'. Whole minutes, rounded down: the button
 * refreshes every 30 s, and an mm:ss clock would visibly skip seconds.
 */
export function formatRevokeLeft(msLeft: number): string {
  const minutes = Math.floor(msLeft / MINUTE_MS);
  return minutes >= 1 ? `还剩 ${minutes} 分钟` : '还剩不到 1 分钟';
}
