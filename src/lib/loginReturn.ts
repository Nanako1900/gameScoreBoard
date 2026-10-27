// sessionStorage side of edg.return (P1 contract 4.11). The login is a
// top-level navigation away and back in the same tab, which sessionStorage
// survives; another tab never sees it. Storage may be missing or blocked
// (private mode): every access is guarded and nothing here throws.

import { currentPath } from './router';
import { LOGIN_RETURN_KEY, parseLoginReturn, serializeLoginReturn } from './loginReturnShape';
import type { LoginReturn } from './loginReturnShape';

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null; // merely touching storage throws when the browser blocks it
  }
}

/**
 * Remembers where to come back to (default: this page) before the jump to the
 * login page. A page not worth coming back to — the lobby, an unknown path —
 * clears an older value instead. False only when storage is unusable.
 */
export function saveLoginReturn(returnTo: string = currentPath()): boolean {
  const store = storage();
  if (!store) return false;
  const now = Date.now();
  const checked = parseLoginReturn(serializeLoginReturn(returnTo, now), now);
  try {
    if (checked === null) {
      store.removeItem(LOGIN_RETURN_KEY);
    } else {
      store.setItem(LOGIN_RETURN_KEY, serializeLoginReturn(returnTo, now));
    }
    return true;
  } catch {
    return false; // full or blocked: the login still works, it just lands on the lobby
  }
}

/** Reads, validates and always removes: a saved return is used at most once. */
export function takeLoginReturn(now: number = Date.now()): LoginReturn | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(LOGIN_RETURN_KEY);
    if (raw === null) return null;
    store.removeItem(LOGIN_RETURN_KEY);
    return parseLoginReturn(raw, now);
  } catch {
    return null;
  }
}

/** Logging out: whoever signs in next on this tab must not be sent to someone else's page. */
export function clearLoginReturn(): void {
  try {
    storage()?.removeItem(LOGIN_RETURN_KEY);
  } catch {
    /* nothing stored, or nothing reachable — either way nothing to clear */
  }
}
