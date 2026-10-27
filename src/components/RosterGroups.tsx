import { ATTENDANCE_MAP, type Rsvp } from '@shared/attendance';
import type { SessionDetail, SessionPlayer } from '../types';
import { Avatar } from './Avatar';
import { IconCheck } from './icons';
import './roster-groups.css';

const GROUPS: readonly { rsvp: Rsvp; label: string }[] = [
  { rsvp: 'going', label: '来' }, { rsvp: 'maybe', label: '待定' },
  { rsvp: 'invited', label: '还没回' }, { rsvp: 'out', label: '不来' },
];
function Attendance({ player }: { player: SessionPlayer }): JSX.Element | null {
  const attendance = player.attendance && ATTENDANCE_MAP[player.attendance];
  if (!attendance) return null;
  return <span className="roster__attendance">{attendance.emoji} {attendance.label}
    {player.attendance === 'late' && player.late_minutes !== null && ` ${player.late_minutes}′`}</span>;
}
function RosterPerson({ player: p, session }: { player: SessionPlayer; session: SessionDetail }): JSX.Element {
  return <li className={`roster__person roster__person--${p.rsvp}`}>
    <Avatar name={p.user.username} src={p.user.avatar_url} size={24} />
    <span className="roster__name">{p.user.username}</span>
    {p.user.id === session.organizer.id && <span>· 组局</span>}
    {!p.is_participant && <span>· 未上榜</span>}
    {p.rsvp === 'out' && <span className="roster__said"><IconCheck /><span>提前说了</span></span>}
    {session.status === 'settled' && <Attendance player={p} />}
  </li>;
}
export function RosterGroups({ session }: { session: SessionDetail }): JSX.Element {
  return <section className="roster" aria-labelledby="session-roster-title">
    <h3 id="session-roster-title">谁会来</h3>
    {GROUPS.map(({ rsvp, label }) => {
      const players = session.players.filter((p) => p.rsvp === rsvp);
      return players.length ? <div key={rsvp} className="roster__group">
        <p className="roster__label">{label} {players.length}{rsvp === 'going' && session.capacity !== null && `/${session.capacity}`}</p>
        <ul>{players.map((p) => <RosterPerson key={p.user.id} player={p} session={session} />)}</ul>
      </div> : null;
    })}
  </section>;
}
