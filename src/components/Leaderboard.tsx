import type { PublicUser } from '../types';
import { Avatar } from './Avatar';
import { ScoreGauge } from './ScoreGauge';
import { TierBadge } from './TierBadge';
import './leaderboard.css';

interface LeaderboardProps {
  participants: PublicUser[];
  /** subject id -> net score change accumulated this week (from the records feed). */
  trends: Record<string, number>;
  /** subject id -> count of records involving them (from the records feed). */
  counts: Record<string, number>;
  onSelect: (id: string) => void;
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

export function Leaderboard({
  participants,
  trends,
  counts,
  onSelect,
}: LeaderboardProps): JSX.Element {
  return (
    <section className="lb panel" aria-labelledby="lb-heading">
      <header className="lb__head">
        <h2 id="lb-heading" className="lb__title">
          信誉榜
        </h2>
        <span className="lb__count">{participants.length} 位选手</span>
      </header>

      {participants.length === 0 ? (
        <p className="lb__empty">还没有上榜选手，登录后成为选手即可上榜。</p>
      ) : (
        <ol className="lb__list">
          {participants.map((p, index) => {
            const rank = index + 1;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className={`lb-row lb-row--rank${rank <= 3 ? rank : ''}`}
                  onClick={() => onSelect(p.id)}
                  aria-label={`第 ${rank} 名 ${p.username}，${p.score} 分`}
                >
                  <span className="lb-row__rank tabular">
                    {rank <= 3 ? <span className="lb-row__medal">{medal(rank)}</span> : rank}
                  </span>

                  <span className="lb-row__player">
                    <Avatar name={p.username} src={p.avatar_url} size={44} />
                    <span className="lb-row__id">
                      <span className="lb-row__name">{p.username}</span>
                      <span className="lb-row__badge">
                        <TierBadge score={p.score} size="sm" />
                      </span>
                    </span>
                  </span>

                  <span className="lb-row__trend">
                    <Trend value={trends[p.id] ?? 0} />
                    <span className="lb-row__records">{counts[p.id] ?? 0} 条记录</span>
                  </span>

                  <span className="lb-row__gauge">
                    <ScoreGauge score={p.score} size={62} strokeWidth={6} />
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function medal(rank: number): string {
  return rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉';
}
