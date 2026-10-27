// src/lib/constants.ts — frontend-only timings and thresholds. Domain numbers live in shared/.

// --- P0-3 ---
/** A toast without an action disappears after this long. */
export const TOAST_DURATION_MS = 5_000;
/** A toast with an action (撤销) stays at least this long (spec §6.4). */
export const TOAST_ACTION_MIN_MS = 8_000;
export const TOAST_MAX_VISIBLE = 3;
/** Coming back to the tab refetches only when the last refresh is older than this. */
export const VISIBLE_REFRESH_MIN_MS = 60_000;
/** Header / MyScoreLine countdowns tick once a minute (spec §2.1). */
export const COUNTDOWN_TICK_MS = 60_000;
/** Feed size the home page loads — must stay 50: tests pin GET /api/records?limit=50. */
export const CORE_FEED_LIMIT = 50;
export const PENDING_STATEMENTS_LIMIT = 20;

// --- P0-6 ---
/**
 * A move DMs everyone in the session this many minutes later, and a burst of
 * moves is one DM. MUST equal `interval '3 minutes'` in the dm.session.changed
 * branch of server/migrations/0005_sessions.sql (asserted in session-actions.test.ts).
 */
export const RESCHEDULE_DM_DELAY_MIN = 3;
/** 其他时间 first shows an hour from now — shared by 改时间 (RescheduleSheet) and 发起约局 (SessionFormDialog). */
export const CUSTOM_TIME_LEAD_MS = 60 * 60 * 1000;
