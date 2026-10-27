// Test helper (not a test file): a desktop viewport for one test. Without it
// jsdom has no window.matchMedia, so the router lays routes out as pages.
// tests/dom/setup.ts deletes the stub after every test.

import { DESKTOP_MEDIA_QUERY } from '../../src/lib/constants';

function stubQuery(query: string): MediaQueryList {
  const list = {
    matches: query === DESKTOP_MEDIA_QUERY,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  };
  return list as unknown as MediaQueryList;
}

/** Only DESKTOP_MEDIA_QUERY matches; prefers-reduced-motion and the rest do not. */
export function useDesktopViewport(): void {
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: stubQuery });
}
