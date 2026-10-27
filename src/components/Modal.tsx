import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  acquireRootInert,
  isTopLayer,
  type LayerId,
  lockBodyScroll,
  popLayer,
  pushLayer,
  releaseRootInert,
  unlockBodyScroll,
} from '../lib/modalStack';
import './modal.css';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusablesIn(panel: HTMLElement | null): HTMLElement[] {
  return panel ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)) : [];
}

/** Keeps Tab / Shift+Tab cycling inside `panel`. */
function trapTab(e: KeyboardEvent, panel: HTMLElement): void {
  const items = focusablesIn(panel);
  if (items.length === 0) {
    e.preventDefault();
    panel.focus();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (e.shiftKey) {
    if (active === first || !panel.contains(active)) {
      e.preventDefault();
      last.focus();
    }
  } else if (active === last || !panel.contains(active)) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * One listener per open layer; only the top one acts. Without the guard a
 * nested dialog's Escape closed its parent as well, and the parent's trap
 * pulled Tab focus back out of the child (M10).
 */
function layerKeyHandler(
  layerId: LayerId,
  panel: HTMLElement | null,
  onCloseRef: React.MutableRefObject<() => void>,
): (e: KeyboardEvent) => void {
  return (e) => {
    if (!isTopLayer(layerId)) {
      return;
    }
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (e.key === 'Tab' && panel) {
      trapTab(e, panel);
    }
  };
}

/** An explicit [data-autofocus] target, else the first focusable, else the panel (tabIndex={-1}). */
function focusInto(panel: HTMLElement | null): void {
  const preferred = panel?.querySelector<HTMLElement>('[data-autofocus]');
  const target = preferred ?? focusablesIn(panel)[0] ?? panel;
  target?.focus();
}

/**
 * Portaled layers (center / sheet / drawer): lock body scroll, make #root inert,
 * join the layer stack, trap Tab, close on Escape, restore focus on close.
 *
 * This effect MUST run exactly once per open. It moves focus into the dialog, and
 * re-running it mid-session yanks the caret out of whatever the user is typing in.
 *
 * `onClose` cannot be a dependency: callers pass inline arrows, so it is a new
 * function on every parent render — and a parent re-renders on every keystroke
 * in any field it owns. Depending on it meant the focus trap tore down and
 * rebuilt itself per character, stealing focus each time. It is read from a ref
 * at call time instead.
 */
function useLayer(
  active: boolean,
  panelRef: React.RefObject<HTMLDivElement>,
  onCloseRef: React.MutableRefObject<() => void>,
): void {
  useEffect(() => {
    if (!active) {
      return;
    }
    const restore = document.activeElement as HTMLElement | null;
    lockBodyScroll();
    acquireRootInert();
    const layerId = pushLayer();
    const onKey = layerKeyHandler(layerId, panelRef.current, onCloseRef);
    document.addEventListener('keydown', onKey);
    focusInto(panelRef.current);

    return () => {
      document.removeEventListener('keydown', onKey);
      popLayer(layerId);
      unlockBodyScroll();
      releaseRootInert();
      restore?.focus?.();
    };
    // `active` only (it flips exactly when `open` does) — see the comment above.
  }, [active]);
}

/**
 * Accessible modal dialog: Escape to close, backdrop click to close, focus is
 * trapped inside the panel while open and restored on close, background scroll
 * is locked and the app root is made `inert` + `aria-hidden`. The dialog is
 * portaled to <body> so the app root can be inert without disabling the dialog.
 * Motion is transform/opacity only and disabled under prefers-reduced-motion.
 *
 * Open dialogs form a stack (src/lib/modalStack.ts): only the top one answers
 * Escape and Tab.
 */
export function Modal({
  open,
  onClose,
  labelledBy,
  children,
  size = 'md',
}: ModalProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useLayer(open, panelRef, onCloseRef);

  if (!open) {
    return null;
  }

  return createPortal(
    <div className="modal" onMouseDown={onClose}>
      <div
        ref={panelRef}
        className={`modal__panel panel modal__panel--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="modal__close"
          onClick={onClose}
          aria-label="关闭"
        >
          ✕
        </button>
        {children}
      </div>
    </div>,
    document.body,
  );
}
