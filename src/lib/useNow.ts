import { useEffect, useState } from 'react';

/**
 * Re-renders every `intervalMs`, the first tick aligned to the next multiple of
 * intervalMs, so every minute clock on the page flips together. Also ticks when
 * the tab becomes visible again: timers in a background tab are throttled, and
 * a countdown must not show a stale minute after the laptop wakes up.
 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!(intervalMs > 0)) return undefined;
    const tick = (): void => setNow(Date.now());
    let intervalId: number | undefined;
    const timeoutId = window.setTimeout(() => {
      tick();
      intervalId = window.setInterval(tick, intervalMs);
    }, intervalMs - (Date.now() % intervalMs));
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timeoutId);
      if (intervalId !== undefined) window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs]);
  return now;
}
