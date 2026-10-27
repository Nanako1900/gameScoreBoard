import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * State for a ConfirmInline that replaces its trigger button. The trigger
 * unmounts while the confirm shows, so "focus back on the trigger" has to wait
 * for the re-render that brings it back — the effect below does exactly that,
 * and only after `dismiss` (backing out), never after `close` (done).
 */
export function useInlineConfirm<T extends HTMLElement = HTMLButtonElement>(): {
  confirming: boolean;
  /** Show the confirm (the trigger unmounts). */
  ask: () => void;
  /** Back out: hide the confirm, then focus the trigger again after the re-render. */
  dismiss: () => void;
  /** Done (after a successful confirm): hide without moving focus. */
  close: () => void;
  triggerRef: React.RefObject<T>;
} {
  const [confirming, setConfirming] = useState(false);
  const triggerRef = useRef<T>(null);
  const refocusRef = useRef(false);

  useEffect(() => {
    if (confirming || !refocusRef.current) {
      return;
    }
    refocusRef.current = false;
    triggerRef.current?.focus();
  }, [confirming]);

  const ask = useCallback(() => {
    refocusRef.current = false;
    setConfirming(true);
  }, []);
  const dismiss = useCallback(() => {
    refocusRef.current = true;
    setConfirming(false);
  }, []);
  const close = useCallback(() => {
    refocusRef.current = false;
    setConfirming(false);
  }, []);

  return { confirming, ask, dismiss, close, triggerRef };
}
