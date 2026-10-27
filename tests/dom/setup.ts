// toHaveValue / toBeVisible etc.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { resetModalStackForTests } from '../../src/lib/modalStack';

afterEach(() => {
  // Runs after Testing Library's own cleanup has unmounted everything (hooks run in stack order).
  resetModalStackForTests();
  // P0-5: drafts live in storage — one test's draft must never restore in the next.
  window.localStorage.clear();
  window.sessionStorage.clear();
  // P1-1: resetRouterForTests();
});
