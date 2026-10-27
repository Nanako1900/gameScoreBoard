import { useEffect } from 'react';
import { BASE_TITLE, tabTitle } from './tabTitle';

/** Keeps document.title at '(N) EDG 信誉分'; puts the bare title back on unmount. */
export function useTabTitle(count: number): void {
  useEffect(() => {
    document.title = tabTitle(count);
  }, [count]);
  useEffect(
    () => () => {
      document.title = BASE_TITLE;
    },
    [],
  );
}
