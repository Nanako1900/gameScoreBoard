import type { SelfRsvp } from '@shared/attendance';
import { isSynthesizedTitle } from '@shared/quickTime';
import type { SessionItem, User } from '../types';
import { clockOn, formatTimeLeft, formatWhen, parseTimestamp } from '../lib/time';
import { sessionPhase } from '../lib/lobbySessions';
import { fullNotice, goingClosed, isFull } from '../lib/sessionActions';
import { sessionPath } from '../lib/routes';
import { Avatar } from './Avatar';
import { IconFull, IconLive } from './icons';
import { LoginLink } from './LoginLink';
import { RsvpControl } from './RsvpControl';
import './session-card.css';

interface SessionCardProps {
  session: SessionItem; me: User | null; now: number; boardTzOffsetHours?: number;
  handled?: boolean; busy?: boolean; onOpen: () => void; onAnswer?: (rsvp: SelfRsvp) => void;
}
function CardActions(props: SessionCardProps): JSX.Element | null {
  const { session: s, now, me, onAnswer } = props;
  const phase = sessionPhase(s, now);
  if (phase === 'live') return <p className="scard__state"><IconLive />{clockOn(parseTimestamp(s.starts_at), props.boardTzOffsetHours)} 开的
    <span>开局后不能改报名</span></p>;
  if (phase === 'cancelled') return <div className="scard__state"><span>已取消</span>{s.cancel_reason && <p>理由：{s.cancel_reason}</p>}</div>;
  if (phase === 'due' || phase === 'settled') return <p className="scard__state">{phase === 'due' ? '待结算' : '已结算'}</p>;
  if (s.organizer.id === me?.id) return <p className="scard__state">你组的局</p>;
  if (props.handled) return <p className="scard__state">↑ 在「要你处理」里</p>;
  if (!me) return <LoginLink className="scard__login" returnTo={sessionPath(s.id)} ariaLabel={`登录后报名 ${s.title}`}>登录后报名</LoginLink>;
  if (!onAnswer) return null;
  if (s.my_rsvp === 'going') return <div className="scard__answers"><span className="scard__chip">你：来</span>
    <button type="button" className="btn btn--ghost btn--sm" disabled={props.busy} onClick={() => onAnswer('out')}>改成不来</button></div>;
  const notice = fullNotice(s); const noteId = `session-card-full-${s.id}`;
  return <div className="scard__answers"><RsvpControl label={`报名 ${s.title}`} value={s.my_rsvp} busy={props.busy}
    onAnswer={onAnswer} goingClosed={goingClosed(s)} goingClosedNoteId={noteId} />
    {notice && <p id={noteId} className="scard__note">{notice}</p>}</div>;
}
function CardPreview({ session }: { session: SessionItem }): JSX.Element | null {
  if (!session.going_preview?.length) return null;
  return <span className="scard__preview">{session.going_preview.map((p) => <span key={p.id}>
    <Avatar name={p.username} src={p.avatar_url} size={20} />{p.username}</span>)}</span>;
}
export function SessionCard(props: SessionCardProps): JSX.Element {
  const { session: s, now, boardTzOffsetHours: offset } = props;
  return <li className={`scard scard--${sessionPhase(s, now)}`}>
    <button type="button" className="scard__main" onClick={props.onOpen}>
      <span className="scard__when tabular">{formatWhen(s.starts_at, now, offset)}{formatTimeLeft(s.starts_at, now) && ` · ${formatTimeLeft(s.starts_at, now)}`}</span>
      {!isSynthesizedTitle(s.title) && <span className="scard__title">{s.title}</span>}
      <span className="scard__meta">{s.organizer.username} 组局{s.game && <span>{s.game}</span>}
        <span>来 {s.counts.going}{s.capacity !== null && `/${s.capacity}`}</span>
        {isFull(s) && <span className="scard__badge"><IconFull />满员</span>}</span>
      <CardPreview session={s} />
    </button>
    <div className="scard__actions"><CardActions {...props} /></div>
  </li>;
}
