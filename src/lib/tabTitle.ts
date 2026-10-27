// The browser tab's title: '(N) EDG 信誉分' while something waits on you. Pure.
import type { PendingCounts, User } from '../types';

export const BASE_TITLE = 'EDG 信誉分';

/** 0 → 'EDG 信誉分'; 4 → '(4) EDG 信誉分'. */
export function tabTitle(count: number): string {
  return Number.isFinite(count) && count > 0 ? `(${Math.floor(count)}) ${BASE_TITLE}` : BASE_TITLE;
}

/** Structurally Pick<CoreData, 'me' | 'invites' | 'pending'>, without importing the fetch client. */
export interface TodoSource {
  me: User | null;
  invites: readonly unknown[];
  pending: PendingCounts;
}

/** Unanswered invites + statements owed (+ appeals to review, admins only). Signed out: 0. */
export function todoCount({ me, invites, pending }: TodoSource): number {
  if (!me) return 0;
  return invites.length + pending.statements + (me.is_admin ? pending.appeals : 0);
}
