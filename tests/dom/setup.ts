// toHaveValue / toBeVisible etc.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { resetModalStackForTests } from '../../src/lib/modalStack';
import { resetRouterForTests } from '../../src/lib/router';

// P1-1: jsdom does not implement scrolling; the router scrolls to the top on push.
window.scrollTo = () => {};

afterEach(() => {
  // Runs after Testing Library's own cleanup has unmounted everything (hooks run in stack order).
  resetModalStackForTests();
  // P1-1: subscribers and the cached location; then history.replaceState(null, '', '/').
  resetRouterForTests();
  // P0-5: drafts live in storage — one test's draft must never restore in the next.
  window.localStorage.clear();
  window.sessionStorage.clear();
  // P1-1: a test that stubbed a desktop viewport must not leave it behind.
  delete (window as { matchMedia?: unknown }).matchMedia;
});
