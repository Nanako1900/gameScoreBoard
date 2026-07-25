# EDG 信誉分 — 前后端契约 (single source of truth for implementers)

> Both the Worker (`worker/*`) and the React frontend (`src/*`) MUST match this
> document exactly. Scoring constants live in `shared/scoring.ts` and attendance
> mapping in `shared/attendance.ts` — import them, never re-hardcode. Do not
> invent new endpoints or field names.
>
> v2 design rationale (why the trial flow exists, threat model, phasing):
> `docs/DESIGN-v2.md`.

## Stack

- Backend: Cloudflare **Worker** + **Hono** (`worker/index.ts` is `main`).
- Frontend: **React 18 + Vite** SPA in `src/`, builds to `./dist`.
- DB: **D1** (schema in `schema.sql`). Binding name `DB`.
- Static assets served via binding `ASSETS`; `run_worker_first = true`, so the
  Worker sees every request: it handles `/api/*` and `/auth/*`, and delegates
  everything else to `env.ASSETS.fetch(request)` (SPA fallback).
- Weekly recovery **and** overdue-case judging run lazily from `GET /api/config`
  via `waitUntil` (both idempotent), so a Cron Trigger is optional. If one fires,
  `scheduled()` runs the same two jobs.

## Worker modules

| File | Responsibility |
|---|---|
| `worker/index.ts` | entrypoint, error mapping, `scheduled()` |
| `worker/routes.ts` | every HTTP endpoint + input narrowing |
| `worker/db.ts` | users, roles, profile, `scoreMutation`, weekly heal |
| `worker/cases.ts` | case lifecycle: file → statement → verdict → appeal/revoke |
| `worker/sessions.ts` | 约局: create / RSVP / roll call / settle |
| `worker/ai/config.ts` | runtime AI config resolution (`app_settings` > env > default) |
| `worker/ai/prompt.ts` | prompt building, input sanitisation, verdict parsing |
| `worker/ai/provider.ts` | OpenAI-compatible client, never throws |
| `worker/errors.ts` | `ApiError` |
| `worker/time.ts` | week math + sqlite-datetime helpers |

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

  // AI 裁决 — all overridable at runtime from app_settings EXCEPT AI_API_KEY.
  AI_ENABLED?: string;
  AI_BASE_URL?: string;      // must end at /v1; code appends /chat/completions
  AI_MODEL?: string;
  AI_API_KEY?: string;       // SECRET ONLY — never stored in D1
  AI_SYSTEM_PROMPT?: string;
  AI_TEMPERATURE?: string;
  STATEMENT_WINDOW_HOURS?: string;     // default 12
  SESSION_ORGANIZER_CAN_FILE?: string; // 'false' = organizers may only record attendance

  // Split deployment (see DEPLOY-EDGEONE.md)
  FRONTEND_ORIGIN?: string; FRONTEND_URL?: string;
  COOKIE_SAMESITE?: string; COOKIE_DOMAIN?: string;
  AVATAR_ALLOWED_HOSTS?: string;
}
```

## Scoring model

`ViolationDef` carries a **sentencing range**, not a fixed delta:

```ts
interface ViolationDef {
  type: ViolationType; label: string; emoji: string; desc: string;
  kind: 'penalty' | 'bonus';
  base: number;  // anchor; used verbatim when the AI is unavailable
  min: number;   // harshest the AI may go
  max: number;   // most lenient the AI may go
}
```

- **Penalties** run the full trial (statement → AI verdict).
- **Bonuses** settle instantly at `base`, bounded by `WEEKLY_BONUS_CAP`.
- `clampVerdictDelta(def, raw)` is applied to **every** verdict server-side. It is
  the decisive guard: a penalty can never become a bonus, and no delta can leave
  `[min, max]` or exceed `MAX_SINGLE_PENALTY`. See `docs/DESIGN-v2.md` §1.4.

## Case state machine

```
awaiting_statement ──(statement | window lapsed)──► judging ──► decided
        │                                                          │
        └──(reporter/admin)──► withdrawn          (subject)────────┤
                                                                   ▼
                                             appealed ──(admin)──► decided | revoked
                                             decided  ──(admin/reporter ≤15min)──► revoked
```

`delta` is `0` until `decided`. `affectsScore(status)` is true only for
`decided` and `appealed` — appealing does **not** refund points.

## Data shapes (JSON)

```ts
interface User {          // /api/me only
  id: string; username: string; oauth_username: string;
  avatar_url: string | null;
  is_participant: boolean; is_judge: boolean; is_admin: boolean;
  score: number; created_at: string;
}

interface PublicUser {    // leaderboard, records, profiles — no email/is_admin
  id: string; username: string; avatar_url: string | null;
  is_participant: boolean; is_judge: boolean; score: number; created_at: string;
}

interface RecordItem {
  id: number;
  subject: { id: string; username: string; avatar_url: string | null };
  reporter: { id: string; username: string; avatar_url: string | null };
  type: ViolationType;
  delta: number;                 // signed, actually applied; 0 before a verdict
  note: string | null;           // judge's short note — PUBLIC, like every field here
  claim: string | null;          // judge's account of the facts (required for penalties)
  session_id: number | null;     // originating 约局, if any
  statement: string | null;      // the subject's one statement
  statement_at: string | null;
  appeal_reason: string | null;  // why the subject contested; shown to the reviewing admin
  deadline_at: string | null;    // statement window close (sqlite datetime, UTC)
  status: CaseStatus;
  verdict: {
    source: 'ai' | 'fallback' | 'manual' | 'admin_override';
    headline: string; reasoning: string;
    factors: { kind: 'mitigating' | 'aggravating'; text: string }[];
  } | null;
  range: { min: number; max: number; base: number };
  created_at: string;
}

interface SessionItem {
  id: number;
  organizer: { id: string; username: string; avatar_url: string | null };
  title: string; game: string | null;
  starts_at: string;             // ISO 8601 UTC — NOT the sqlite datetime format
  duration_min: number | null; capacity: number | null; note: string | null;
  status: 'open' | 'cancelled' | 'settled';
  settled_at: string | null; created_at: string;
  counts: { going: number; maybe: number; out: number };
  my_rsvp: 'going' | 'maybe' | 'out' | null;
}

interface SessionDetail extends SessionItem { players: SessionPlayer[] }

interface SessionPlayer {
  user: { id: string; username: string; avatar_url: string | null };
  rsvp: Rsvp; rsvp_at: string;
  attendance: Attendance | null; late_minutes: number | null;
  attendance_note: string | null; record_id: number | null;
  is_participant: boolean;
}

interface CaseDraft {            // roll-call proposal; nothing is filed yet
  user_id: string; username: string;
  type: ViolationType; kind: 'penalty' | 'bonus';
  range: { min: number; max: number; base: number };
  suggested_claim: string; already_filed: boolean;
}

interface HistoryPoint { at: string; score: number; }
```

> **Timestamp formats are not interchangeable.** `created_at` / `deadline_at` use
> D1's `datetime('now')` shape (`YYYY-MM-DD HH:MM:SS`, UTC); `starts_at` is ISO
> 8601. SQL compares both as plain strings, so a query must use the matching
> format — `'T'` sorts above `' '`, which silently inverts same-day comparisons.

## Endpoints

Booleans in JSON are real booleans (convert D1's 0/1). All error responses:
`{ "error": string }` with an appropriate 4xx/5xx status.

### Public (no auth)
- `GET /api/config`
  → `{ violations, tiers, weeklyHeal, weeklyBonusCap, statementWindowHours, aiEnabled, nextResetAt }`
  Also fires (non-blocking) the weekly heal and the overdue-case sweep.
- `GET /api/leaderboard` → `{ participants: PublicUser[] }` — `is_participant = 1`, `score DESC, username ASC`.
- `GET /api/records?limit=&subject=&status=&session=&mine=pending`
  → `{ records: RecordItem[] }`, newest first. Default limit 50, max 200.
  `mine=pending` requires auth and returns only the caller's `awaiting_statement` cases.
- `GET /api/records/:id` → `{ record }`.
- `GET /api/users/:id` → `{ user: PublicUser, records: RecordItem[], history: HistoryPoint[] }`.
- `GET /api/sessions?scope=upcoming|past|mine` → `{ sessions: SessionItem[] }` (`mine` requires auth).
- `GET /api/sessions/:id` → `{ session: SessionDetail, records: RecordItem[] }`.
- `GET /api/avatar?u=<https url>` → proxied image (host must be the OAuth domain
  family, in `AVATAR_ALLOWED_HOSTS`, or an exact stored avatar URL).

### Auth
- `GET /auth/login` → 302 to the provider's `/oauth/authorize`; signed `state` in a short-lived cookie.
- `GET /auth/callback?code=&state=` → verify state, exchange code, fetch userinfo,
  upsert user (admin if username ∈ `ADMIN_USERNAMES`), set session cookie,
  302 to `/` (`?onboarding=1` when brand new).
- `POST /auth/logout` → clear cookie, `{ ok: true }`.

### Authenticated (session cookie)
- `GET /api/me` → `{ user: User | null, pending: { statements: number, appeals: number } }` (200 either way).
- `POST /api/me/roles` `{ is_participant?, is_judge? }` → `{ user }`.
- `POST /api/me/display-name` `{ display_name: string | null }` → `{ user }`.

**Cases**
- `POST /api/records` `{ subject_id, type, claim?, note? }` → `{ record }`. Requires `is_judge`.
  - reject self-reports, unknown types, non-participants;
  - penalties require `claim` (≥ `MIN_CLAIM_LEN`) and open `awaiting_statement` with `delta = 0`
    and `deadline_at = now + STATEMENT_WINDOW_HOURS`;
  - bonuses settle immediately at `base`, subject to `WEEKLY_BONUS_CAP`;
  - rate limits: ≤ 20 cases per reporter / 24h, ≤ 5 cases per subject / 24h → 429.
- `POST /api/records/:id/statement` `{ statement }` → `{ record }`. Subject only,
  `awaiting_statement` only, **once**. Claims the case atomically and runs the
  verdict synchronously, so the response already carries the judgment.
- `POST /api/records/:id/withdraw` → `{ record }`. Reporter (pre-verdict) or admin.
- `POST /api/records/:id/appeal` `{ reason? }` → `{ record }`. Subject, `decided` only.
  Sets `appealed`; score unchanged. `POST …/dispute` is a legacy alias.
- `POST /api/records/:id/revoke` → `{ record }`. Admin anytime, or the reporter
  within 15 min of creation. Reverses the applied delta.

**Sessions**
- `POST /api/sessions` `{ title, game?, starts_at, duration_min?, capacity?, note? }`
  → `{ session }`. Any signed-in user; the organizer is auto-RSVP'd `going`.
- `PATCH /api/sessions/:id` → `{ session }`. Organizer/admin, `open` only.
- `POST /api/sessions/:id/cancel` → `{ session }`.
- `POST /api/sessions/:id/rsvp` `{ rsvp }` → `{ session }`. Self only; blocked once
  the session started, is full, or is not `open`. The organizer cannot RSVP out.
- `POST /api/sessions/:id/rollcall` `{ entries: [{ user_id, attendance, late_minutes?, note? }] }`
  → `{ session, drafts: CaseDraft[] }`. Organizer/admin, after `starts_at`, only
  for signed-up players. **Writes attendance only — no score changes.** Repeatable
  until settlement.
- `POST /api/sessions/:id/settle` `{ file: [{ user_id, type?, claim? }], skip_all? }`
  → `{ session, created, skipped }`. Organizer/admin, once (409 afterwards).
  - `skip_all` or an empty `file` settles with **zero** score impact;
  - the violation type is always re-derived server-side from stored attendance;
    a client `type` is honoured only for `no_show → no_show_group`;
  - a non-judge organizer may file inside their own session unless
    `SESSION_ORGANIZER_CAN_FILE="false"`;
  - `organizer_bonus` is granted automatically when ≥ 2 people actually attended,
    still bounded by `WEEKLY_BONUS_CAP`.

### Admin (is_admin)
- `POST /api/admin/users/:id` `{ is_participant?, is_judge?, is_admin?, score?, delete? }` → `{ ok: true }`.
- `POST /api/admin/records/:id/override` `{ delta, reason }` → `{ record }`.
  `decided`/`appealed` only; delta is clamped to the violation range; the score
  moves by the difference so the record ends up worth exactly the new delta.
- `GET /api/admin/ai-config` → current config + `has_api_key` + 7-day health
  (`total`, `fallbackRate`, `clampRate`, `avgLatencyMs`). Never returns the key.
- `POST /api/admin/ai-config` `{ enabled?, base_url?, model?, temperature?, prompt? }`
  → `{ ok, enabled, prompt_version }`. Sending `api_key` is a 400 by design.
- `POST /api/admin/ai-config/test` `{ claim?, statement? }` → dry-run verdict.
  Writes nothing and touches nobody's score.

## AI judging

Request: `POST <AI_BASE_URL>/chat/completions`, OpenAI Chat Completions shape,
`response_format: {type:'json_object'}`, `temperature` from config. A `400` is
retried **once** without `response_format` (compatible endpoints vary in support).

Expected model output (schema is also spelled out in the system prompt):

```json
{"delta": -12, "headline": "…", "reasoning": "…",
 "factors": [{"kind":"mitigating|aggravating","text":"…"}], "confidence": 0.8}
```

Every call is audited in `ai_verdicts` (raw response, pre-clamp delta, applied
delta, `clamped` flag, latency, error). `judgeCase` **never throws**: any failure
resolves to `verdict_source='fallback'` carrying `def.base`, so a case always
reaches `decided` rather than stranding a player's score.

## scheduled() — weekly heal + case sweep
- `weeklyHeal`: local (RESET_TZ_OFFSET) Monday key in `weekly_heals` makes it
  idempotent; each participant gains `WEEKLY_HEAL` capped at 100, with a
  `score_events` row per changed user.
- `sweepDueCases`: judges `awaiting_statement` rows past `deadline_at` plus
  `judging` rows abandoned for > 2 minutes. Each case is claimed with a
  conditional `UPDATE … WHERE status = …`, so concurrent sweeps cannot
  double-judge. Capped at 5 per web request, 50 per cron run.

## Frontend expectations
- Fetch `/api/config`, `/api/leaderboard`, `/api/records`, `/api/me` on load, plus
  `/api/records?mine=pending` when `pending.statements > 0`.
- Import display constants from `@shared/scoring` and `@shared/attendance`.
- A pre-verdict case must never render its `delta` as `0` — show the pending range.
- `verdict.source === 'fallback'` must be visually distinct from `'ai'`; users
  should never mistake a base-score fallback for an actual AI judgment.
