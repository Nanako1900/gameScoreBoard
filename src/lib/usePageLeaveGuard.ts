import { useCallback, useEffect, useRef, useState } from 'react';
import { registerNavigationGuard, type NavigationAttempt } from './router';

export interface PageLeaveGuardOptions {
  /** Synchronously discard ordinary unsaved fields/credentials before departure. */
  onLeave?: () => void;
}

export interface PageLeaveGuard {
  confirming: boolean;
  /** Cancel this departure and return focus to the control that was being used. */
  stay: () => void;
  /** Approve this departure once. The requested action should leave the page. */
  leave: () => void;
}

/**
 * Page-form counterpart of useLeaveGuard: the router owns every history write,
 * and callers render ConfirmInline with confirming/stay/leave. No form value is
 * copied into the router, this hook or storage; password fields stay in the DOM.
 */
export function usePageLeaveGuard(dirty: boolean, options: PageLeaveGuardOptions = {}): PageLeaveGuard {
  const [confirming, setConfirming] = useState(false);
  const attempt = useRef<NavigationAttempt | null>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const refocus = useRef(false);
  const leaving = useRef(false);
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const onLeave = useRef(options.onLeave); onLeave.current = options.onLeave;

  useEffect(() => {
    if (!dirty) {
      attempt.current?.cancel();
      attempt.current = null;
      leaving.current = false;
      setConfirming(false);
      return undefined;
    }
    let active = true;
    const dispose = registerNavigationGuard((next) => {
      if (!active) { next.cancel(); return; }
      if (!dirtyRef.current || leaving.current) { next.proceed(); return; }
      if (attempt.current !== null) return;
      restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      attempt.current = next;
      refocus.current = false;
      setConfirming(true);
    });
    const beforeUnload = (event: BeforeUnloadEvent): void => {
      if (!dirtyRef.current || leaving.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      active = false;
      dispose();
      attempt.current = null;
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [dirty]);

  useEffect(() => {
    if (confirming || !refocus.current) return;
    refocus.current = false;
    restoreFocus.current?.focus();
  }, [confirming]);

  const stay = useCallback((): void => {
    const pending = attempt.current;
    if (pending === null) return;
    attempt.current = null;
    pending.cancel();
    refocus.current = true;
    setConfirming(false);
  }, []);

  const leave = useCallback((): void => {
    const pending = attempt.current;
    if (pending === null) return;
    onLeave.current?.();
    attempt.current = null;
    leaving.current = true;
    setConfirming(false);
    pending.proceed();
  }, []);

  return { confirming, stay, leave };
}
