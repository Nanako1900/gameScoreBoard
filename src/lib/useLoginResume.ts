// P1-3: the second source of an entry target (P1 contract 4.9 / 4.11). Back
// from the login page, edg.return says which address to return to.
// It never resumes an action or writes on anyone's behalf.

import { useEffect, useRef, useState } from 'react';
import type { User } from '../types';
import { takeLoginReturn } from './loginReturn';
import { hasLegacyTarget } from './loginReturnShape';
import { currentPath, navigate, useLocation } from './router';
import { WELCOME_PATH } from './routes';

interface LoginResumeInput {
  /** Core data is in. */
  readonly ready: boolean;
  readonly me: User | null;
  /**
   * The welcome page goes first (spec §4.1 step 2) — the old links' gate.
   * Read inside the effect, not at render: the flag it reads is set by an
   * effect of the same commit.
   */
  readonly isBlocked: () => boolean;
  readonly ignoreWelcomeReturn?: boolean;
  /** The route an entry flag temporarily replaced; the login return keeps priority. */
  readonly fallbackReturn?: string;
  readonly entryLocation?: { pathname: string; search: string };
}

/** ?onboarding=1 is still in the address until App's onboarding effect has read it. */
function onboardingPending(search: string): boolean {
  return new URLSearchParams(search).get('onboarding') === '1';
}

export function useLoginResume({ ready, me, isBlocked, ignoreWelcomeReturn = false, fallbackReturn, entryLocation }: LoginResumeInput): void {
  const location = useLocation();
  // Read at the first render, before the entry effect strips ?case= / ?session=: such a link wins.
  const [superseded] = useState(() => hasLegacyTarget(entryLocation?.pathname ?? location.pathname, entryLocation?.search ?? location.search));
  const taken = useRef(false);
  const pending = onboardingPending(location.search);

  // Once per load, signed in, after the welcome page. A visitor never reads
  // or removes it (the TTL does); a signed-in load always removes it.
  useEffect(() => {
    if (!ready || me === null || pending || taken.current || isBlocked()) return;
    taken.current = true;
    const saved = takeLoginReturn();
    if (superseded) return;
    const path = saved === null || (ignoreWelcomeReturn && saved.path.split('?')[0] === WELCOME_PATH)
      ? fallbackReturn : saved.path;
    if (path !== undefined && path !== currentPath()) navigate(path);
  }, [ready, me, pending, isBlocked, superseded, ignoreWelcomeReturn, fallbackReturn]);

}
