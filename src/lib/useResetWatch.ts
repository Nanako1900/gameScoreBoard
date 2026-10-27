import { useEffect, useRef } from 'react';
import { COUNTDOWN_TICK_MS } from './constants';
import { resetCrossed } from './refreshPolicy';

/**
 * Calls `onCrossed` once per `nextResetAt` value, on the first minute tick after
 * the clock passes it (checked without re-rendering). The page then refetches
 * /api/config — which runs the weekly heal and returns next week's reset time.
 */
export function useResetWatch(
  nextResetAt: string | null,
  onCrossed: () => void,
  intervalMs: number = COUNTDOWN_TICK_MS,
): void {
  const onCrossedRef = useRef(onCrossed);
  const handled = useRef<string | null>(null);
  useEffect(() => {
    onCrossedRef.current = onCrossed;
  }, [onCrossed]);

  useEffect(() => {
    if (nextResetAt === null || !(intervalMs > 0)) return undefined;
    const check = (): void => {
      if (!resetCrossed(nextResetAt, Date.now(), handled.current)) return;
      handled.current = nextResetAt;
      onCrossedRef.current();
    };
    check();
    const id = window.setInterval(check, intervalMs);
    return () => window.clearInterval(id);
  }, [nextResetAt, intervalMs]);
}
