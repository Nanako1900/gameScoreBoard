// P1-2 test helpers for the session history. Not a test file (no .test.).

/** Macrotasks jsdom needs before a queued history traversal fires popstate (it takes two; one spare). */
const TRAVERSAL_TICKS = 3;

/** Let every history.back() / go(-n) already asked for land, with its popstate. */
export async function drainHistoryTraversals(): Promise<void> {
  for (let i = 0; i < TRAVERSAL_TICKS; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** The router's marks on the current entry, without idx (tests compare idx values, never assert them). */
export function overlayMarks(): { sheet: unknown; layer: unknown } {
  const state = (window.history.state ?? {}) as { sheet?: unknown; layer?: unknown };
  return { sheet: state.sheet, layer: state.layer };
}

/** history.state.idx, for comparing two moments of one test. */
export function entryIdx(): number {
  const idx = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof idx === 'number' ? idx : -1;
}

/**
 * P1-3: clicks on any <a href> stay on the page — jsdom cannot leave the
 * document. A bubbling listener on document runs after React's root listener,
 * so the link's own onClick (saveLoginReturn) still runs. Returns the undo.
 */
export function preventNavigation(): () => void {
  const stay = (event: MouseEvent): void => {
    if (event.target instanceof Element && event.target.closest('a[href]') !== null) {
      event.preventDefault();
    }
  };
  document.addEventListener('click', stay);
  return () => document.removeEventListener('click', stay);
}
