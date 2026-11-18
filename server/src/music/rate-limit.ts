// Per-member in-memory limiter. One app process serves the API, so a process
// local map is enough; it is bounded so a flood of identities cannot grow it.
import { CommunityStoreError } from '../community/store';

const DEFAULT_MAX_ENTRIES = 5_000;
const RATE_LIMITED_MESSAGE = '操作太频繁，请稍后再试';

export interface RateLimiter {
  /** Throws 429 `rate_limited` when `id` acted within the window. */
  take(id: string): void;
}

export function createRateLimiter(
  windowMs: number,
  now: () => number = Date.now,
  maxEntries = DEFAULT_MAX_ENTRIES,
): RateLimiter {
  const last = new Map<string, number>();

  const prune = (at: number): void => {
    for (const [id, time] of last) if (at - time >= windowMs) last.delete(id);
    while (last.size >= maxEntries) {
      const oldest = last.keys().next().value;
      if (oldest === undefined) break;
      last.delete(oldest);
    }
  };

  return {
    take(id) {
      const at = now();
      const previous = last.get(id);
      if (previous !== undefined && at - previous < windowMs) {
        throw new CommunityStoreError(429, 'rate_limited', RATE_LIMITED_MESSAGE);
      }
      if (last.size >= maxEntries) prune(at);
      // Re-insert so Map order stays oldest-first for eviction.
      last.delete(id);
      last.set(id, at);
    },
  };
}
