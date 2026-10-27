// Pure scheduling rules shared by the lobby, cards and organizer views.
import { DEFAULT_DURATION_MIN } from '@shared/attendance';
import type { SessionItem } from '../types';
import { LOBBY_CANCELLED_KEEP_MS } from './constants';
import { dayStartOn, parseTimestamp, weekStartOn } from './time';

const MINUTE_MS = 60_000;
const WEEK_DAYS = 7;
const DAY_MS = 24 * 60 * MINUTE_MS;
export type SessionPhase = 'upcoming' | 'live' | 'due' | 'settled' | 'cancelled';
export type TimelineKey = 'live' | 'tonight' | 'week' | 'later' | 'cancelled';
export const TIMELINE_LABEL: Readonly<Record<TimelineKey, string>> = {
  live: '进行中', tonight: '今晚', week: '本周', later: '更晚', cancelled: '已取消',
};
export interface TimelineGroup { key: TimelineKey; label: string; sessions: SessionItem[] }

export function sessionEndsAt(session: SessionItem): number {
  return parseTimestamp(session.starts_at) + (session.duration_min ?? DEFAULT_DURATION_MIN) * MINUTE_MS;
}

export function sessionPhase(session: SessionItem, now: number): SessionPhase {
  if (session.status !== 'open') return session.status;
  if (now < parseTimestamp(session.starts_at)) return 'upcoming';
  return now < sessionEndsAt(session) ? 'live' : 'due';
}

export function mergeSessions(...lists: (readonly SessionItem[] | null)[]): SessionItem[] {
  const rows = new Map<number, SessionItem>();
  for (const list of lists) for (const session of list ?? []) {
    if (!rows.has(session.id)) rows.set(session.id, session);
  }
  return [...rows.values()];
}

export function patchSession<T extends SessionItem>(list: readonly T[], session: SessionItem): T[] {
  const found = list.some((s) => s.id === session.id);
  return found
    ? list.map((s) => s.id === session.id ? { ...s, ...session } : s)
    : [...list, { ...session } as T];
}

function nextMonday(now: number, offset?: number): number {
  const monday = weekStartOn(now, offset);
  if (offset !== undefined) return monday + WEEK_DAYS * DAY_MS;
  const local = new Date(monday);
  local.setDate(local.getDate() + WEEK_DAYS);
  return local.getTime();
}

function timelineKey(s: SessionItem, now: number, offset?: number): TimelineKey | null {
  const phase = sessionPhase(s, now);
  if (phase === 'live') return 'live';
  const start = parseTimestamp(s.starts_at);
  if (phase === 'cancelled') return now < start + LOBBY_CANCELLED_KEEP_MS ? 'cancelled' : null;
  if (phase !== 'upcoming') return null;
  if (dayStartOn(start, offset) === dayStartOn(now, offset)) return 'tonight';
  return start < nextMonday(now, offset) ? 'week' : 'later';
}

export function lobbyTimeline(sessions: readonly SessionItem[], now: number, offsetHours?: number): TimelineGroup[] {
  const keys = Object.keys(TIMELINE_LABEL) as TimelineKey[];
  return keys.flatMap((key) => {
    const rows = sessions.filter((s) => timelineKey(s, now, offsetHours) === key)
      .sort((a, b) => parseTimestamp(a.starts_at) - parseTimestamp(b.starts_at) || a.id - b.id);
    return rows.length ? [{ key, label: TIMELINE_LABEL[key], sessions: rows }] : [];
  });
}
