import type { RefObject } from 'react';
import { useInlineConfirm } from './useInlineConfirm';

export interface LeaveGuard {
  /** Pass as the Modal's onClose and to every 稍后再说/取消 button. dirty → shows the confirm; clean → leave(). While confirming, a second call is a no-op. */
  requestClose: () => void;
  confirmingLeave: boolean;
  /** 「继续写」: hide the confirm, focus back on the button that asked. */
  stay: () => void;
  /** 「先离开」: the draft stays on the device. */
  confirmLeave: () => void;
  /** Attach to the 稍后再说 / 取消 button, so stay() can put focus back on it. */
  triggerRef: RefObject<HTMLButtonElement>;
}

/**
 * Closing a form that holds a draft asks first, in place (ConfirmInline, not
 * window.confirm — spec §5 #4). Built on useInlineConfirm so the keyboard ends
 * up where it was when the user backs out.
 */
export function useLeaveGuard(dirty: boolean, leave: () => void): LeaveGuard {
  const { confirming, ask, dismiss, close, triggerRef } = useInlineConfirm<HTMLButtonElement>();

  const requestClose = (): void => {
    if (confirming) return;
    if (dirty) ask();
    else leave();
  };

  const confirmLeave = (): void => {
    close();
    leave();
  };

  return { requestClose, confirmingLeave: confirming, stay: dismiss, confirmLeave, triggerRef };
}
