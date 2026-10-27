import type { SessionItem, User } from '../types';
import { boardTzLabel } from '@shared/quickTime';
import { COUNTDOWN_TICK_MS } from '../lib/constants';
import { lobbyTimeline, mergeSessions, type TimelineGroup } from '../lib/lobbySessions';
import { useLobbySessions, type LobbySessions } from '../lib/useLobbySessions';
import { useNow } from '../lib/useNow';
import { useRsvpAnswer } from '../lib/useRsvpAnswer';
import { LoginLink } from './LoginLink';
import { Link } from './Link';
import { SESSION_HISTORY_PATH, sessionNewPath } from '../lib/routes';
import { SessionCard } from './SessionCard';
import { Skeleton } from './Skeleton';
import './sessions-panel.css';

interface SessionsPanelProps {
  me: User | null; onOpenSession: (id: number) => void; onCreate: () => void; refreshKey: number;
  hideCreate?: boolean;
  lobby?: LobbySessions; handledElsewhere?: ReadonlySet<number>; boardTzOffsetHours?: number;
}
interface TimelineProps extends SessionsPanelProps {
  groups: TimelineGroup[]; now: number; busyId: number | null;
  answer: (session: SessionItem, rsvp: import('@shared/attendance').SelfRsvp) => Promise<void>;
}
function Timeline({ groups, now, busyId, answer, ...props }: TimelineProps): JSX.Element {
  return <div className="sessions__timeline">{groups.map((group) => <div key={group.key}>
    <p className="sessions__group">{group.label}</p>
    <ul className="sessions__list">{group.sessions.map((s) => <SessionCard key={s.id} session={s} me={props.me}
      now={now} boardTzOffsetHours={props.boardTzOffsetHours} handled={props.handledElsewhere?.has(s.id)}
      busy={busyId === s.id} onOpen={() => props.onOpenSession(s.id)} onAnswer={(rsvp) => void answer(s, rsvp)} />)}</ul>
  </div>)}</div>;
}
function EmptyLobby({ me, onCreate, hideCreate }: Pick<SessionsPanelProps, 'me' | 'onCreate' | 'hideCreate'>): JSX.Element {
  return <div className="sessions__empty"><p>今晚还没人组局。第一个开黑的永远是英雄。</p>
    {!hideCreate && (me ? <button type="button" className="btn btn--gold btn--sm" onClick={onCreate}>组一局</button>
      : <LoginLink className="btn btn--gold btn--sm" returnTo={sessionNewPath()}>登录后组局</LoginLink>)}
  </div>;
}
/** One timeline, with an optional parent-owned data source for the home inbox. */
export function SessionsPanel(props: SessionsPanelProps): JSX.Element {
  const own = useLobbySessions({ enabled: props.lobby === undefined, me: props.me, refreshKey: props.refreshKey });
  const lobby = props.lobby ?? own;
  const now = useNow(COUNTDOWN_TICK_MS);
  const rsvp = useRsvpAnswer({ reload: lobby.reload });
  const groups = lobbyTimeline(mergeSessions(lobby.upcoming, lobby.mine), now, props.boardTzOffsetHours);
  return <section className="sessions panel" aria-labelledby="sessions-title">
    <header className="sessions__head">
      <h2 id="sessions-title" className="sessions__title"><span aria-hidden="true">📅</span> 约局</h2>
      <Link to={SESSION_HISTORY_PATH} className="sessions__more">历史 <span aria-hidden="true">›</span></Link>
      {props.me && !props.hideCreate && <button type="button" className="btn btn--gold btn--sm" onClick={props.onCreate}>组一局</button>}
    </header>
    {props.boardTzOffsetHours !== undefined && <p className="sessions__zone">时间均为{boardTzLabel(props.boardTzOffsetHours) === '北京时间' ? '' : ' '}{boardTzLabel(props.boardTzOffsetHours)}</p>}
    {rsvp.error && <p className="sessions__error" role="alert">{rsvp.error}</p>}
    {lobby.failed && <p className="sessions__failed" role="status">这块没加载出来，你的操作没丢。
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => void lobby.reload()}>重试</button></p>}
    {lobby.loading && groups.length === 0 ? <Skeleton label="约局加载中" lines={2} />
      : groups.length ? <Timeline {...props} groups={groups} now={now} busyId={rsvp.busyId} answer={rsvp.answer} />
      : !lobby.failed && <EmptyLobby me={props.me} onCreate={props.onCreate} hideCreate={props.hideCreate} />}
  </section>;
}
