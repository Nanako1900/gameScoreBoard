import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
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

// Ref-counted background inert so stacked modals stay consistent: only the first
// open marks the app root inert, only the last close clears it.
let inertDepth = 0;

function setAppRootInert(on: boolean): void {
  const root = document.getElementById('root');
  if (!root) {
    return;
  }
  if (on) {
    inertDepth += 1;
    if (inertDepth === 1) {
      root.setAttribute('inert', '');
      root.setAttribute('aria-hidden', 'true');
    }
  } else {
    inertDepth = Math.max(0, inertDepth - 1);
    if (inertDepth === 0) {
      root.removeAttribute('inert');
      root.removeAttribute('aria-hidden');
    }
  }
}

/**
 * Accessible modal dialog: Escape to close, backdrop click to close, focus is
 * trapped inside the panel while open and restored on close, background scroll
 * is locked and the app root is made `inert` + `aria-hidden`. The dialog is
 * portaled to <body> so the app root can be inert without disabling the dialog.
 * Motion is transform/opacity only and disabled under prefers-reduced-motion.
 */
export function Modal({
  open,
  onClose,
  labelledBy,
  children,
  size = 'md',
}: ModalProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    restoreRef.current = document.activeElement as HTMLElement | null;
    const { body } = document;
    const prevOverflow = body.style.overflow;
    body.style.overflow = 'hidden';
    setAppRootInert(true);

    const panel = panelRef.current;
    const focusables = (): HTMLElement[] =>
      panel ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)) : [];

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panel) {
        return;
      }
      const items = focusables();
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
    };
    document.addEventListener('keydown', onKey);

    // Move focus into the dialog: an explicit target, else the first focusable,
    // else the panel container itself (which is tabIndex={-1}).
    const preferred = panel?.querySelector<HTMLElement>('[data-autofocus]');
    const target = preferred ?? focusables()[0] ?? panel;
    target?.focus();

    return () => {
      document.removeEventListener('keydown', onKey);
      body.style.overflow = prevOverflow;
      setAppRootInert(false);
      restoreRef.current?.focus?.();
    };
  }, [open, onClose]);

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
