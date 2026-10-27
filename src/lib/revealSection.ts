// DOM helper for in-page jumps (P0: 30 秒看懂 → #rules). P3 replaces the jump
// with a route; not unit-tested (needs the DOM) — covered by tests/dom/board.test.tsx.

/**
 * After the next frame (React has committed the section open), scroll it into
 * view and move focus to its first button, so keyboard and screen-reader users
 * land where sighted users are looking. Respects reduced motion.
 */
export function revealSection(id: string): void {
  window.requestAnimationFrame(() => {
    const section = document.getElementById(id);
    if (!section) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    section.scrollIntoView?.({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    section.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  });
}
