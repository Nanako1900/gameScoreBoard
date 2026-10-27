import { MAX_INVITES } from '@shared/attendance';
import { BOARD_SLOT_MIN_LEAD_MS, isSynthesizedTitle } from '@shared/quickTime';
import type { SessionDetail } from '../types';
import { AGAIN_STEP_MS } from './constants';
import { parseTimestamp } from './time';

export interface AgainPrefill {
  invite: string[];
  startsAt: string;
  game: string | null;
  capacity: number | null;
  durationMin: number | null;
  title?: string;
}

/** Repeat the public settings and roster; notes and attendance belong to the old session. */
export function againPrefill(detail: SessionDetail, meId: string, now: number): AgainPrefill {
  const original = parseTimestamp(detail.starts_at);
  const steps = Math.max(1, Math.floor((now + BOARD_SLOT_MIN_LEAD_MS - original) / AGAIN_STEP_MS) + 1);
  return {
    invite: detail.players.filter((p) => p.user.id !== meId && p.rsvp !== 'out').slice(0, MAX_INVITES).map((p) => p.user.id),
    startsAt: new Date(original + steps * AGAIN_STEP_MS).toISOString(),
    game: detail.game,
    capacity: detail.capacity,
    durationMin: detail.duration_min,
    ...(!isSynthesizedTitle(detail.title) ? { title: detail.title } : {}),
  };
}
