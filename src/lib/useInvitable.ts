import { useCallback, useEffect, useRef, useState } from 'react';
import { getInvitable } from '../api';
import type { InvitableUser } from '../types';

export type InvitableState =
  | { kind: 'off' } // enabled is false: nothing asked
  | { kind: 'loading' }
  | { kind: 'ready'; users: InvitableUser[] }
  | { kind: 'error' } // anything but 404: the entry stays, the sheet offers 重试
  | { kind: 'unsupported' }; // 404: this API has no /api/me/invitable

export interface Invitable {
  state: InvitableState;
  /** Ask again (the sheet's 重试). */
  reload: () => void;
}

async function loadInvitable(): Promise<InvitableState> {
  try {
    const users = await getInvitable();
    return users === undefined ? { kind: 'unsupported' } : { kind: 'ready', users };
  } catch {
    // The sheet says the list did not load and offers 重试; the reason is not the user's to act on.
    return { kind: 'error' };
  }
}

/**
 * P2-1: who 再叫几个人 can offer, from GET /api/me/invitable (P2-2). Asks once,
 * the first time `enabled` is true (an organizer or admin on an open session
 * that has not started); never for anyone else. `reload` asks again.
 */
export function useInvitable(enabled: boolean): Invitable {
  const [state, setState] = useState<InvitableState>({ kind: 'off' });
  const [attempt, setAttempt] = useState(0);
  const askedFor = useRef<number | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    // Once per attempt: not again when `enabled` flips back, nor on StrictMode's second run.
    if (!enabled || askedFor.current === attempt) return;
    askedFor.current = attempt;
    setState({ kind: 'loading' });
    void loadInvitable().then((next) => {
      if (mounted.current) setState(next);
    });
  }, [enabled, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, reload };
}
