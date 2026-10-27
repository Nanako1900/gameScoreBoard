// Pure helpers behind 约局详情's organizer actions and RSVP feedback (P0-6).
// No DOM, React or api.ts: tests/unit imports this under tsconfig.worker.json.
import { RSVP_LABEL, isSelfRsvp } from '@shared/attendance';
import type { Rsvp, SelfRsvp } from '@shared/attendance';
import type { QuickSlot } from '@shared/quickTime';
import type { SessionDetail, SessionItem } from '../types';
import { RESCHEDULE_DM_DELAY_MIN } from './constants';
import { parseTimestamp } from './time';

/** The answers a move puts back to 'invited' (worker/sessions.ts:463-467). */
const RESET_BY_MOVE: readonly Rsvp[] = ['going', 'maybe', 'out'];

/** People who must answer again after a move: rsvp going/maybe/out, organizer excluded. */
export function rescheduleImpact(session: SessionDetail): number {
  return session.players.filter(
    (p) => p.user.id !== session.organizer.id && RESET_BY_MOVE.includes(p.rsvp),
  ).length;
}

/**
 * What a move does, in spec §3.5's words. Only facts: the re-answer line needs
 * someone who answered, the DM line needs someone besides the organizer.
 */
export function rescheduleConsequences(session: SessionDetail): string[] {
  const impact = rescheduleImpact(session);
  const others = session.players.filter((p) => p.user.id !== session.organizer.id).length;
  return [
    ...(impact > 0 ? [`已回复的 ${impact} 人要重新确认（说过不来的也要重新回答）`] : []),
    ...(others > 0
      ? [
          `局里每个人约 ${RESCHEDULE_DM_DELAY_MIN} 分钟后收到一条「约局改时间了」私信，连改几次也只发一条`,
        ]
      : []),
    '开局提醒和点名提醒会跟着改',
  ];
}

/** The quick slots minus the session's own time: moving to the same moment is no move. */
export function rescheduleSlots(slots: readonly QuickSlot[], startsAt: string): QuickSlot[] {
  const current = parseTimestamp(startsAt);
  return slots.filter((s) => s.at !== current);
}

export type CustomTime = { ok: true; iso: string } | { ok: false; error: string };

/**
 * A `datetime-local` value carries no zone; Date.parse reads it as local, which
 * is what the organizer meant. Sent as UTC, as SessionFormDialog does.
 */
export function parseCustomTime(value: string): CustomTime {
  if (value.trim() === '') return { ok: false, error: '选一个时间' };
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return { ok: false, error: '时间格式不对' };
  return { ok: true, iso: new Date(ms).toISOString() };
}

/** Every seat is taken: only `going` counts (worker/sessions.ts:530-540). */
export function isFull(session: SessionItem): boolean {
  return session.capacity !== null && session.counts.going >= session.capacity;
}

/** 来 is closed to this viewer: full, and they do not already hold a seat. */
export function goingClosed(session: SessionItem): boolean {
  return isFull(session) && session.my_rsvp !== 'going';
}

/** 「来 5/5 满了，可以先报待定。」 while 来 is closed to the viewer, else null. */
export function fullNotice(session: SessionItem): string | null {
  if (!goingClosed(session) || session.capacity === null) return null;
  return `来 ${session.counts.going}/${session.capacity} 满了，可以先报待定。`;
}

export interface RsvpFeedback {
  message: string;
  /** Only a change between two of the viewer's own answers: nobody can set themself back to invited. */
  undoable: boolean;
}

/** Toast copy after an answer (spec §4.1 ④); null when nothing changed. */
export function rsvpFeedback(prev: Rsvp | null, next: SelfRsvp): RsvpFeedback | null {
  if (prev === next) return null;
  const undoable = prev !== null && isSelfRsvp(prev);
  if (next === 'out') return { message: '收到，提前说了点名就不会记你 👍', undoable };
  if (!undoable) return { message: `已回复：${RSVP_LABEL[next]}。开局前想改随时改。`, undoable };
  return { message: `已改成：${RSVP_LABEL[next]}`, undoable };
}
