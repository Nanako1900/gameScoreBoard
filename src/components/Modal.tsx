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
import { useHistoryLayer } from '../lib/useHistoryLayer';
import './modal.css';

export type ModalVariant = 'center' | 'sheet' | 'drawer' | 'page';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Default 'center' — exactly today's behaviour and markup. */
  variant?: ModalVariant;
  /** Default true. false: a backdrop press does nothing; Escape and ✕ still call onClose (the caller decides, e.g. shows a leave confirm). */
  dismissible?: boolean;
  /** Optional: rendered as <h2 id={labelledBy} className="modal__title"> inside .modal__bar. A caller that passes it must not render its own element with that id. */
  title?: React.ReactNode;
  /** P1-2: set → while open, the layer owns a history entry and the back button calls onClose. Ignored by variant="page". */
  historyKey?: string;
}

type LayerVariant = Exclude<ModalVariant, 'page'>;

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
 * The in-place page variant joins nothing: no portal, no inert, no trap, no
 * stack, no Escape. It only moves focus to the caller's heading (id={labelledBy},
 * tabIndex={-1}) on open, falling back to the section itself.
 */
function usePageFocus(
  active: boolean,
  labelledBy: string,
  sectionRef: React.RefObject<HTMLElement>,
): void {
  useEffect(() => {
    if (!active) {
      return;
    }
    const heading = document.getElementById(labelledBy);
    heading?.focus();
    if (document.activeElement !== heading) {
      sectionRef.current?.focus();
    }
    // `active` only, like useLayer: a re-render must not move focus again.
  }, [active]);
}

interface ModalBarProps {
  variant: LayerVariant;
  labelledBy: string;
  title: React.ReactNode | undefined;
  onClose: () => void;
}

/** Sticky top of the sheet / drawer / titled layouts: grabber, title and ✕ stay on screen. */
function ModalBar({ variant, labelledBy, title, onClose }: ModalBarProps): JSX.Element {
  return (
    <div className="modal__bar">
      {variant === 'sheet' && <span className="modal__grabber" aria-hidden="true" />}
      {title !== undefined && (
        <h2 id={labelledBy} className="modal__title">
          {title}
        </h2>
      )}
      <button type="button" className="modal__close" onClick={onClose} aria-label="关闭">
        ✕
      </button>
    </div>
  );
}

interface LayerBodyProps {
  variant: LayerVariant;
  labelledBy: string;
  title: React.ReactNode | undefined;
  onClose: () => void;
  children: React.ReactNode;
}

/** Every existing caller lands here: a center dialog that brings its own heading. */
function isLegacyLayout(variant: LayerVariant, title: React.ReactNode | undefined): boolean {
  return variant === 'center' && title === undefined;
}

/**
 * What goes inside the panel. A plain center dialog without `title` — every
 * existing caller — keeps today's markup byte for byte: an absolutely placed ✕,
 * then the children. Everything else gets the sticky bar and a body wrapper.
 */
function LayerBody({ variant, labelledBy, title, onClose, children }: LayerBodyProps): JSX.Element {
  if (isLegacyLayout(variant, title)) {
    return (
      <>
        <button type="button" className="modal__close" onClick={onClose} aria-label="关闭">
          ✕
        </button>
        {children}
      </>
    );
  }
  return (
    <>
      <ModalBar variant={variant} labelledBy={labelledBy} title={title} onClose={onClose} />
      <div className="modal__body">{children}</div>
    </>
  );
}

/** Backdrop and panel classes; the legacy center layout adds no modifier classes. */
function layerClasses(
  variant: LayerVariant,
  size: NonNullable<ModalProps['size']>,
  title: React.ReactNode | undefined,
): { backdrop: string; panel: string } {
  const panel = `modal__panel panel modal__panel--${size}`;
  if (isLegacyLayout(variant, title)) {
    return { backdrop: 'modal', panel };
  }
  return { backdrop: `modal modal--${variant}`, panel: `${panel} modal__panel--${variant}` };
}

interface LayerProps {
  panelRef: React.RefObject<HTMLDivElement>;
  variant: LayerVariant;
  size: NonNullable<ModalProps['size']>;
  labelledBy: string;
  title: React.ReactNode | undefined;
  dismissible: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

/** The portaled backdrop and dialog panel shared by center / sheet / drawer. */
function Layer({
  panelRef,
  variant,
  size,
  labelledBy,
  title,
  dismissible,
  onClose,
  children,
}: LayerProps): JSX.Element {
  const classes = layerClasses(variant, size, title);
  return createPortal(
    <div className={classes.backdrop} onMouseDown={dismissible ? onClose : undefined}>
      <div
        ref={panelRef}
        className={classes.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <LayerBody variant={variant} labelledBy={labelledBy} title={title} onClose={onClose}>
          {children}
        </LayerBody>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Accessible modal dialog: Escape to close, backdrop click to close, focus is
 * trapped inside the panel while open and restored on close, background scroll
 * is locked and the app root is made `inert` + `aria-hidden`. The dialog is
 * portaled to <body> so the app root can be inert without disabling the dialog.
 * Motion is transform/opacity only and disabled under prefers-reduced-motion.
 *
 * Open dialogs form a stack (src/lib/modalStack.ts): only the top one answers
 * Escape and Tab. `variant="page"` is not a layer at all — see usePageFocus.
 */
export function Modal({
  open,
  onClose,
  labelledBy,
  children,
  size = 'md',
  variant = 'center',
  dismissible = true,
  title,
  historyKey,
}: ModalProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const isPage = variant === 'page';
  useLayer(open && !isPage, panelRef, onCloseRef);
  usePageFocus(open && isPage, labelledBy, pageRef);
  useHistoryLayer(open && !isPage, historyKey, onCloseRef);

  if (!open) {
    return null;
  }
  if (variant === 'page') {
    return (
      <section ref={pageRef} className="modal-page" aria-labelledby={labelledBy} tabIndex={-1}>
        {children}
      </section>
    );
  }
  return (
    <Layer
      panelRef={panelRef}
      variant={variant}
      size={size}
      labelledBy={labelledBy}
      title={title}
      dismissible={dismissible}
      onClose={onClose}
    >
      {children}
    </Layer>
  );
}
