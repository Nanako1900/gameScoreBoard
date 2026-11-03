export type CreationOutcome = 'succeeded' | 'failed' | 'conflict' | 'needs_review' | 'canceled' | 'unconfirmed';
export interface CreationTiming {
  event: 'community_room_creation';
  trace: string;
  outcome: CreationOutcome;
  queue_ms: number | null;
  create_ms: number | null;
  move_ms: number | null;
  to_created_ms: number | null;
  to_moved_ms: number | null;
  finalize_ms: number | null;
  total_ms: number | null;
}
export type CreationObserver = (timing: CreationTiming) => void | Promise<void>;

const outcomes = new Set<CreationOutcome>(['succeeded', 'failed', 'conflict', 'needs_review', 'canceled', 'unconfirmed']);
const milliseconds = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
export function creationDuration(start: number, end: number): number | null { return milliseconds(end - start); }

/** Emit only aggregate timings. Never spread domain objects into a log record;
 * the observer is diagnostic and cannot delay or fail the room executor. */
export function reportCreationTiming(observer: CreationObserver | undefined, input: unknown): void {
  if (!observer) return;
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const safe: CreationTiming = {
    event: 'community_room_creation',
    trace: typeof value.trace === 'string' && /^[a-f0-9]{12}$/.test(value.trace) ? value.trace : 'unknown',
    outcome: outcomes.has(value.outcome as CreationOutcome) ? value.outcome as CreationOutcome : 'failed',
    queue_ms: milliseconds(value.queue_ms), create_ms: milliseconds(value.create_ms), move_ms: milliseconds(value.move_ms),
    to_created_ms: milliseconds(value.to_created_ms), to_moved_ms: milliseconds(value.to_moved_ms),
    finalize_ms: milliseconds(value.finalize_ms), total_ms: milliseconds(value.total_ms),
  };
  try { const pending = observer(safe); if (pending) void Promise.resolve(pending).catch(() => undefined); }
  catch { /* Logging must not change an operation's outcome. */ }
}
