import { useId, type ReactNode } from 'react';
import type { PublicUser } from '../types';
import { competitionRanks } from '../lib/rank';
import { Avatar } from './Avatar';
import { ScoreGauge } from './ScoreGauge';
import { TierBadge } from './TierBadge';
import './leaderboard.css';

interface LeaderboardProps {
  title?: string;
  participants: PublicUser[];
  /** subject id -> net score change accumulated this week (from the records feed). */
  trends: Record<string, number>;
  /** subject id -> count of records involving them (from the records feed). */
  counts: Record<string, number>;
  onSelect: (id: string) => void;
  /** The viewer: their row is highlighted and is the only one with a TierBadge. */
  meId?: string | null;
  /** Rendered between .lb__head and the list (WeekHighlights in P0; BoardMini's head from P3). */
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

export function Leaderboard({
  participants,
  trends,
  counts,
  onSelect,
  meId = null,
  highlights,
  title = '信誉榜',
}: LeaderboardProps): JSX.Element {
  const headingId = useId();
  const ranks = competitionRanks(participants.map((p) => p.score));
  return (
    <section className="lb panel" aria-labelledby={headingId}>
      <header className="lb__head">
        <h2 id={headingId} className="lb__title">
          {title}
        </h2>
        <span className="lb__count">{participants.length} 位选手</span>
      </header>

      {highlights}

      {participants.length === 0 ? (
        <p className="lb__empty">还没有上榜选手，登录后成为选手即可上榜。</p>
      ) : (
        <ol className="lb__list">
          {participants.map((p, index) => (
            <li key={p.id}>
              <Row
                player={p}
                rank={ranks[index]}
                trend={trends[p.id] ?? 0}
                count={counts[p.id] ?? 0}
                isMe={meId !== null && p.id === meId}
                onSelect={onSelect}
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
