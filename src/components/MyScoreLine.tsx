import { MAX_SCORE } from '@shared/scoring';
import type { Config, User } from '../types';
import { COUNTDOWN_TICK_MS } from '../lib/constants';
import { healPreview, healPreviewText } from '../lib/forgiveness';
import { useNow } from '../lib/useNow';
import './my-score-line.css';

interface MyScoreLineProps {
  /** Legacy line/card variants render only for participants; overview also explains an unlisted account. */
  me: User;
  variant?: 'line' | 'card' | 'overview';
  /** A shared page clock, when the parent already owns one. */
  now?: number;
  /** competitionRanks over participants; null = not on the board. */
  rank: number | null;
  config: Config;
  /** P0: open PlayerDetail for me; P4: /me. */
  onOpen?: () => void;
}

/**
 * 「82 分 · 第 6 名」 and what Monday's heal does (spec §3.2, M7). Days come from
 * config.nextResetAt, the numbers from config.weeklyHeal and MAX_SCORE.
 * 本周变化 is P4-5's.
 */
export function MyScoreLine({ me, rank, config, onOpen, variant = 'line', now: providedNow }: MyScoreLineProps): JSX.Element | null {
  const clock = useNow(COUNTDOWN_TICK_MS);
  const now = providedNow ?? clock;
  // Only people on the board are healed (worker/db.ts weeklyHeal: is_participant = 1).
  if (!me.is_participant && variant !== 'overview') return null;
  const standing = rank === null ? `${me.score} 分` : `${me.score} 分 · 第 ${rank} 名`;
  const preview = healPreview(me.score, config, now);
  if (variant === 'overview') return (
    <section className="msl msl--overview panel" aria-label="我的分数">
      <div><h2>我的信誉分</h2>{me.is_participant && rank !== null && <p className="msl__rank">第 {rank} 名</p>}</div>
      {me.is_participant ? <>
        <p className="msl__number tabular">{me.score}<span> / {MAX_SCORE}</span></p>
        <p className="msl__heal">{healPreviewText(preview)}</p>
      </> : <p className="msl__unlisted">当前不上榜</p>}
      {onOpen && <button type="button" className="msl__open" onClick={onOpen}>
        {me.is_participant ? '我的分数与记录' : '我的记录'} <span aria-hidden="true">→</span>
      </button>}
    </section>
  );
  return (
    <section className={`msl panel${variant === 'card' ? ' msl--card' : ''}`} aria-label="我的分数">
      {onOpen ? (
        <button type="button" className="msl__standing" onClick={onOpen}>
          {standing}
          <span className="msl__chev" aria-hidden="true">
            ›
          </span>
        </button>
      ) : (
        <p className="msl__standing">{standing}</p>
      )}
      <p className={`msl__heal msl__heal--${preview.kind}`}>{healPreviewText(preview)}</p>
    </section>
  );
}
