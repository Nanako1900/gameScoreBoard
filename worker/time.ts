// Weekly-reset time math. All computations are timezone-offset aware but rely
// only on UTC getters so they behave identically in the Workers runtime.

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** Parse RESET_TZ_OFFSET (hours) tolerantly; default 8 (Beijing). */
export function resetOffsetHours(raw: string | undefined): number {
  const n = raw !== undefined ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : 8;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * The UTC {@link Date} instant marking the start (local Monday 00:00) of the
 * week that currently contains "now" in the given timezone offset.
 */
export function weekStartInstant(offsetHours: number): Date {
  const offsetMs = offsetHours * HOUR_MS;
  // Shift so that UTC getters read the local wall clock.
  const local = new Date(Date.now() + offsetMs);
  const dow = local.getUTCDay(); // 0=Sun … 6=Sat
  const daysSinceMonday = (dow + 6) % 7;
  const localMondayMidnight =
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) -
    daysSinceMonday * DAY_MS;
  // Convert the local wall-clock midnight back to a real UTC instant.
  return new Date(localMondayMidnight - offsetMs);
}

/** Local (offset) Monday date of the current week as 'YYYY-MM-DD'. */
export function weekStartLocal(offsetHours: number): string {
  const local = new Date(Date.now() + offsetHours * HOUR_MS);
  const dow = local.getUTCDay();
  const daysSinceMonday = (dow + 6) % 7;
  const monday = new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) -
      daysSinceMonday * DAY_MS,
  );
  return `${monday.getUTCFullYear()}-${pad2(monday.getUTCMonth() + 1)}-${pad2(
    monday.getUTCDate(),
  )}`;
}

/**
 * Current week start as a UTC sqlite datetime string 'YYYY-MM-DD HH:MM:SS',
 * suitable for comparing against `records.created_at` (stored in UTC).
 */
export function weekStartUtcSql(offsetHours: number): string {
  const d = weekStartInstant(offsetHours);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(
    d.getUTCDate(),
  )} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

/** ISO timestamp of the next weekly-heal instant (strictly in the future). */
export function nextResetAt(offsetHours: number): string {
  let instant = weekStartInstant(offsetHours).getTime();
  if (instant <= Date.now()) instant += 7 * DAY_MS;
  return new Date(instant).toISOString();
}
