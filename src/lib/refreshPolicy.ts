// When the home page refetches, and what it says when a refetch fails. Pure.
import { VISIBLE_KEYS, type CoreKey } from './coreKeys';
import { parseTimestamp } from './time';

const MINUTE_MS = 60_000;

/** True when the last refresh is more than `minIntervalMs` old (or unknown). */
export function shouldRefreshOnVisible(
  lastRefreshAt: number,
  now: number,
  minIntervalMs: number,
): boolean {
  if (!Number.isFinite(lastRefreshAt)) return true;
  return now - lastRefreshAt > minIntervalMs;
}

/** True once `now` has reached `nextResetAt`; an unparsable value never counts as passed. */
function resetPassed(nextResetAt: string, now: number): boolean {
  const at = parseTimestamp(nextResetAt);
  return !Number.isNaN(at) && now >= at;
}

/** VISIBLE_KEYS, plus 'config' once now has passed config.nextResetAt (the weekly heal is due). */
export function visibleRefreshKeys(nextResetAt: string, now: number): readonly CoreKey[] {
  return resetPassed(nextResetAt, now) ? [...VISIBLE_KEYS, 'config'] : VISIBLE_KEYS;
}

/** True once per nextResetAt value that `now` has passed (caller remembers the last value it acted on). */
export function resetCrossed(nextResetAt: string, now: number, lastHandled: string | null): boolean {
  return nextResetAt !== lastHandled && resetPassed(nextResetAt, now);
}

/** The stale-data notice (contract §3.3): how old the data on screen is, and whether it is maintenance. */
export function staleMessage(sinceMs: number, now: number, maintenance: boolean): string {
  const minutes = Math.floor((now - sinceMs) / MINUTE_MS);
  const age = minutes >= 1 ? ` ${minutes} 分钟前的数据` : '刚才的数据';
  return maintenance ? `系统维护中，暂时只能看，显示的是${age}。` : `没刷新出来，显示的是${age}。`;
}
