// ============================================================================
// EDG 信誉分 — 预约约局的出勤 → 罪名映射（单一真源）
// Pure module: NO Cloudflare / DOM / Node globals. Imported by BOTH the Worker
// and the React frontend.
//
// SECURITY: the Worker re-derives the ViolationType from (attendance, late_minutes)
// on every settle. It never trusts a `type` sent by the client — otherwise a
// tampered request could turn a 小迟到 into the -25 团灭级放鸽.
// ============================================================================

import type { ViolationType } from './scoring';

/** RSVP state for a scheduled session. */
export type Rsvp = 'going' | 'maybe' | 'out';

export const RSVPS: Rsvp[] = ['going', 'maybe', 'out'];

export function isRsvp(v: string): v is Rsvp {
  return (RSVPS as string[]).includes(v);
}

export const RSVP_LABEL: Record<Rsvp, string> = {
  going: '来',
  maybe: '待定',
  out: '不来',
};

/** What actually happened, filled in by the organizer at roll call. */
export type Attendance = 'on_time' | 'late' | 'no_show' | 'left_early' | 'excused';

export const ATTENDANCES: Attendance[] = [
  'on_time',
  'late',
  'no_show',
  'left_early',
  'excused',
];

export function isAttendance(v: string): v is Attendance {
  return (ATTENDANCES as string[]).includes(v);
}

export interface AttendanceDef {
  value: Attendance;
  label: string;
  emoji: string;
  /** Whether the organizer should also supply how many minutes late. */
  needsMinutes: boolean;
}

export const ATTENDANCE_DEFS: AttendanceDef[] = [
  { value: 'on_time', label: '准时', emoji: '✅', needsMinutes: false },
  { value: 'late', label: '迟到', emoji: '⏰', needsMinutes: true },
  { value: 'no_show', label: '没来', emoji: '🕊️', needsMinutes: false },
  { value: 'left_early', label: '中途退', emoji: '🚪', needsMinutes: false },
  { value: 'excused', label: '请假', emoji: '🙏', needsMinutes: false },
];

export const ATTENDANCE_MAP: Record<string, AttendanceDef> = Object.fromEntries(
  ATTENDANCE_DEFS.map((d) => [d.value, d]),
);

/** Late thresholds, mirroring the late_* violation descriptions. */
export const LATE_MINOR_MAX = 15; // < 15 min  → late_minor
export const LATE_MAJOR_MAX = 30; // 15..30    → late_major, > 30 → late_severe

/**
 * Map a roll-call outcome to a violation type. `null` = nothing to file
 * (请假 / 未点名).
 */
export function violationForAttendance(
  attendance: Attendance,
  lateMinutes: number | null,
): ViolationType | null {
  switch (attendance) {
    case 'on_time':
      return 'on_time_bonus';
    case 'excused':
      return null;
    case 'left_early':
      return 'mid_quit';
    case 'no_show':
      // Escalation to no_show_group is an explicit organizer decision, never automatic.
      return 'no_show';
    case 'late': {
      const m = Number.isFinite(lateMinutes) ? Number(lateMinutes) : 0;
      if (m < LATE_MINOR_MAX) return 'late_minor';
      if (m <= LATE_MAJOR_MAX) return 'late_major';
      return 'late_severe';
    }
  }
}

/**
 * The only re-classification a human may apply to a draft: promoting a plain
 * no-show to the group-wipe variant (because only a person present knows the
 * session actually collapsed).
 */
export function isAllowedTypeOverride(
  derived: ViolationType,
  requested: ViolationType,
): boolean {
  if (derived === requested) return true;
  return derived === 'no_show' && requested === 'no_show_group';
}

/** Pre-filled narrative for a draft case, editable by the organizer. */
export function draftClaim(
  sessionTitle: string,
  startsAtLabel: string,
  attendance: Attendance,
  lateMinutes: number | null,
): string {
  const head = `约局「${sessionTitle}」（${startsAtLabel}）`;
  switch (attendance) {
    case 'late':
      return `${head}：报名了，实际迟到约 ${lateMinutes ?? 0} 分钟。`;
    case 'no_show':
      return `${head}：报名了但没到，也没有提前说明。`;
    case 'left_early':
      return `${head}：中途退出，没有打完。`;
    case 'on_time':
      return `${head}：准时到场，守约。`;
    case 'excused':
      return `${head}：已请假。`;
  }
}

// --- Session lifecycle --------------------------------------------------------

export type SessionStatus = 'open' | 'cancelled' | 'settled';

export const SESSION_STATUSES: SessionStatus[] = ['open', 'cancelled', 'settled'];

export function isSessionStatus(v: string): v is SessionStatus {
  return (SESSION_STATUSES as string[]).includes(v);
}

export const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  open: '报名中',
  cancelled: '已取消',
  settled: '已结算',
};

/** Minimum attendees before the organizer earns organizer_bonus (anti-farming). */
export const ORGANIZER_BONUS_MIN_ATTENDEES = 2;

export const SESSION_TITLE_MAX = 60;
export const SESSION_GAME_MAX = 40;
export const SESSION_NOTE_MAX = 300;
/** Sanity bound on how far ahead a session may be scheduled (90 days). */
export const SESSION_MAX_LEAD_MS = 90 * 24 * 60 * 60 * 1000;
