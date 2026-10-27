// Pure inbox rules. Network and browser state are supplied by the caller.
import { isFilingJudge } from '@shared/scoring';
import type { PendingCounts, RecordItem, User } from '../types';
import { missingOnboardingSteps, type OnboardingStepId } from './onboardingSteps';
import { isOnboardingDismissed, type OnboardingDismissal } from './todoMarks';
import { TODO_RANKS } from './constants';
import { isUrgent, parseTimestamp } from './time';

export type TodoItem =
  | { kind: 'statement'; key: string; record: RecordItem; urgent: boolean }
  | { kind: 'escalation'; key: string; record: RecordItem }
  | { kind: 'appeals'; key: string; count: number; earliest: RecordItem | null }
  | { kind: 'onboarding'; key: string; missing: readonly OnboardingStepId[] };
export type TodoKind = TodoItem['kind'];
export interface TodoSources {
  me: User | null; now: number; pending: PendingCounts | null;
  myPending: readonly RecordItem[] | null;
  feed: readonly RecordItem[] | null; appealed: readonly RecordItem[] | null;
  /** Current caller's server flags; unsupported and failed reads stay distinct. */
  discord: { notify_dm?: boolean; dm_ok?: boolean } | null | undefined | 'error';
  onboardingDismissed: OnboardingDismissal | null;
}
function recordTodos(source: TodoSources & { me: User }): TodoItem[] {
  const statements: TodoItem[] = (source.myPending ?? []).filter((r) => r.status === 'awaiting_statement').map((record) => ({
    kind: 'statement', key: `statement:${record.id}`, record,
    urgent: record.deadline_at !== null && isUrgent(record.deadline_at, source.now),
  }));
  const escalations: TodoItem[] = (source.feed ?? []).filter((r) => r.escalation_suggested
    && (r.status === 'awaiting_statement' || r.status === 'judging') && isFilingJudge(source.me, r.reporter.id))
    .map((record) => ({ kind: 'escalation', key: `escalation:${record.id}`, record }));
  const count = source.pending?.appeals ?? 0;
  const earliest = [...(source.appealed ?? [])].sort((a, b) => timeOrLast(a.created_at) - timeOrLast(b.created_at))[0] ?? null;
  const appeals: TodoItem[] = source.me.is_admin && count > 0 ? [{ kind: 'appeals', key: 'appeals', count, earliest }] : [];
  return [...statements, ...escalations, ...appeals];
}
export function collectTodo(source: TodoSources): TodoItem[] {
  if (!source.me) return [];
  const own = { ...source, me: source.me };
  const missing = missingOnboardingSteps(source.me, source.discord);
  const settings: TodoItem[] = missing.length > 0 && !isOnboardingDismissed(source.onboardingDismissed, source.me.id, missing, source.now)
    ? [{ kind: 'onboarding', key: 'onboarding', missing }] : [];
  return [...settings, ...recordTodos(own)];
}
export function todoRank(item: TodoItem): number {
  return item.kind === 'statement' && item.urgent ? TODO_RANKS['urgent-statement'] : TODO_RANKS[item.kind];
}
function timeOrLast(value: string | null): number {
  const parsed = value === null ? Number.NaN : parseTimestamp(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}
function todoTime(item: TodoItem): number {
  if (item.kind === 'statement') return timeOrLast(item.record.deadline_at);
  if (item.kind === 'escalation') return timeOrLast(item.record.created_at);
  return Number.POSITIVE_INFINITY;
}
export function sortTodo(items: readonly TodoItem[]): TodoItem[] {
  return [...items].sort((a, b) => {
    const rank = todoRank(a) - todoRank(b);
    if (rank) return rank;
    const first = todoTime(a); const second = todoTime(b);
    if (first !== second) return first - second;
    return a.key.localeCompare(b.key);
  });
}
export function buildTodo(source: TodoSources): TodoItem[] { return sortTodo(collectTodo(source)); }
export function todoBadgeCount(items: readonly TodoItem[]): number {
  return items.reduce((n, item) => n + (item.kind === 'onboarding' ? 0 : item.kind === 'appeals' ? item.count : 1), 0);
}
export function meNeedsAttention(items: readonly TodoItem[]): boolean {
  return items.some((item) => item.kind === 'appeals' || item.kind === 'escalation');
}
