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
