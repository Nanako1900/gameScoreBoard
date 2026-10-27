import { useEffect, useRef } from 'react';
import { VISIBLE_REFRESH_MIN_MS } from './constants';
import { shouldRefreshOnVisible } from './refreshPolicy';

/**
 * Calls `onVisible` when the tab becomes visible again and the last call (or
 * the mount) is more than `minIntervalMs` ago — a quick tab switch refetches nothing.
 */
export function useVisibleRefresh(
  onVisible: () => void,
  minIntervalMs: number = VISIBLE_REFRESH_MIN_MS,
): void {
  const onVisibleRef = useRef(onVisible);
  useEffect(() => {
    onVisibleRef.current = onVisible;
  }, [onVisible]);

  useEffect(() => {
    let last = Date.now();
    const handle = (): void => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (!shouldRefreshOnVisible(last, now, minIntervalMs)) return;
      last = now;
      onVisibleRef.current();
    };
    document.addEventListener('visibilitychange', handle);
    return () => document.removeEventListener('visibilitychange', handle);
  }, [minIntervalMs]);
}
