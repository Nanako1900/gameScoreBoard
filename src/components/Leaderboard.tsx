import { useId, type ReactNode } from 'react';
import type { PublicUser } from '../types';
import { competitionRanks } from '../lib/rank';
import { Avatar } from './Avatar';
import { ScoreGauge } from './ScoreGauge';
import { TierBadge } from './TierBadge';
import { Link } from './Link';
import './leaderboard.css';

interface LeaderboardProps {
  title?: string;
  limit?: number;
  moreTo?: string;
  participants: PublicUser[];
  /** subject id -> net score change accumulated this week (from the records feed). */
  trends: Record<string, number>;
  /** subject id -> count of records involving them (from the records feed). */
  counts: Record<string, number>;
  onSelect: (id: string) => void;
  /** The viewer: their row is highlighted and is the only one with a TierBadge. */
  meId?: string | null;
  /** Optional supporting content between the heading and rows for existing callers. */
  highlights?: ReactNode;
}

function Trend({ value }: { value: number }): JSX.Element {
  if (value === 0) {
    return <span className="lb-trend lb-trend--flat">±0</span>;
  }
  const up = value > 0;
  return (
    <span className={`lb-trend ${up ? 'lb-trend--up' : 'lb-trend--down'}`}>
      <span aria-hidden="true">{up ? '▲' : '▼'}</span>
      <span className="tabular">{up ? `+${value}` : value}</span>
    </span>
  );
}

interface RowProps {
  player: PublicUser;
  rank: number;
  trend: number;
  count: number;
  isMe: boolean;
  onSelect: (id: string) => void;
}

/**
 * One board row. No medals and no 段位 for anyone but the viewer (spec §6.2):
 * the score is public, the label is not ours to pin on someone. The number
 * sits outside the gauge so phones, which drop the gauge, still show it (H6).
 */
function Row({ player, rank, trend, count, isMe, onSelect }: RowProps): JSX.Element {
  return (
    <button
      type="button"
      className={`lb-row${isMe ? ' lb-row--me' : ''}`}
      onClick={() => onSelect(player.id)}
      aria-label={`第 ${rank} 名 ${player.username}，${player.score} 分`}
    >
      <span className="lb-row__rank tabular">{rank}</span>

      <span className="lb-row__player">
        <Avatar name={player.username} src={player.avatar_url} size={44} />
        <span className="lb-row__id">
          <span className="lb-row__name">{player.username}</span>
          {isMe && (
            <span className="lb-row__badge">
              <TierBadge score={player.score} size="sm" />
            </span>
          )}
        </span>
      </span>

      <span className="lb-row__trend">
        <Trend value={trend} />
        <span className="lb-row__records">{count} 条记录</span>
      </span>

      <span className="lb-row__score tabular">{player.score}</span>

      <span className="lb-row__gauge">
        <ScoreGauge score={player.score} size={62} strokeWidth={6} tone="neutral" />
      </span>
    </button>
  );
}

function BoardRows({ props, ranks }: { props: LeaderboardProps; ranks: number[] }): JSX.Element {
  const shown = props.limit === undefined ? props.participants : props.participants.slice(0, props.limit);
  const mine = props.participants.findIndex((p) => p.id === props.meId);
  const extra = mine >= shown.length && mine >= 0;
  const row = (p: PublicUser, index: number): JSX.Element => <li key={p.id}><Row player={p} rank={ranks[index]}
    trend={props.trends[p.id] ?? 0} count={props.counts[p.id] ?? 0} isMe={props.meId === p.id} onSelect={props.onSelect} /></li>;
  return <ol className="lb__list">{shown.map(row)}{extra && <><li className="lb__ellipsis" aria-hidden="true">…</li>
    {row(props.participants[mine], mine)}</>}</ol>;
}
export function Leaderboard(props: LeaderboardProps): JSX.Element {
  const headingId = useId();
  const ranks = competitionRanks(props.participants.map((p) => p.score));
  return <section className={`lb panel${props.limit !== undefined ? ' lb--mini' : ''}`} aria-labelledby={headingId}>
    <header className="lb__head"><h2 id={headingId} className="lb__title">{props.title ?? '信誉榜'}</h2>
      <span className="lb__count">{props.participants.length} 位选手</span>
      {props.moreTo && <Link className="lb__more" to={props.moreTo} aria-label="完整榜">完整榜 ›</Link>}
    </header>{props.highlights}
    {props.participants.length === 0 ? <p className="lb__empty">还没有上榜选手，登录后成为选手即可上榜。</p>
      : <BoardRows props={props} ranks={ranks} />}
  </section>;
}
