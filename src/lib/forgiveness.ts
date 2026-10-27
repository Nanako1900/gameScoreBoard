// What the weekly heal will do for a score (spec §5 #3, M7). At the board's
// Monday 00:00 every participant below MAX_SCORE gets +config.weeklyHeal,
// capped at MAX_SCORE (worker/db.ts weeklyHeal). Pure: the numbers always come
// from config and shared — never a literal 15 (tests run with weeklyHeal = 5).

import { MAX_SCORE } from '@shared/scoring';
import type { Config } from '../types';
import { RESET_PENDING_LABEL, formatTimeLeft, parseTimestamp } from './time';

export type HealPreview =
  | { kind: 'full' } // 已经是满分
  | { kind: 'healing' } // now ≥ nextResetAt: waiting for config to be fetched again
  | { kind: 'heal'; heal: number; projected: number; timeLeft: string }; // timeLeft = formatTimeLeft(nextResetAt, now), '' when unknown

/** A heal that is not a finite positive number heals nothing. */
function healAmount(weeklyHeal: number): number {
  return Number.isFinite(weeklyHeal) ? Math.max(0, weeklyHeal) : 0;
}

/** min(MAX_SCORE, score + weeklyHeal); a score already at MAX_SCORE stays. */
export function projectedAfterHeal(score: number, weeklyHeal: number): number {
  return Math.min(MAX_SCORE, score + healAmount(weeklyHeal));
}

export function healPreview(
  score: number,
  config: Pick<Config, 'weeklyHeal' | 'nextResetAt'>,
  now: number,
): HealPreview {
  if (score >= MAX_SCORE) return { kind: 'full' };
  const resetAt = parseTimestamp(config.nextResetAt);
  if (!Number.isNaN(resetAt) && now >= resetAt) return { kind: 'healing' };
  const heal = healAmount(config.weeklyHeal);
  return {
    kind: 'heal',
    heal,
    projected: projectedAfterHeal(score, heal),
    timeLeft: Number.isNaN(resetAt) ? '' : formatTimeLeft(config.nextResetAt, now),
  };
}

/** The one line MyScoreLine and the player's own page show. */
export function healPreviewText(preview: HealPreview): string {
  switch (preview.kind) {
    case 'full':
      return '已经是满分，回血不用等。';
    case 'healing':
      return RESET_PENDING_LABEL; // the Header's own word for the same wait (P0-3)
    case 'heal': {
      const base = `周一 0 点回血 +${preview.heal} → 预计 ${preview.projected}`;
      return preview.timeLeft ? `${base} · ${preview.timeLeft}` : base;
    }
  }
}
