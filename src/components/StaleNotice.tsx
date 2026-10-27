import './stale-notice.css';

interface StaleNoticeProps {
  message: string;
  onRetry: () => void;
}

/**
 * A refresh failed and the page still shows the older data. role="status", not
 * "alert": it is not an error the user caused, and tests expect at most one alert.
 */
export function StaleNotice({ message, onRetry }: StaleNoticeProps): JSX.Element {
  return (
    <section className="stale" role="status" aria-live="polite">
      <span className="stale__icon" aria-hidden="true">
        !
      </span>
      <p className="stale__msg">{message}</p>
      <button type="button" className="btn btn--ghost btn--sm stale__retry" onClick={onRetry}>
        重试
      </button>
    </section>
  );
}
