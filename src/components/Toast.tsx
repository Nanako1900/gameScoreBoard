import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TOAST_ACTION_MIN_MS, TOAST_DURATION_MS, TOAST_MAX_VISIBLE } from '../lib/constants';
import './toast.css';

export type ToastTone = 'info' | 'ok' | 'error';

export interface ToastAction {
  label: string;
  onAction: () => void;
}

export interface ToastOptions {
  message: string;
  /** Default 'info'. */
  tone?: ToastTone;
  /** e.g. { label: '撤销', … } */
  action?: ToastAction;
  /** Default TOAST_DURATION_MS; with an action at least TOAST_ACTION_MIN_MS. */
  durationMs?: number;
}

export interface ToastApi {
  /** Returns the toast id (-1 when nothing was shown). */
  show: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
}

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
  durationMs: number;
}

const NOOP_API: ToastApi = { show: () => -1, dismiss: () => undefined };
const ToastContext = createContext<ToastApi>(NOOP_API);

function durationOf({ durationMs, action }: ToastOptions): number {
  const requested =
    durationMs !== undefined && Number.isFinite(durationMs) && durationMs > 0 ? durationMs : TOAST_DURATION_MS;
  return action ? Math.max(requested, TOAST_ACTION_MIN_MS) : requested;
}

/**
 * Short feedback after an action, with an optional action button (撤销).
 *
 * The viewport is portaled to <body>, outside #root: an open Modal makes #root
 * inert + aria-hidden, and a toast raised from inside a dialog must still be
 * seen. It is a single, always-present role="status" region (never
 * role="alert" — errors stay inline next to what failed, and several tests rely
 * on there being exactly one alert).
 *
 * Known limits: while a center/sheet Modal is open its focus trap does not
 * include the toasts, so keyboard users cannot reach a toast's button, and a
 * screen reader that honours the dialog's aria-modal may not read the toast
 * either. Every toast action must therefore also be reachable elsewhere on the
 * page (spec §6.4, WCAG 2.2.1) — e.g. an RSVP can always be changed again — and
 * no toast may be the only place an error is reported inside a dialog.
 */
export function ToastProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [items, setItems] = useState<readonly ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number): void => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const show = useCallback((options: ToastOptions): number => {
    const message = options.message.trim();
    if (message.length === 0) return -1;
    const id = nextId.current;
    nextId.current = id + 1;
    const item: ToastItem = {
      id,
      message,
      tone: options.tone ?? 'info',
      action: options.action,
      durationMs: durationOf(options),
    };
    // Newest last (at the bottom); the oldest drops off past the limit.
    setItems((prev) => [...prev, item].slice(-TOAST_MAX_VISIBLE));
    return id;
  }, []);

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="toasts" role="status" aria-live="polite">
          {items.map((item) => (
            <ToastCard key={item.id} item={item} onDismiss={dismiss} />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

/** Outside a provider (components rendered alone in tests) this is a no-op: show() returns -1. */
export function useToast(): ToastApi {
  return useContext(ToastContext);
}

/** A setTimeout that stops while `paused` and resumes with the time that was left. */
function usePausableTimeout(paused: boolean, durationMs: number, onExpire: () => void): void {
  const remaining = useRef(durationMs);
  useEffect(() => {
    if (paused) return undefined;
    const startedAt = Date.now();
    const id = window.setTimeout(onExpire, remaining.current);
    return () => {
      window.clearTimeout(id);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt));
    };
  }, [paused, onExpire]);
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }): JSX.Element {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const close = useCallback((): void => onDismiss(item.id), [onDismiss, item.id]);
  // Nobody pointing at it or focused in it: only then does the clock run.
  usePausableTimeout(hovered || focused, item.durationMs, close);

  const action = item.action;
  return (
    <div
      className={`toast toast--${item.tone}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <p className="toast__msg">{item.message}</p>
      {action && (
        <button
          type="button"
          className="btn btn--ghost btn--sm toast__action"
          onClick={() => {
            close();
            action.onAction();
          }}
        >
          {action.label}
        </button>
      )}
      <button type="button" className="toast__close" aria-label="关闭通知" onClick={close}>
        ✕
      </button>
    </div>
  );
}
