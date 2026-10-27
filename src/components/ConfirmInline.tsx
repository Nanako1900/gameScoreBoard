import { useEffect, useRef } from 'react';
import './confirm-inline.css';

export interface ConfirmInlineProps {
  /** 「取消这局？」 Also the group's aria-label. */
  question: string;
  /** Detail text or extra fields (e.g. P2's cancel reason), between the question and the buttons. */
  children?: React.ReactNode;
  confirmLabel: string; // 「确认取消」
  cancelLabel: string; // 「不取消了」
  onConfirm: () => void;
  onCancel: () => void;
  /** Which button takes focus on mount. Default 'cancel' (DiscordLinkCard's way); 'confirm' is AdminScoreForm's way. */
  focus?: 'cancel' | 'confirm';
  /** 'danger' → .btn--danger-outline (default); 'primary' → .btn--gold. */
  tone?: 'danger' | 'primary';
  busy?: boolean; // disables both buttons; the confirm shows busyLabel
  busyLabel?: string;
}

/** `{cond && <Field />}` yields false: that is no detail either, not an empty box. */
function hasContent(node: React.ReactNode): boolean {
  return node !== undefined && node !== null && typeof node !== 'boolean';
}

const CONFIRM_CLASS: Record<NonNullable<ConfirmInlineProps['tone']>, string> = {
  danger: 'btn btn--danger-outline',
  primary: 'btn btn--gold',
};

/**
 * An in-place confirm that takes the trigger button's spot — not a layer, so it
 * never touches the Modal stack and never listens for Escape (the surrounding
 * Modal owns that). DOM order is cancel → confirm, the same as the visual order.
 * Pair it with useInlineConfirm so backing out puts focus on the trigger again.
 */
export function ConfirmInline({
  question,
  children,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  focus = 'cancel',
  tone = 'danger',
  busy = false,
  busyLabel,
}: ConfirmInlineProps): JSX.Element {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Mount only: `children` may hold a field (P2's cancel reason), and re-focusing
  // on a later render would yank the caret out of it — the bug modal-focus.test.tsx pins.
  useEffect(() => {
    const target = focus === 'confirm' ? confirmRef.current : cancelRef.current;
    target?.focus();
  }, []);

  return (
    <div className="ci" role="group" aria-label={question}>
      <p className="ci__q">{question}</p>
      {hasContent(children) && <div className="ci__detail">{children}</div>}
      <div className="ci__actions">
        <button ref={cancelRef} type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </button>
        <button ref={confirmRef} type="button" className={CONFIRM_CLASS[tone]} onClick={onConfirm} disabled={busy}>
          {busy && busyLabel !== undefined ? busyLabel : confirmLabel}
        </button>
      </div>
    </div>
  );
}
