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

// --- P0-4 ---
/** 本周之星: at least this many 守约守时 bonuses this week (spec §5 #1). */
export const WEEK_STAR_MIN_ON_TIME = 2;
/** The home feed shows this many rows before 看更多. */
export const FEED_PREVIEW_COUNT = 10;

// --- P0-5 ---
/** Revoke countdowns refresh this often (spec §5 #6). */
export const REVOKE_TICK_MS = 30_000;
/** Debounce between a keystroke and the draft write. */
export const DRAFT_SAVE_DEBOUNCE_MS = 400;

// --- P1-1 ---
/** The one breakpoint JS needs: page vs drawer for /sessions/:id and /players/:id. Same as the CSS (min-width: 1024px). */
export const DESKTOP_MEDIA_QUERY = '(min-width: 1024px)';
/** /players/:id — OAuth subjects are free-form; anything longer is not one of ours. */
export const USER_ID_MAX = 128;

// --- P1-2 ---
/** An overlay's silent step back whose popstate never arrives stops holding navigations after this long. */
export const SILENT_BACK_TIMEOUT_MS = 1_000;
/** The `sheet` mark on an overlay's history entry (its historyKey), kept short. */
export const HISTORY_SHEET_NAME_MAX = 32;

// --- P1-3 ---
/** edg.return older than this is ignored: a login that took longer is not the same visit. */
export const LOGIN_RETURN_TTL_MS = 30 * 60 * 1000;
/** edg.return.path upper bound. */
export const RETURN_PATH_MAX = 512;
