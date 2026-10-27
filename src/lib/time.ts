// Time formatting helpers: relative timestamps and a countdown formatter.
// All pure; no side effects.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** SQLite `datetime('now')` shape: UTC, but with no `T` and no zone marker. */
const SQLITE_DATETIME = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/;

/**
 * Parse a SQLite `datetime('now')` value (`YYYY-MM-DD HH:MM:SS`, UTC) or an ISO
 * string into epoch milliseconds. Returns NaN when unparseable.
 */
export function parseTimestamp(value: string): number {
  // Must be matched BEFORE Date.parse: V8 accepts the space-separated form but
  // reads it as LOCAL time, which shifted every server timestamp by the
  // viewer's UTC offset (8h in Beijing).
  const sqlite = SQLITE_DATETIME.exec(value.trim());
  if (sqlite) {
    return Date.parse(`${sqlite[1]}T${sqlite[2]}Z`);
  }
  return Date.parse(value);
}

/** '刚刚 / x分钟前 / x小时前 / x天前', or a date for anything older than ~30 days. */
export function relativeTime(value: string, now: number = Date.now()): string {
  const then = parseTimestamp(value);
  if (Number.isNaN(then)) {
    return '';
  }
  const diff = now - then;

  if (diff < MINUTE) {
    return '刚刚';
  }
  if (diff < HOUR) {
    return `${Math.floor(diff / MINUTE)}分钟前`;
  }
  if (diff < DAY) {
    return `${Math.floor(diff / HOUR)}小时前`;
  }
  if (diff < 30 * DAY) {
    return `${Math.floor(diff / DAY)}天前`;
  }
  const d = new Date(then);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export interface Countdown {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  done: boolean;
}

/** Break the milliseconds until `target` into d/h/m/s parts (clamped at zero). */
export function countdownParts(targetIso: string, now: number = Date.now()): Countdown {
  const target = parseTimestamp(targetIso);
  const remaining = Number.isNaN(target) ? 0 : Math.max(0, target - now);
  const days = Math.floor(remaining / DAY);
  const hours = Math.floor((remaining % DAY) / HOUR);
  const minutes = Math.floor((remaining % HOUR) / MINUTE);
  const seconds = Math.floor((remaining % MINUTE) / 1000);
  return { days, hours, minutes, seconds, done: remaining <= 0 };
}

/** Compact countdown label, e.g. `2天 06:14:03` or `06:14:03`. */
export function formatCountdown(targetIso: string, now: number = Date.now()): string {
  const { days, hours, minutes, seconds, done } = countdownParts(targetIso, now);
  if (done) {
    return '即将刷新';
  }
  const clock = `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
  return days > 0 ? `${days}天 ${clock}` : clock;
}

/** Remaining time until `target`, phrased for a deadline: '还剩 3 小时 20 分'. */
export function formatRemaining(targetIso: string, now: number = Date.now()): string {
  const { days, hours, minutes, done } = countdownParts(targetIso, now);
  if (done) return '已截止';
  if (days > 0) return `还剩 ${days} 天 ${hours} 小时`;
  if (hours > 0) return `还剩 ${hours} 小时 ${minutes} 分`;
  return `还剩 ${minutes} 分钟`;
}

/** True when a deadline is close enough to warrant a red, urgent treatment. */
export function isUrgent(targetIso: string, now: number = Date.now()): boolean {
  const { days, hours, done } = countdownParts(targetIso, now);
  return done || (days === 0 && hours < 2);
}

/** Local wall-clock label for a session time, e.g. '7月25日 20:00 周五'. */
export function formatDateTime(value: string): string {
  const ms = parseTimestamp(value);
  if (Number.isNaN(ms)) return '';
  const d = new Date(ms);
  const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad2(d.getHours())}:${pad2(
    d.getMinutes(),
  )} ${weekday}`;
}

/**
 * Compact when-label for a scheduled session: '今天 20:00' / '明天 20:00' /
 * '周五 20:00', falling back to a date beyond a week out.
 *
 * `formatDateTime` produces '7月28日 09:48 周二' — 14 characters, which wrapped
 * the invite banner onto three lines on a 375px screen and orphaned a word. For
 * a game that is days away at most, the weekday is the part people actually read.
 */
export function formatWhen(value: string, now: number = Date.now()): string {
  const ms = parseTimestamp(value);
  if (Number.isNaN(ms)) return '';
  const d = new Date(ms);
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const startOfDay = (t: number): number => {
    const x = new Date(t);
    x.setHours(0, 0, 0, 0);
    return x.getTime();
  };
  const days = Math.round((startOfDay(ms) - startOfDay(now)) / DAY);
  if (days === 0) return `今天 ${time}`;
  if (days === 1) return `明天 ${time}`;
  if (days > 1 && days < 7) {
    return `${['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]} ${time}`;
  }
  return `${d.getMonth() + 1}月${d.getDate()}日 ${time}`;
}

/** `datetime-local` input value (local time, minute precision). */
export function toDateTimeLocalValue(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(
    d.getHours(),
  )}:${pad2(d.getMinutes())}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * The board's last week — the one a fresh report is about — as its local
 * Monday (YYYY-MM-DD), from the next weekly reset (a local Monday 00:00). Noon
 * of that Monday is still Monday for any board offset within ±12 h.
 */
export function lastWeekStartOf(nextResetAt: string): string | null {
  const ms = Date.parse(nextResetAt);
  if (Number.isNaN(ms)) return null;
  return new Date(ms + 12 * 3_600_000 - 14 * 86_400_000).toISOString().slice(0, 10);
}

/** Shown in place of the reset countdown once nextResetAt has passed and config is being refetched. */
export const RESET_PENDING_LABEL = '回血中…';

/**
 * Header countdown to the weekly reset: '2天 06:14' | '06:14' | '回血中…' (passed).
 * Minute precision, rounded UP so the last minute reads '00:01', never '00:00'
 * or a negative number. An unparsable target reads '—', like a missing config.
 */
export function formatResetCountdown(targetIso: string, now: number = Date.now()): string {
  const target = parseTimestamp(targetIso);
  if (Number.isNaN(target)) return '—';
  const remaining = target - now;
  if (remaining <= 0) return RESET_PENDING_LABEL;
  const totalMinutes = Math.ceil(remaining / MINUTE);
  const days = Math.floor(totalMinutes / (DAY / MINUTE));
  const hours = Math.floor((totalMinutes % (DAY / MINUTE)) / (HOUR / MINUTE));
  const clock = `${pad2(hours)}:${pad2(totalMinutes % (HOUR / MINUTE))}`;
  return days > 0 ? `${days}天 ${clock}` : clock;
}

/** Prose time left: '还有 2 天' | '还有 5 小时' | '还有 12 分钟' | '还有不到 1 分钟' | '' (passed). */
export function formatTimeLeft(targetIso: string, now: number = Date.now()): string {
  const target = parseTimestamp(targetIso);
  const remaining = Number.isNaN(target) ? 0 : target - now;
  if (remaining <= 0) return '';
  if (remaining < MINUTE) return '还有不到 1 分钟';
  if (remaining < HOUR) return `还有 ${Math.floor(remaining / MINUTE)} 分钟`;
  if (remaining < DAY) return `还有 ${Math.floor(remaining / HOUR)} 小时`;
  return `还有 ${Math.floor(remaining / DAY)} 天`;
}
