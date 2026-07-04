import { useId } from 'react';
import { VIOLATION_MAP } from '@shared/scoring';
import type { RecordItem, RecordStatus } from '../types';
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

const STATUS_LABEL: Record<RecordStatus, string> = {
  active: '',
  disputed: '申诉中',
  revoked: '已撤销',
};

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
  const deltaText = positive ? `+${record.delta}` : String(record.delta);
  const statusLabel = STATUS_LABEL[record.status];

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
        </p>
        <p className="feed-row__meta">
          <span className="feed-row__reporter">裁判 {record.reporter.username}</span>
          <span className="feed-row__dot" aria-hidden="true">
            ·
          </span>
          <time dateTime={record.created_at}>{relativeTime(record.created_at)}</time>
          {record.note && <span className="feed-row__note">“{record.note}”</span>}
        </p>
      </div>

      <span
        className={`feed-row__delta tabular ${
          positive ? 'feed-row__delta--up' : 'feed-row__delta--down'
        }${record.status === 'revoked' ? ' feed-row__delta--muted' : ''}`}
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
