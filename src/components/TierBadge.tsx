import { tierFor } from '@shared/scoring';
import type { Tier } from '@shared/scoring';
import './tier-badge.css';

interface TierBadgeProps {
  score?: number;
  tier?: Tier;
  size?: 'sm' | 'md';
  showName?: boolean;
}

/** Self-only tier label, with the same quiet visual treatment for every tier. */
export function TierBadge({
  score,
  tier,
  size = 'md',
  showName = true,
}: TierBadgeProps): JSX.Element {
  const resolved: Tier = tier ?? tierFor(score ?? 0);
  return (
    <span
      className={`tier-badge tier-badge--${size}`}
      title={resolved.blurb}
    >
      <span className="tier-badge__emoji" aria-hidden="true">
        {resolved.emoji}
      </span>
      {showName && <span className="tier-badge__name">{resolved.name}</span>}
    </span>
  );
}
