// Pure inbox rules. Network and browser state are supplied by the caller.
import { isFilingJudge } from '@shared/scoring';
import type { InvitedSessionItem, PendingCounts, RecordItem, SessionItem, User } from '../types';
import { LOBBY_CANCELLED_KEEP_MS, TODO_RANKS, TODO_SOON_MS } from './constants';
import { sessionPhase } from './lobbySessions';
import { isUrgent, parseTimestamp } from './time';

export type SessionTodoKind = 'rollcall' | 'moved' | 'invite' | 'soon' | 'cancelled';
export type TodoItem =
  | { kind: 'statement'; key: string; record: RecordItem; urgent: boolean }
  | { kind: SessionTodoKind; key: string; session: InvitedSessionItem }
  | { kind: 'escalation'; key: string; record: RecordItem }
  | { kind: 'appeals'; key: string; count: number; earliest: RecordItem | null }
  | { kind: 'dm-broken' | 'unbound'; key: string };
export type TodoKind = TodoItem['kind'];
export interface TodoSources {
  me: User | null; now: number; pending: PendingCounts | null;
  myPending: readonly RecordItem[] | null; invites: readonly InvitedSessionItem[] | null;
  feed: readonly RecordItem[] | null; mine: readonly SessionItem[] | null; appealed: readonly RecordItem[] | null;
  /** Only the caller's delivery flag is needed; unsupported and failed reads stay distinct. */
  discord: { dm_ok?: boolean } | null | undefined | 'error';
  seenCancelled: readonly number[]; unboundDismissed: boolean;
}
function forSession(kind: SessionTodoKind, session: InvitedSessionItem): TodoItem {
  return { kind, key: `${kind}:${session.id}`, session };
}
function sessionTodos(source: TodoSources & { me: User }): TodoItem[] {
  const { me, now } = source;
  const invites = (source.invites ?? []).filter((s) => s.my_rsvp === 'invited' && sessionPhase(s, now) === 'upcoming')
    .map((s) => forSession(s.invite_reason === 'moved' && s.prev_starts_at ? 'moved' : 'invite', s));
  const mine = (source.mine ?? []).flatMap((s): TodoItem[] => {
    const mine = s.organizer.id === me.id;
    if (mine && sessionPhase(s, now) === 'due') return [forSession('rollcall', s)];
    const until = parseTimestamp(s.starts_at) - now;
    if (!mine && s.my_rsvp === 'going' && s.status === 'open' && until > 0 && until <= TODO_SOON_MS) return [forSession('soon', s)];
    if (!mine && s.status === 'cancelled' && s.my_rsvp !== null && s.my_rsvp !== 'out'
      && now < parseTimestamp(s.starts_at) + LOBBY_CANCELLED_KEEP_MS && !source.seenCancelled.includes(s.id)) return [forSession('cancelled', s)];
    return [];
  });
  return [...invites, ...mine];
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
  const settings: TodoItem[] = source.discord === null && !source.unboundDismissed ? [{ kind: 'unbound', key: 'unbound' }]
    : source.discord && source.discord !== 'error' && source.discord.dm_ok === false ? [{ kind: 'dm-broken', key: 'dm-broken' }] : [];
  return [...recordTodos(own), ...sessionTodos(own), ...settings];
}
export function todoRank(item: TodoItem): number {
  return item.kind === 'statement' && item.urgent ? TODO_RANKS['urgent-statement'] : TODO_RANKS[item.kind];
}
function timeOrLast(value: string | null): number {
  const parsed = value === null ? Number.NaN : parseTimestamp(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}
function todoTime(item: TodoItem): number {
  if ('session' in item) return timeOrLast(item.session.starts_at);
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
  return items.reduce((n, item) => n + (item.kind === 'cancelled' || item.kind === 'unbound' ? 0 : item.kind === 'appeals' ? item.count : 1), 0);
}
export function handledSessionIds(items: readonly TodoItem[]): ReadonlySet<number> {
  return new Set(items.flatMap((item) => 'session' in item && ['moved', 'invite', 'soon'].includes(item.kind) ? [item.session.id] : []));
}
export function meNeedsAttention(items: readonly TodoItem[]): boolean {
  return items.some((item) => item.kind === 'appeals' || item.kind === 'escalation' || item.kind === 'dm-broken');
}
