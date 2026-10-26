import { useId } from 'react';
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
}

export function RecordsFeed({
  records,
  title = '动态',
  onSelectUser,
  compact = false,
  emptyHint = '还没有任何记录。',
}: RecordsFeedProps): JSX.Element {
  const headingId = useId();
  const hasTitle = title.trim().length > 0;
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
          {records.map((r) => (
            <RecordRow key={r.id} record={r} onSelectUser={onSelectUser} />
          ))}
        </ul>
      )}
    </section>
  );
}

interface RecordRowProps {
  record: RecordItem;
  onSelectUser?: (id: string) => void;
}

function RecordRow({ record, onSelectUser }: RecordRowProps): JSX.Element {
  const def = VIOLATION_MAP[record.type];
  const emoji = def?.emoji ?? '•';
  const label = def?.label ?? record.type;
  const positive = record.delta > 0;
  const statusLabel = CASE_STATUS_LABEL[record.status];
  // Pre-verdict the delta is still 0 — show the pending range instead of a
  // misleading "0", so nobody reads an open case as a zero-point outcome.
  const undecided = record.status === 'awaiting_statement' || record.status === 'judging';
  const deltaText = undecided ? '?' : positive ? `+${record.delta}` : String(record.delta);

  return (
    <li className={`feed-row feed-row--${record.status}`}>
      <span className="feed-row__emoji" aria-hidden="true">
        {emoji}
      </span>

      <div className="feed-row__main">
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
      </div>

      <span
        className={`feed-row__delta tabular ${
          undecided
            ? 'feed-row__delta--pending'
            : positive
              ? 'feed-row__delta--up'
              : 'feed-row__delta--down'
        }${
          record.status === 'revoked' || record.status === 'withdrawn'
            ? ' feed-row__delta--muted'
            : ''
        }`}
      >
        {deltaText}
      </span>
    </li>
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
