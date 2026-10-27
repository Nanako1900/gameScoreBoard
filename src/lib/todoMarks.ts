export const UNBOUND_DISMISSED_KEY = 'edg.todo.unbound-dismissed';
export function readUnboundDismissed(): boolean {
  try { return JSON.parse(localStorage.getItem(UNBOUND_DISMISSED_KEY) ?? 'false') === true; } catch { return false; }
}
export function dismissUnbound(): void {
  try { localStorage.setItem(UNBOUND_DISMISSED_KEY, 'true'); } catch { /* Storage can be blocked. */ }
}
export function clearTodoMarks(): void {
  try { localStorage.removeItem(UNBOUND_DISMISSED_KEY); } catch { /* Storage can be blocked. */ }
}
