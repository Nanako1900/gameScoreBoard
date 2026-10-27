import type { RecordItem } from '../types';
import { violationLabel } from '../lib/recordView';
import { formatRemaining, isUrgent, parseTimestamp } from '../lib/time';
import './pending-banner.css';

interface PendingBannerProps {
  cases: RecordItem[];
  onOpen: (record: RecordItem) => void;
}

/**
 * The only nudge this app can give — there is no push channel, so a case
 * awaiting your statement has to be impossible to miss on the page itself.
 */
export function PendingBanner({ cases, onOpen }: PendingBannerProps): JSX.Element | null {
  if (cases.length === 0) return null;

  const sorted = [...cases].sort(
    (a, b) => parseTimestamp(a.deadline_at ?? '') - parseTimestamp(b.deadline_at ?? ''),
  );
  const next = sorted[0];
  const urgent = next.deadline_at !== null && isUrgent(next.deadline_at);

  return (
    <section
      className={`pending${urgent ? ' pending--urgent' : ''}`}
      role="status"
      aria-live="polite"
    >
      <span className="pending__icon" aria-hidden="true">
        ⚖️
      </span>
      <div className="pending__text">
        <p className="pending__title">
          你有 <strong className="tabular">{cases.length}</strong> 起案件等你说明情况
        </p>
        <p className="pending__sub">
          最早一起「{violationLabel(next.type)}」
          {next.deadline_at && ` · ${formatRemaining(next.deadline_at)}`}
          ，超时会按缺席裁决。
        </p>
      </div>
      <button type="button" className="btn btn--gold" onClick={() => onOpen(next)}>
        去说明
      </button>
    </section>
  );
}
