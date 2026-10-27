import type { PublicUser, RecordItem } from '../types';
import { Leaderboard } from './Leaderboard';
import { WeekHighlights } from './WeekHighlights';
interface BoardMiniProps {
  participants: PublicUser[]; trends: Record<string, number>; counts: Record<string, number>; records: RecordItem[];
  nextResetAt: string; meId?: string | null; rows: number; onSelect: (id: string) => void;
}
export function BoardMini(props: BoardMiniProps): JSX.Element {
  return <Leaderboard participants={props.participants} trends={props.trends} counts={props.counts} meId={props.meId}
    onSelect={props.onSelect} limit={props.rows} moreTo="/board"
    highlights={<WeekHighlights records={props.records} nextResetAt={props.nextResetAt} onSelectUser={props.onSelect} />} />;
}
