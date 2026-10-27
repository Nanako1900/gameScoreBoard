import { TODO_SEEN_MAX } from './constants';
export const SEEN_CANCELLED_KEY = 'edg.todo.seen-cancelled';
export const UNBOUND_DISMISSED_KEY = 'edg.todo.unbound-dismissed';
export function readSeenCancelled(): number[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SEEN_CANCELLED_KEY) ?? '[]');
    return Array.isArray(value) && value.every((id) => Number.isSafeInteger(id) && id > 0)
      ? [...new Set<number>(value)].slice(-TODO_SEEN_MAX) : [];
  } catch { return []; }
}
export function markCancelledSeen(id: number): void {
  try { localStorage.setItem(SEEN_CANCELLED_KEY, JSON.stringify([...new Set([...readSeenCancelled(), id])].slice(-TODO_SEEN_MAX))); } catch { /* Storage can be blocked. */ }
}
export function readUnboundDismissed(): boolean {
  try { return JSON.parse(localStorage.getItem(UNBOUND_DISMISSED_KEY) ?? 'false') === true; } catch { return false; }
}
export function dismissUnbound(): void {
  try { localStorage.setItem(UNBOUND_DISMISSED_KEY, 'true'); } catch { /* Storage can be blocked. */ }
}
export function clearTodoMarks(): void {
  try { localStorage.removeItem(SEEN_CANCELLED_KEY); } catch { /* Storage can be blocked. */ }
  try { localStorage.removeItem(UNBOUND_DISMISSED_KEY); } catch { /* Storage can be blocked. */ }
}
