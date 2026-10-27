import type { SessionItem } from '../types';
import { ShareActions } from './ShareActions';
import './created-card.css';
export function CreatedCard({ session, boardTzOffsetHours }: { session: SessionItem; boardTzOffsetHours?: number }): JSX.Element {
  return <div className="created"><p>约好了 🎮 把链接发到群里吧</p>
    <ShareActions session={session} boardTzOffsetHours={boardTzOffsetHours} /></div>;
}
