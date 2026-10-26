import './discord-link.css';

interface LinkMissingNoticeProps {
  message: string;
  onDismiss: () => void;
}

/** A link from Discord pointed at something that is not there (any more). */
export function LinkMissingNotice({ message, onDismiss }: LinkMissingNoticeProps): JSX.Element {
  return (
    <section className="dlink-notice dlink-notice--warn" role="status" aria-live="polite">
      <span className="dlink-notice__icon" aria-hidden="true">
        !
      </span>
      <p className="dlink-notice__text">{message}</p>
      <button type="button" className="dlink-notice__close" onClick={onDismiss} aria-label="关闭提示">
        ✕
      </button>
    </section>
  );
}
