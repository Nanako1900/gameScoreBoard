# EDG 信誉分 — 前后端契约 (single source of truth for implementers)

> Both the Worker (`worker/*`) and the React frontend (`src/*`) MUST match this
> document exactly. Scoring constants live in `shared/scoring.ts` — import them,
> never re-hardcode. Do not invent new endpoints or field names.

## Stack

- Backend: Cloudflare **Worker** + **Hono** (`worker/index.ts` is `main`).
- Frontend: **React 18 + Vite** SPA in `src/`, builds to `./dist`.
- DB: **D1** (schema in `schema.sql`). Binding name `DB`.
- Static assets served via binding `ASSETS`; `run_worker_first = true`, so the
  Worker sees every request: it handles `/api/*` and `/auth/*`, and delegates
  everything else to `env.ASSETS.fetch(request)` (SPA fallback).
- Weekly recovery via Cron Trigger → `scheduled()` handler.

## Env (worker/types.ts)

```ts
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  OAUTH_BASE_URL: string;
  OAUTH_CLIENT_ID: string;
  OAUTH_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  APP_URL?: string;          // optional; else derive from request origin
  RESET_TZ_OFFSET?: string;  // hours, default "8"
  ADMIN_USERNAMES?: string;  // comma-separated usernames -> is_admin on login
}
```

## Data shapes (JSON)

```ts
// Full user (only returned for the authenticated user via /api/me)
interface User {
  id: string;
  username: string;
  avatar_url: string | null;
  is_participant: boolean;
  is_judge: boolean;
  is_admin: boolean;
  score: number;             // 0..100
  created_at: string;
}

// Public user (leaderboard, records, profiles) — no email
interface PublicUser {
  id: string; username: string; avatar_url: string | null;
  is_participant: boolean; is_judge: boolean; score: number; created_at: string;
}

interface RecordItem {
  id: number;
  subject: { id: string; username: string; avatar_url: string | null };
  reporter: { id: string; username: string; avatar_url: string | null };
  type: ViolationType;       // from shared/scoring.ts
  delta: number;             // signed, actually applied
  note: string | null;
  status: 'active' | 'disputed' | 'revoked';
  created_at: string;        // ISO / sqlite datetime
}

interface HistoryPoint { at: string; score: number; }
```

## Endpoints

Booleans in JSON are real booleans (convert D1's 0/1). All error responses:
`{ "error": string }` with an appropriate 4xx/5xx status.

### Public (no auth)
- `GET /api/config`
  → `{ violations: ViolationDef[], tiers: Tier[], weeklyHeal: number, weeklyBonusCap: number, nextResetAt: string }`
  (`nextResetAt` = ISO timestamp of the next weekly heal, computed from RESET_TZ_OFFSET.)
- `GET /api/leaderboard`
  → `{ participants: PublicUser[] }` — only `is_participant = 1`, sorted by `score DESC, username ASC`.
- `GET /api/records?limit=50&subject=<id>&status=active`
  → `{ records: RecordItem[] }` — newest first. `subject` and `status` optional filters. Default limit 50, max 200.
- `GET /api/users/:id`
  → `{ user: PublicUser, records: RecordItem[], history: HistoryPoint[] }`
  (history from `score_events` ascending; prepend a synthetic BASE_SCORE=100 start point.)

### Auth
- `GET /auth/login` → 302 to `${OAUTH_BASE_URL}/oauth/authorize?response_type=code&client_id=..&redirect_uri=${origin}/auth/callback&scope=profile&state=..`
  - `state` (random) stored in a short-lived signed HttpOnly cookie.
- `GET /auth/callback?code=..&state=..`
  - verify `state`; POST `${OAUTH_BASE_URL}/oauth/token`
    (`grant_type=authorization_code, code, redirect_uri, client_id, client_secret`, `Content-Type: application/x-www-form-urlencoded`);
  - GET `${OAUTH_BASE_URL}/oauth/userinfo` with `Authorization: Bearer <access_token>`;
  - map fields tolerantly:
    id = `sub ?? id ?? user_id`; username = `username ?? name ?? nickname ?? preferred_username`;
    avatar = `avatar ?? picture ?? avatar_url ?? photo`; email = `email`;
  - upsert `users` (grant admin if username ∈ ADMIN_USERNAMES);
  - set session cookie; 302 to `/` (append `?onboarding=1` if the user is brand new).
- `POST /auth/logout` → clear session cookie, `{ ok: true }`.

### Authenticated (session cookie)
- `GET /api/me` → `{ user: User | null }` (null if not logged in; 200 either way).
- `POST /api/me/roles` body `{ is_participant?: boolean, is_judge?: boolean }`
  → `{ user: User }`. Updates the caller's own roles. Becoming a participant keeps existing score (default 100 for new).
- `POST /api/records` body `{ subject_id: string, type: ViolationType, note?: string }`
  → `{ record: RecordItem }`. Requires `is_judge`. Rules:
  - reject if `subject_id === caller.id` (不能记录自己) → 400.
  - reject if subject not found or `is_participant = 0` → 400.
  - delta = `VIOLATION_MAP[type].delta`. For bonuses, reject if it would push this
    week's total positive delta for the subject over `WEEKLY_BONUS_CAP` → 400.
  - apply: `newScore = clampScore(subject.score + delta)`; the applied delta stored
    on the record = `newScore - subject.score` (so clamping is reflected). Update
    user, insert `records` row, insert `score_events` row (`reason='record:<id>'`).
- `POST /api/records/:id/dispute` → subject-only, sets `status='disputed'` (no score change). → `{ record }`.
- `POST /api/records/:id/revoke` → reporter within 15 min OR admin. Reverses the
  applied delta (`score = clampScore(score - record.delta)`), sets `status='revoked'`,
  logs a `score_events` row (`reason='revoke:<id>'`). → `{ record }`.

### Admin (is_admin)
- `POST /api/admin/users/:id` body `{ is_participant?, is_judge?, is_admin?, score?, delete? }`
  → `{ ok: true }`. `score` set logs an `admin_adjust` score_event. `delete:true` removes the user (and cascade their records/events).

## scheduled() — weekly heal
- Compute `week_start` = the local (RESET_TZ_OFFSET) Monday date `YYYY-MM-DD`.
- If `weekly_heals` already has that `week_start` → no-op (idempotent).
- Else: for each `is_participant=1` user, `score = min(100, score + WEEKLY_HEAL)`,
  insert a `score_events` row (`reason='weekly_heal'`) for each changed user, then
  insert the `weekly_heals` ledger row.

## Frontend expectations
- Fetch `/api/config`, `/api/leaderboard`, `/api/records`, `/api/me` on load.
- Import display constants from `@shared/scoring` (VIOLATIONS, TIERS, tierFor, clampScore).
- Roles/onboarding, judge "记一笔" dialog, player detail, dispute — all via the above endpoints.
