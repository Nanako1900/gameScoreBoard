import { MAX_OPEN_SESSIONS, MAX_SESSIONS_PER_DAY } from '@shared/attendance';
import type { SessionItem } from '../types';
import { SESSION_QUOTA_WINDOW_MS, QUOTA_HINT_AT } from './constants';
import { sessionPhase } from './lobbySessions';
import { parseTimestamp } from './time';

export type ConsoleState = 'before' | 'live' | 'due' | 'settled' | 'cancelled';
export function consoleState(session: SessionItem, now: number): ConsoleState {
  const phase = sessionPhase(session, now);
  return phase === 'upcoming' ? 'before' : phase;
}
export function rosterGap(session: SessionItem): { missing: number | null; pending: number } {
  return { missing: session.capacity === null ? null : Math.max(0, session.capacity - session.counts.going),
    pending: session.counts.invited };
}
export function gapLine(session: SessionItem): string | null {
  const { missing, pending } = rosterGap(session);
  if (missing === 0) return `${session.capacity}/${session.capacity} 到齐，就等开打 🎉`;
  const parts = [missing !== null ? `还差 ${missing} 人满员` : null, pending > 0 ? `${pending} 人还没回` : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}
export interface SessionQuota { openLeft: number; dayLeft: number }
export function sessionQuota(mine: readonly SessionItem[], meId: string, now: number): SessionQuota {
  const own = mine.filter((s) => s.organizer.id === meId);
  const open = own.filter((s) => consoleState(s, now) === 'before').length;
  const day = own.filter((s) => { const at = parseTimestamp(s.created_at); return at >= now - SESSION_QUOTA_WINDOW_MS && at <= now; }).length;
  return { openLeft: Math.max(0, MAX_OPEN_SESSIONS - open), dayLeft: Math.max(0, MAX_SESSIONS_PER_DAY - day) };
}
export function quotaHint(quota: SessionQuota): string | null {
  if (Math.min(quota.openLeft, quota.dayLeft) > QUOTA_HINT_AT) return null;
  if (quota.openLeft <= quota.dayLeft) return quota.openLeft === 0
    ? `同时最多 ${MAX_OPEN_SESSIONS} 个还没开的局，你已经满了`
    : `你还能再开 ${quota.openLeft} 个局（同时最多 ${MAX_OPEN_SESSIONS} 个还没开的）`;
  return quota.dayLeft === 0 ? `24 小时内最多发起 ${MAX_SESSIONS_PER_DAY} 个，你已经满了` : `24 小时内还能再发起 ${quota.dayLeft} 个`;
}
