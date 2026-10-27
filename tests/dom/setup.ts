// toHaveValue / toBeVisible etc.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { resetModalStackForTests } from '../../src/lib/modalStack';

afterEach(() => {
  // Runs after Testing Library's own cleanup has unmounted everything (hooks run in stack order).
  resetModalStackForTests();
  // P0-5: window.localStorage.clear(); window.sessionStorage.clear();
  // P1-1: resetRouterForTests();
});
