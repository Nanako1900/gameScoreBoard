// Time formatting helpers: relative timestamps and a countdown formatter.
// All pure; no side effects.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Parse a SQLite `datetime('now')` value (`YYYY-MM-DD HH:MM:SS`, UTC) or an ISO
 * string into epoch milliseconds. Returns NaN when unparseable.
 */
export function parseTimestamp(value: string): number {
  const direct = Date.parse(value);
  if (!Number.isNaN(direct)) {
    return direct;
  }
  // SQLite datetime lacks the `T` and `Z` — treat it as UTC.
  const normalized = `${value.replace(' ', 'T')}Z`;
  return Date.parse(normalized);
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
