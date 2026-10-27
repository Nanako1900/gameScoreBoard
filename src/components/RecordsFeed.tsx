import { useEffect, useId, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { CASE_STATUS_LABEL, VIOLATION_MAP } from '@shared/scoring';
import type { RecordItem } from '../types';
import { relativeTime } from '../lib/time';
import { Avatar } from './Avatar';
import './records-feed.css';

interface RecordsFeedProps {
  records: RecordItem[];
  title?: string;
  onSelectUser?: (id: string) => void;
  compact?: boolean;
  emptyHint?: string;
  /** Show only the first N rows, then a 看更多 button that reveals the rest of what is loaded. */
  previewCount?: number;
}

interface FeedPreview {
  shown: RecordItem[];
  /** True while rows are held back: render 看更多. */
  limited: boolean;
  expand: () => void;
  /** The ref for row `index`: only the first row 看更多 revealed gets one. */
  refFor: (index: number) => RefObject<HTMLLIElement> | undefined;
}

/** The first `previewCount` rows until 看更多 is pressed; then all of them. */
function useFeedPreview(records: RecordItem[], previewCount: number | undefined): FeedPreview {
  const [expanded, setExpanded] = useState(false);
  const firstRevealed = useRef<HTMLLIElement>(null);
  const limited = !expanded && previewCount !== undefined && records.length > previewCount;

  // 看更多 unmounts once pressed: hand focus to the first row it revealed, so
  // keyboard and screen-reader users carry on reading instead of landing on <body>.
  useEffect(() => {
    if (expanded) {
      firstRevealed.current?.focus();
    }
  }, [expanded]);

  return {
    shown: limited ? records.slice(0, previewCount) : records,
    limited,
    expand: () => setExpanded(true),
    refFor: (index) => (expanded && index === previewCount ? firstRevealed : undefined),
  };
}

export function RecordsFeed({
  records,
  title = '动态',
  onSelectUser,
  compact = false,
  emptyHint = '还没有任何记录。',
  previewCount,
}: RecordsFeedProps): JSX.Element {
  const headingId = useId();
  const hasTitle = title.trim().length > 0;
  const { shown, limited, expand, refFor } = useFeedPreview(records, previewCount);
  return (
    <section
      className={`feed panel${compact ? ' feed--compact' : ''}`}
      aria-labelledby={hasTitle ? headingId : undefined}
      aria-label={hasTitle ? undefined : '记录'}
    >
      {hasTitle && (
        <header className="feed__head">
          <h2 id={headingId} className="feed__title">
            {title}
          </h2>
        </header>
      )}

      {records.length === 0 ? (
        <p className="feed__empty">{emptyHint}</p>
      ) : (
        <ul className="feed__list">
          {shown.map((r, i) => (
            <RecordRow key={r.id} record={r} onSelectUser={onSelectUser} rowRef={refFor(i)} />
          ))}
        </ul>
      )}

      {limited && (
        <button type="button" className="btn btn--ghost btn--sm feed__more" onClick={expand}>
          看更多
        </button>
      )}
    </section>
  );
}

interface RecordRowProps {
  record: RecordItem;
  onSelectUser?: (id: string) => void;
  /** Set on the first row 看更多 revealed: it takes focus (and so needs tabIndex -1). */
  rowRef?: RefObject<HTMLLIElement>;
}

function RecordRow({ record, onSelectUser, rowRef }: RecordRowProps): JSX.Element {
  const emoji = VIOLATION_MAP[record.type]?.emoji ?? '•';
  return (
    <li
      ref={rowRef}
      tabIndex={rowRef ? -1 : undefined}
      className={`feed-row feed-row--${record.status}`}
    >
      <span className="feed-row__emoji" aria-hidden="true">
        {emoji}
      </span>

      <div className="feed-row__main">
        <RecordLine record={record} onSelectUser={onSelectUser} />
        <RecordMeta record={record} />
      </div>

      <RecordDelta record={record} />
    </li>
  );
}

function RecordLine({ record, onSelectUser }: Omit<RecordRowProps, 'rowRef'>): JSX.Element {
  const label = VIOLATION_MAP[record.type]?.label ?? record.type;
  const statusLabel = CASE_STATUS_LABEL[record.status];
  return (
    <p className="feed-row__line">
      <NameLink
        id={record.subject.id}
        name={record.subject.username}
        avatar={record.subject.avatar_url}
        onSelectUser={onSelectUser}
      />
      <span className="feed-row__action">{label}</span>
      {statusLabel && (
        <span className={`feed-row__status feed-row__status--${record.status}`}>
          {statusLabel}
        </span>
      )}
      {record.escalation_suggested && record.status === 'awaiting_statement' && (
        <span
          className="feed-row__status feed-row__status--escalate"
          title="AI 认为够得上团灭级，等裁判确认"
        >
          待确认升级
        </span>
      )}
    </p>
  );
}

function RecordMeta({ record }: { record: RecordItem }): JSX.Element {
  return (
    <p className="feed-row__meta">
      <span className="feed-row__reporter">裁判 {record.reporter.username}</span>
      <span className="feed-row__dot" aria-hidden="true">
        ·
      </span>
      <time dateTime={record.created_at}>{relativeTime(record.created_at)}</time>
      {/* Pre-verdict there is no headline yet, so show the AI's summary of the
          accusation instead — otherwise an open case reads as contentless. */}
      {record.verdict?.headline ? (
        <span className="feed-row__note">“{record.verdict.headline}”</span>
      ) : (
        record.claim_summary && (
          <span className="feed-row__note">“{record.claim_summary}”</span>
        )
      )}
    </p>
  );
}

function RecordDelta({ record }: { record: RecordItem }): JSX.Element {
  const positive = record.delta > 0;
  // Pre-verdict the delta is still 0 — show the pending range instead of a
  // misleading "0", so nobody reads an open case as a zero-point outcome.
  const undecided = record.status === 'awaiting_statement' || record.status === 'judging';
  const deltaText = undecided ? '?' : positive ? `+${record.delta}` : String(record.delta);
  const tone = undecided
    ? 'feed-row__delta--pending'
    : positive
      ? 'feed-row__delta--up'
      : 'feed-row__delta--down';
  const muted = record.status === 'revoked' || record.status === 'withdrawn';
  return (
    <span className={`feed-row__delta tabular ${tone}${muted ? ' feed-row__delta--muted' : ''}`}>
      {deltaText}
    </span>
  );
}

interface NameLinkProps {
  id: string;
  name: string;
  avatar: string | null;
  onSelectUser?: (id: string) => void;
}

function NameLink({ id, name, avatar, onSelectUser }: NameLinkProps): JSX.Element {
  const content = (
    <>
      <Avatar name={name} src={avatar} size={22} />
      <strong className="feed-row__name">{name}</strong>
    </>
  );
  if (!onSelectUser) {
    return <span className="feed-row__subject">{content}</span>;
  }
  return (
    <button
      type="button"
      className="feed-row__subject feed-row__subject--link"
      onClick={() => onSelectUser(id)}
    >
      {content}
    </button>
  );
}
