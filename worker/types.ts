// Env bindings + D1 row types + JSON output shapes for the EDG 信誉分 Worker.
// JSON shapes mirror docs/CONTRACT.md exactly. Do not invent new field names.

import type { ViolationType } from '../shared/scoring';

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
  ADMIN_USERNAMES?: string; // comma-separated usernames -> is_admin on login

  // --- Split-deployment (frontend on a different origin, e.g. EdgeOne) ---------
  // All optional; unset = single-origin behavior (unified Worker, or EdgeOne
  // edge-function reverse-proxy where the browser sees one origin). See
  // DEPLOY-EDGEONE.md for how these combine.
  FRONTEND_ORIGIN?: string; // comma-separated allowed CORS origins (enables credentialed CORS)
  FRONTEND_URL?: string; // absolute SPA URL that /auth/callback redirects to after login
  COOKIE_SAMESITE?: string; // 'Lax' (default) | 'None' | 'Strict'
  COOKIE_DOMAIN?: string; // e.g. '.example.com' to share the cookie across sibling subdomains

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

export interface RecordItem {
  id: number;
  subject: RecordActor;
  reporter: RecordActor;
  type: ViolationType;
  delta: number;
  note: string | null;
  status: 'active' | 'disputed' | 'revoked';
  created_at: string;
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
