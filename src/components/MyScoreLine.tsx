import type { Config, User } from '../types';
import { COUNTDOWN_TICK_MS } from '../lib/constants';
import { healPreview, healPreviewText } from '../lib/forgiveness';
import { useNow } from '../lib/useNow';
import './my-score-line.css';

interface MyScoreLineProps {
  /** Rendered only when me.is_participant. */
  me: User;
  variant?: 'line' | 'card';
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
export function MyScoreLine({ me, rank, config, onOpen, variant = 'line' }: MyScoreLineProps): JSX.Element | null {
  const now = useNow(COUNTDOWN_TICK_MS);
  // Only people on the board are healed (worker/db.ts weeklyHeal: is_participant = 1).
  if (!me.is_participant) return null;
  const standing = rank === null ? `${me.score} 分` : `${me.score} 分 · 第 ${rank} 名`;
  const preview = healPreview(me.score, config, now);
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
