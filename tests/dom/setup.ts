// toHaveValue / toBeVisible etc.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { resetModalStackForTests } from '../../src/lib/modalStack';
import { resetRouterForTests } from '../../src/lib/router';
import { drainHistoryTraversals } from './history';

// P1-1: jsdom does not implement scrolling; the router scrolls to the top on push.
window.scrollTo = () => {};

afterEach(async () => {
  // Runs after Testing Library's own cleanup has unmounted everything (hooks run in stack order).
  // P1-2: an overlay that closed on unmount went back one entry; let jsdom finish that first.
  await drainHistoryTraversals();
  resetModalStackForTests();
  // P1-1: subscribers, snapshot, overlay entries, queued navigations; then history.replaceState(null, '', '/').
  resetRouterForTests();
  // P0-5: drafts live in storage — one test's draft must never restore in the next. (Also clears edg.return, P1-3.)
  window.localStorage.clear();
  window.sessionStorage.clear();
  // P1-1: a test that stubbed a desktop viewport must not leave it behind.
  delete (window as { matchMedia?: unknown }).matchMedia;
});
