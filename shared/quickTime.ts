// ============================================================================
// EDG 信誉分 — 约局的「快速时间」候选
// Pure module: NO Cloudflare / DOM / Node globals. Imported by BOTH the Worker
// (to synthesise a session title) and the React frontend (to render the chips).
//
// Scope is deliberately narrow: today through the end of this week. That is the
// entire range v3 offers by default, because "今晚八点" is what people actually
// organise. Anything further out goes through the collapsed 其他时间 picker.
// ============================================================================

/** Evening slots offered for today, in local hours. */
export const TODAY_HOURS = [20, 21, 22];
/** Single slot offered for any future day. */
export const FUTURE_HOUR = 20;
/** Never offer a slot less than this far away — nobody schedules 3 minutes out. */
export const MIN_LEAD_MINUTES = 30;
export const MAX_SLOTS = 6;

export interface QuickSlot {
  /** ISO 8601 UTC — what gets sent to the API. */
  iso: string;
  /** Chip label, e.g. '今晚 20:00' / '周五 20:00'. */
  label: string;
  /** Epoch millis, exposed so callers can sort or compare without re-parsing. */
  at: number;
}

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Local midnight of `base` shifted by `dayOffset` days, at `hour`:00. */
function slotAt(base: Date, dayOffset: number, hour: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function labelFor(d: Date, now: Date): string {
  const time = `${pad2(d.getHours())}:00`;
  const dayDiff = Math.round(
    (slotAt(d, 0, 0).getTime() - slotAt(now, 0, 0).getTime()) / 86_400_000,
  );
  if (dayDiff === 0) return `今晚 ${time}`;
  if (dayDiff === 1) return `明晚 ${time}`;
  return `${WEEKDAY[d.getDay()]} ${time}`;
}

/**
 * Build the quick-pick slots: remaining evening hours today, then 20:00 on each
 * remaining day of this week (weeks start Monday, matching the scoring reset).
 *
 * `now` is injectable so this stays a pure function and can be tested without
 * freezing the clock.
 */
export function quickSlots(now: Date = new Date()): QuickSlot[] {
  const earliest = now.getTime() + MIN_LEAD_MINUTES * 60_000;
  const out: QuickSlot[] = [];

  for (const hour of TODAY_HOURS) {
    const d = slotAt(now, 0, hour);
    if (d.getTime() >= earliest) out.push(toSlot(d, now));
  }

  // Monday-based index: how many days until this week runs out.
  const dow = now.getDay() === 0 ? 7 : now.getDay(); // Mon=1 … Sun=7
  const daysLeftThisWeek = 7 - dow;
  for (let offset = 1; offset <= daysLeftThisWeek; offset += 1) {
    const d = slotAt(now, offset, FUTURE_HOUR);
    if (d.getTime() >= earliest) out.push(toSlot(d, now));
  }

  // Late in the week (or late at night) there may be nothing left to offer —
  // fall back to tomorrow evening so the dialog is never empty.
  if (out.length === 0) {
    out.push(toSlot(slotAt(now, 1, FUTURE_HOUR), now));
  }

  return out.sort((a, b) => a.at - b.at).slice(0, MAX_SLOTS);
}

function toSlot(d: Date, now: Date): QuickSlot {
  return { iso: d.toISOString(), label: labelFor(d, now), at: d.getTime() };
}

/**
 * Session title, synthesised rather than typed. The Worker regenerates it from
 * `starts_at` so a tampered client cannot inject a title, and so the wording
 * stays consistent across every session.
 */
export function synthesizeTitle(startsAtIso: string, offsetHours: number): string {
  const ms = Date.parse(startsAtIso);
  if (!Number.isFinite(ms)) return '开黑';
  // Shift into the board's local timezone, then read UTC parts.
  const d = new Date(ms + offsetHours * 3_600_000);
  const weekday = WEEKDAY[d.getUTCDay()];
  return `${weekday} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} 开黑`;
}

/**
 * True when a title looks like one `synthesizeTitle` produced.
 *
 * Since v3 stopped asking for a title and derives it from the start time, a list
 * row that shows both the formatted time AND the title prints the same time
 * twice. The UI uses this to suppress the redundant line — matched by shape
 * rather than by regenerating it, because the client does not know the board's
 * timezone offset.
 */
export function isSynthesizedTitle(title: string): boolean {
  return /^周[日一二三四五六]\s\d{2}:\d{2}\s开黑$/.test(title.trim());
}
