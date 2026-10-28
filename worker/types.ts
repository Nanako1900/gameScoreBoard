// Env bindings + D1 row types + JSON output shapes for the EDG 信誉分 Worker.
// JSON shapes mirror docs/CONTRACT.md exactly. Do not invent new field names.

import type { CaseStatus, VerdictSource, ViolationType } from '../shared/scoring';
import type { ClassifiedBy } from './ai/classify';

/** Worker runtime bindings (see docs/CONTRACT.md → Env). */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  OAUTH_BASE_URL: string;
  OAUTH_CLIENT_ID: string;
  OAUTH_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  APP_URL?: string; // optional; else derive from request origin
  RESET_TZ_OFFSET?: string; // hours, default "8"
  /** Comma-separated OAuth subject ids (users.id) -> is_admin on login. */
  ADMIN_SUBJECT_IDS?: string;
  /** Deprecated: comma-separated usernames; ignored once ADMIN_SUBJECT_IDS is set. */
  ADMIN_USERNAMES?: string;
  /** '1' / 'true' = maintenance mode: every write is refused with 503. */
  READ_ONLY?: string;

  // --- AI 裁决 (any OpenAI-compatible endpoint) --------------------------------
  // Defaults only. `app_settings` rows of the same name override every one of
  // these at runtime. API keys use encrypted database credentials when present.
  AI_ENABLED?: string; // 'false' disables AI judging (everything falls back to base)
  AI_BASE_URL?: string; // e.g. https://api.openai.com/v1  (no trailing /chat/completions)
  AI_MODEL?: string;
  AI_API_KEY?: string; // Legacy fallback, only when no credential row exists.
  AI_CONFIG_MASTER_KEY?: string; // Secret: Base64-encoded 32-byte encryption key.
  AI_SYSTEM_PROMPT?: string;
  AI_TEMPERATURE?: string;
  /** Hours a subject gets to file a statement; default STATEMENT_WINDOW_HOURS. */
  STATEMENT_WINDOW_HOURS?: string;

  // --- Split-deployment (frontend on a different origin, e.g. EdgeOne) ---------
  // All optional; unset = single-origin behavior (unified Worker, or EdgeOne
  // edge-function reverse-proxy where the browser sees one origin). See
  // DEPLOY-EDGEONE.md for how these combine.
  FRONTEND_ORIGIN?: string; // comma-separated allowed CORS origins (enables credentialed CORS)
  FRONTEND_URL?: string; // absolute SPA URL that /auth/callback redirects to after login
  COOKIE_SAMESITE?: string; // 'Lax' (default) | 'None' | 'Strict'
  COOKIE_DOMAIN?: string; // e.g. '.example.com' to share the cookie across sibling subdomains
  /** '1' = __Host- cookie names (host-only, no Domain). For the Pages + api.<domain> split. */
  HOST_ONLY_COOKIES?: string;

  // Extra hostnames allowed for the /api/avatar image proxy (comma-separated).
  // The OAuth provider's registrable domain is always allowed automatically.
  AVATAR_ALLOWED_HOSTS?: string;
}

// --- D1 row types (raw shapes as stored; booleans are 0/1 integers) ----------

export interface UserRow {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  email: string | null;
  is_participant: number;
  is_judge: number;
  is_admin: number;
  score: number;
  created_at: string;
  updated_at: string;
}

export interface RecordRow {
  id: number;
  subject_id: string;
  reporter_id: string;
  type: string;
  delta: number;
  note: string | null;
  claim: string | null;
  claim_summary: string | null;
  classified_by: string | null;
  escalation_suggested: number;
  session_id: number | null;
  statement: string | null;
  statement_at: string | null;
  appeal_reason: string | null;
  deadline_at: string | null;
  judging_started_at: string | null;
  verdict_source: string | null;
  verdict_headline: string | null;
  verdict_reason: string | null;
  verdict_factors: string | null;
  status: string;
  created_at: string;
}

export interface ScoreEventRow {
  id: number;
  user_id: string;
  delta: number;
  reason: string;
  resulting_score: number;
  created_at: string;
}

/** Flattened row produced by the records ⋈ users (subject + reporter) join. */
export interface RecordJoinRow {
  id: number;
  type: string;
  delta: number;
  note: string | null;
  claim: string | null;
  claim_summary: string | null;
  classified_by: string | null;
  escalation_suggested: number;
  session_id: number | null;
  statement: string | null;
  statement_at: string | null;
  appeal_reason: string | null;
  deadline_at: string | null;
  verdict_source: string | null;
  verdict_headline: string | null;
  verdict_reason: string | null;
  verdict_factors: string | null;
  status: string;
  created_at: string;
  s_id: string;
  s_username: string;
  s_avatar: string | null;
  p_id: string;
  p_username: string;
  p_avatar: string | null;
}

// --- JSON output shapes (booleans are real booleans) -------------------------

/** Full user — only returned for the authenticated caller via /api/me. */
export interface User {
  id: string;
  username: string; // effective display name (custom display_name, else OAuth username)
  oauth_username: string; // raw OAuth (Nanako) username
  avatar_url: string | null;
  is_participant: boolean;
  is_judge: boolean;
  is_admin: boolean;
  score: number;
  created_at: string;
}

/** Public user — leaderboard, records, profiles. No email, no is_admin. */
export interface PublicUser {
  id: string;
  username: string;
  avatar_url: string | null;
  is_participant: boolean;
  is_judge: boolean;
  score: number;
  created_at: string;
}

export interface RecordActor {
  id: string;
  username: string;
  avatar_url: string | null;
}

export interface VerdictFactor {
  kind: 'mitigating' | 'aggravating';
  text: string;
}

export interface Verdict {
  source: VerdictSource;
  headline: string;
  reasoning: string;
  factors: VerdictFactor[];
}

export interface RecordItem {
  id: number;
  subject: RecordActor;
  reporter: RecordActor;
  type: ViolationType;
  delta: number;
  /** Judge's short note. Public, like the fields here not marked private. */
  note: string | null;
  claim: string | null;
  /** AI's one-line condensation of `claim`; the feed's headline. */
  claim_summary: string | null;
  classified_by: ClassifiedBy;
  /** AI pointed at the group-wipe charge; a judge must co-sign it. */
  escalation_suggested: boolean;
  session_id: number | null;
  /** Private (see RecordView): the subject's own words. */
  statement: string | null;
  statement_at: string | null;
  /** Private: why the subject contested the verdict — the admin needs it to review. */
  appeal_reason: string | null;
  deadline_at: string | null;
  status: CaseStatus;
  verdict: Verdict | null;
  /** Sentencing range for this case's type, so the UI can draw the scale. */
  range: { min: number; max: number; base: number };
  created_at: string;
}

/**
 * A case as the web API returns it to one viewer. The statement, the appeal
 * reason and the verdict's words (headline, reasoning, factors — written after
 * reading the statement, often quoting it) are only for the subject, the
 * reporter, judges and admins; anyone else gets them blanked and `redacted`.
 * After the verdict the outcome (type, delta, status, who) stays public;
 * before it, see PendingHiddenRecordView.
 */
export type RecordView = OpenRecordView | PendingHiddenRecordView;

/** Every case a viewer may read in full, and every decided case. Never carries `pending_hidden`. */
export interface OpenRecordView extends RecordItem {
  redacted: boolean;
  pending_hidden?: never;
}

/** The accusation's fields an outsider must not read before the verdict (B1-1, spec §11 #3 tier b). */
export type PendingHiddenField = 'type' | 'range' | 'claim' | 'claim_summary' | 'note' | 'escalation_suggested';

/**
 * Before the verdict (awaiting_statement / judging), to anyone but the subject,
 * the reporter, judges and admins: only that a case exists. The type, the
 * accusation, the judge's note, the sentencing range and the escalation hint are
 * blanked; statement_at stays, so the UI can still say a statement was written.
 */
export interface PendingHiddenRecordView extends Omit<RecordItem, PendingHiddenField> {
  type: null;
  range: null;
  claim: null;
  claim_summary: null;
  note: null;
  escalation_suggested: false;
  redacted: true;
  pending_hidden: true;
}

export interface HistoryPoint {
  at: string;
  score: number;
}

/** Hono generics for the app: bindings + per-request variables. */
export interface AppEnv {
  Bindings: Env;
  Variables: {
    user: User | null;
  };
}
