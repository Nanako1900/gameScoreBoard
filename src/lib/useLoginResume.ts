// P1-3: the second source of an entry target (P1 contract 4.9 / 4.11). Back
// from the login page, edg.return says which address to return to.
// It never resumes an action or writes on anyone's behalf.

import { useEffect, useRef, useState } from 'react';
import type { User } from '../types';
import { takeLoginReturn } from './loginReturn';
import { hasLegacyTarget } from './loginReturnShape';
import { currentPath, navigate, useLocation } from './router';

interface LoginResumeInput {
  /** Core data is in. */
  readonly ready: boolean;
  readonly me: User | null;
  /**
   * The first-run dialog goes first (spec §4.1 step 2) — the old links' gate.
   * Read inside the effect, not at render: the flag it reads is set by an
   * effect of the same commit.
   */
  readonly isBlocked: () => boolean;
}

/** ?onboarding=1 is still in the address until App's onboarding effect has read it. */
function onboardingPending(search: string): boolean {
  return new URLSearchParams(search).get('onboarding') === '1';
}

export function useLoginResume({ ready, me, isBlocked }: LoginResumeInput): void {
  const location = useLocation();
  // Read at the first render, before the entry effect strips ?case= / ?session=: such a link wins.
  const [superseded] = useState(() => hasLegacyTarget(location.pathname, location.search));
  const taken = useRef(false);
  const pending = onboardingPending(location.search);

  // Once per load, signed in, after the first-run dialog. A visitor never reads
  // or removes it (the TTL does); a signed-in load always removes it.
  useEffect(() => {
    if (!ready || me === null || pending || taken.current || isBlocked()) return;
    taken.current = true;
    const saved = takeLoginReturn();
    if (saved === null || superseded) return;
    if (saved.path !== currentPath()) navigate(saved.path);
  }, [ready, me, pending, isBlocked, superseded]);

}
