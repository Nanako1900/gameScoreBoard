# EDG 信誉分 — 前后端契约 (single source of truth for implementers)

> Both the Worker (`worker/*`) and the React frontend (`src/*`) MUST match this
> document exactly. Scoring constants live in `shared/scoring.ts` and attendance
> mapping in `shared/attendance.ts` — import them, never re-hardcode. Do not
> invent new endpoints or field names.
>
> Design rationale — why the trial flow exists, the threat model, and why
> classification is a separate call: `docs/DESIGN-v2.md`, `docs/DESIGN-v3.md`.

## Stack

- Backend: Cloudflare **Worker** + **Hono** (`worker/index.ts` is `main`).
- Frontend: **React 18 + Vite** SPA in `src/`, builds to `./dist`.
- DB: **D1** (schema in `schema.sql`). Binding name `DB`.
- Static assets served via binding `ASSETS`; `run_worker_first = true`, so the
  Worker sees every request: it handles `/api/*` and `/auth/*`, and delegates
  everything else to `env.ASSETS.fetch(request)` (SPA fallback).
- Three idempotent background jobs run lazily from `GET /api/config` via
  `waitUntil` — weekly recovery, overdue-case judging, and last week's report — so
  a Cron Trigger is optional. If one fires, `scheduled()` runs the same jobs.

## Worker modules

| File | Responsibility |
|---|---|
| `worker/index.ts` | entrypoint, error mapping, `scheduled()` |
| `worker/routes.ts` | public + authenticated endpoints |
| `worker/routes-admin.ts` | admin-only endpoints (every handler starts with `requireAdmin`) |
| `worker/http.ts` | shared request narrowing / auth guards |
| `worker/db.ts` | users, roles, profile, `scoreMutation`, weekly heal |
| `worker/cases.ts` | statement → verdict → appeal / revoke / override + the sweep |
| `worker/case-filing.ts` | filing (single + batch) and the human overrides on the AI's category |
| `worker/case-reads.ts` | case reads + row→JSON mapping |
| `worker/case-limits.ts` | write-side validation and the per-day filing caps |
| `worker/sessions.ts` | 约局: create / RSVP / roll call / settle |
| `worker/invitable.ts` | invite candidates, including friends who are not on the board |
| `worker/session-invites.ts` | invite more people to an existing session without changing existing replies |
| `worker/session-extras.ts` | batch reads for invitation context, attendance summaries and going-player previews |
| `worker/ai/config.ts` | runtime AI config resolution (`app_settings` > env > default) |
| `worker/ai/prompt.ts` | prompt building, input sanitisation, verdict parsing |
| `worker/ai/provider.ts` | sentencing client (OpenAI-compatible), never throws |
| `worker/ai/classify.ts` | classification client — reads the judge's text ONLY |
| `worker/ai/report.ts` | weekly narrative; never does arithmetic |
| `worker/report.ts` | weekly stats (all SQL) + idempotent generation |
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
  ADMIN_SUBJECT_IDS?: string; // comma-separated OAuth subject ids -> is_admin on login
  ADMIN_USERNAMES?: string;  // deprecated; ignored once ADMIN_SUBJECT_IDS is set
  READ_ONLY?: string;        // '1' | 'true' = maintenance: writes + /auth/callback -> 503
  HOST_ONLY_COOKIES?: string; // '1' = __Host-edg_session / __Host-edg_oauth_state (no Domain)

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
  FRONTEND_ORIGIN?: string;
  FRONTEND_URL?: string;     // login returns here; when set (and not this origin), non-API paths 302 here (no-store)
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

- **Classification then sentencing, in that order and as two calls.** At filing
  time the AI reads the judge's `claim` alone and picks the type; the accused has
  written nothing yet, so they cannot influence which range applies — only the
  value inside it, via their statement. Merging the two calls would hand them the
  range. Multi-subject filings classify each accusation separately so text aimed
  at one defendant cannot colour another's category.
- An invalid, unknown or bonus type from the classifier becomes `other`
  (-10..0) — the softest band, so a classification failure can only ever help the
  accused. `no_show_group` is filed as `no_show` with `escalation_suggested = 1`
  and needs a human tap to promote.
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
  type: ViolationType | null;    // v3: usually chosen by the AI, always validated; null only when pending_hidden
  delta: number;                 // signed, actually applied; 0 before a verdict
  note: string | null;           // judge's short note — PUBLIC, like every field not marked PRIVATE (except while pending_hidden)
  claim: string | null;          // judge's account of the facts (required for penalties)
  claim_summary: string | null;  // AI's one-line condensation; the feed headline
  classified_by: 'ai' | 'fallback' | 'human' | 'derived';
  escalation_suggested: boolean; // AI wants no_show_group; a judge must co-sign
  session_id: number | null;     // originating 约局, if any
  statement: string | null;      // PRIVATE: the subject's one statement
  statement_at: string | null;   // public: whether (and when) they spoke up
  appeal_reason: string | null;  // PRIVATE: why the subject contested; for the reviewing admin
  deadline_at: string | null;    // statement window close (sqlite datetime, UTC)
  status: CaseStatus;
  verdict: {
    source: 'ai' | 'fallback' | 'manual' | 'admin_override';
    headline: string; reasoning: string;                         // PRIVATE
    factors: { kind: 'mitigating' | 'aggravating'; text: string }[]; // PRIVATE
  } | null;
  range: { min: number; max: number; base: number } | null;  // null only when pending_hidden
  created_at: string;
  // PRIVATE fields are for the case's subject, its reporter, judges and admins.
  // For anyone else (logged out included) every response blanks them —
  // statement / appeal_reason null, headline / reasoning '' and factors [] —
  // and sets `redacted: true` (whatever was there, so it never tells whether
  // an appeal reason exists). The verdict's words are covered because the AI
  // writes them after reading the statement and often quotes it — except a
  // bonus's 'manual' verdict, which is only its label and stays.
  redacted: boolean;
  // Before a verdict (`awaiting_statement`, `judging`) anyone else sees even
  // less, so a case is not presented as proven: type, range, claim,
  // claim_summary and note are null, escalation_suggested is false, and
  // `pending_hidden: true` is set (on top of `redacted: true`). id, subject,
  // reporter, delta (still 0), classified_by, session_id, statement_at,
  // deadline_at, status, verdict (still null) and created_at stay. In every other
  // case the key is absent.
  pending_hidden?: true;
}

interface SessionItem {
  id: number;
  organizer: { id: string; username: string; avatar_url: string | null };
  title: string; game: string | null;
  starts_at: string;             // ISO 8601 UTC — NOT the sqlite datetime format
  duration_min: number | null; capacity: number | null; note: string | null;
  status: 'open' | 'cancelled' | 'settled';
  settled_at: string | null; created_at: string;
  counts: { invited: number; going: number; maybe: number; out: number };
  my_rsvp: 'invited' | 'going' | 'maybe' | 'out' | null;
  going_preview: { id: string; username: string; avatar_url: string | null }[];  // up to GOING_PREVIEW_MAX (5) who said 来, earliest answer first; never a score
  cancel_reason: string | null;  // P2-3: the organizer's reason (trimmed, ≤ 80 chars); public like `note`
  cancelled_at: string | null;   // P2-3: sqlite datetime format; null if not cancelled (or cancelled before P2-3)
}

interface SessionDetail extends SessionItem { players: SessionPlayer[] }

// P2-3: GET /api/sessions?scope=history
interface HistorySessionItem extends SessionItem {
  attendance_summary: { on_time: number; late: number; no_show: number; left_early: number; excused: number }; // all five keys
}

// P2-3: GET /api/me/invites — the context is the caller's own, never shown elsewhere
interface InvitedSessionItem extends SessionItem {
  invite_reason: 'new' | 'moved';            // 'moved' = they had answered, then the time changed
  prev_rsvp: 'going' | 'maybe' | 'out' | null; // what they had said to the old time
  prev_starts_at: string | null;               // the old time (ISO), as they answered it
}

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

Routes returning cases (`/api/records`, `/api/records/:id`, `/api/users/:id`,
`/api/sessions/:id`) shape each case for the caller (see `RecordItem`'s PRIVATE
fields) and answer `Cache-Control: private, no-store`.
- `GET /api/config`
  → `{ violations, tiers, weeklyHeal, weeklyBonusCap, statementWindowHours, aiEnabled, maxBatchSubjects, nextResetAt, boardTzOffsetHours }`
  `boardTzOffsetHours` is `RESET_TZ_OFFSET` as a number of hours (default 8; may be fractional, e.g. 5.5): the board's
  time zone, the one `/yue` and the weekly reset use. Times are still sent as ISO instants; the web shows them on this clock.
  Also fires (non-blocking) three idempotent jobs: the weekly heal, the
  overdue-case sweep, and last week's report generation.
- `GET /api/leaderboard` → `{ participants: PublicUser[] }` — `is_participant = 1`, `score DESC, username ASC`.
- `GET /api/records?limit=&subject=&status=&session=&mine=pending`
  → `{ records: RecordItem[] }`, newest first. Default limit 50, max 200.
  `mine=pending` requires auth and returns only the caller's `awaiting_statement` cases.
- `GET /api/records/:id` → `{ record }`.
- `GET /api/users/:id` → `{ user: PublicUser, records: RecordItem[], history: HistoryPoint[] }`.
- `GET /api/sessions?scope=upcoming|past|mine` → `{ sessions: SessionItem[] }` (`mine` requires auth).
  `scope=history[&before=<id>]` → `{ sessions: HistorySessionItem[] }`: sessions that have started,
  **cancelled ones included** (`past` leaves them out), newest first (`starts_at`, then id), 20 a page;
  `before` is the last id of the previous page (an unknown id gives `[]`; not a positive integer → 400).
- `GET /api/sessions/:id` → `{ session: SessionDetail, records: RecordItem[] }`.
- `GET /api/avatar?u=<https url>` → proxied image (worker/avatar.ts). The host
  must be exactly the OAuth host or one in `AVATAR_ALLOWED_HOSTS`, or the URL must
  be an exact stored avatar URL; this app's own hosts, IP literals and localhost
  are refused. Up to 2 redirects, each re-checked. Only png / jpeg / gif / webp /
  avif up to 2 MB (else 415 / 502), served with `nosniff` and
  `Content-Security-Policy: default-src 'none'; sandbox`.
- CSRF: non-GET requests to `/api/*` and `/auth/*` with a form-like or missing
  Content-Type must have `Sec-Fetch-Site: same-origin` or an `Origin` equal to
  the request origin, `APP_URL`, or a `FRONTEND_ORIGIN` entry → else
  403 `{ error: '请求来源不被允许' }`. JSON requests are left to CORS preflight.

### Auth
- `GET /auth/login` → 302 to the provider's `/oauth/authorize`; signed `state` in a short-lived cookie.
- `GET /auth/callback?code=&state=` → verify state, exchange code, fetch userinfo,
  upsert user (admin if `sub` ∈ `ADMIN_SUBJECT_IDS`; while that is unset, if username ∈ `ADMIN_USERNAMES`), set session cookie,
  302 to `/` (`?onboarding=1` when brand new).
- `POST /auth/logout` → clear cookie, `{ ok: true }`.

### Authenticated (session cookie)
- `GET /api/me` → `{ user: User | null, pending: { statements: number, appeals: number } }` (200 either way).
- `POST /api/me/roles` `{ is_participant?, is_judge? }` → `{ user }`.
- `POST /api/me/display-name` `{ display_name: string | null }` → `{ user }`.
- `GET /api/me/invitable` → `{ users: InvitableUser[] }`, `Cache-Control: private, no-store`
  (P2-2). Everyone but the caller (at most 500), each exactly `{ id, username,
  avatar_url, is_participant, last_played_with_me_at }` — `username` is the display
  name; never a score, a role, an email or anything about Discord.
  `last_played_with_me_at` is the `starts_at` of the latest session that has started,
  was not cancelled, and where both said `going` and neither was marked `no_show` /
  `excused` (unmarked counts as there); `null` if none. Order: people played with
  (latest first), then participants, then name, then id. 401 signed out. An older
  API answers 404: the client hides the invite entry.

**Cases**
- `POST /api/records` — two shapes, both requiring `is_judge`:
  - **v3 default (batch, AI classifies):** `{ subject_ids: string[], claim, extras?, note? }`
    → `{ records: RecordItem[], failed: { subject_id, error }[] }`.
    One case per subject, each classified by its own AI call. `extras[subject_id]`
    is appended to that person's claim as `补充：…`. Max `maxBatchSubjects` (8).
    **Partial failure is not an error**: an invalid subject lands in `failed` and
    the rest are still filed, so a judge never loses everything they typed.
  - **Deterministic (single):** `{ subject_id, type?, claim?, note? }` → `{ record, records, failed }`.
    Used by roll-call settlement, bonuses, and corrections. Omitting `type` here
    also triggers AI classification.
  - Common rules: reject self-reports, unknown types, non-participants; penalties
    require `claim` (≥ `MIN_CLAIM_LEN`) and open `awaiting_statement` with
    `delta = 0` and `deadline_at = now + STATEMENT_WINDOW_HOURS`; bonuses settle
    immediately at `base` under `WEEKLY_BONUS_CAP`; rate limits ≤ 40 cases per
    reporter / 24h and ≤ 5 per subject / 24h → 429.
- `POST /api/records/:id/escalate` → `{ record }`. Filing judge or admin; promotes
  a flagged case to `no_show_group`. `awaiting_statement` only — after a verdict
  the subject argued against the lesser charge, so re-sentencing is an admin override.
- `POST /api/records/:id/escalate/dismiss` → `{ record }`. Keep the lesser charge.
  Same rules as `escalate`: filing judge or admin, a flagged case, `awaiting_statement`
  only (400 otherwise), 409 if it changed meanwhile.
- `POST /api/records/:id/reclassify` `{ type }` → `{ record }`. Filing judge or
  admin overrides the AI's category, pre-verdict, penalties only. A roll-call case
  (filed by settling a session) may only move between `no_show` and
  `no_show_group` unless an admin does it — the charge follows the roll call.
- `POST /api/records/:id/statement` `{ statement }` → `{ record }`. Subject only,
  `awaiting_statement` only, **once**. Claims the case atomically and runs the
  verdict synchronously, so the response already carries the judgment.
- `POST /api/records/:id/withdraw` → `{ record }`. Reporter (pre-verdict) or admin.
- `POST /api/records/:id/appeal` `{ reason? }` → `{ record }`. Subject, `decided` only.
  Sets `appealed`; score unchanged. `POST …/dispute` is a legacy alias.
- `POST /api/records/:id/revoke` → `{ record }`. Admin anytime, or the reporter
  within 15 min of creation. Reverses the applied delta.

**Sessions**
- `POST /api/sessions` `{ starts_at, invite?, title?, game?, duration_min?, capacity?, note? }`
  → `{ session }`. Any signed-in user. Only `starts_at` is required — the title is
  **synthesised server-side** from the time (a client cannot inject one). Everyone
  in `invite` (max 20) lands in `rsvp='invited'`; unknown ids are dropped rather
  than failing creation. The organizer is auto-RSVP'd `going`. **429** when the
  organizer already has 5 open sessions still ahead, or created 10 in the last
  24 h (checked again inside the write, so parallel creates cannot slip past).
  `starts_at` may not be in the past (5 minutes' grace) nor more than 90 days ahead.
- `PATCH /api/sessions/:id` → `{ session }`. Organizer/admin, `open` only, and only
  before it starts (400 afterwards). A new `starts_at` (a different instant, not
  just another spelling) puts every other player — yes, maybe or no — back to
  `invited`: they answer again for the new time.
- `POST /api/sessions/:id/cancel` `{ reason? }` → `{ session }`. The body is optional (none = no
  reason). `reason` is trimmed and cut to 80 characters; blank or not a string → null. Stored with
  `cancelled_at`; cancelling again changes neither. The cancel DM quotes it.
- `POST /api/sessions/:id/invite` `{ user_ids: string[] }` → `{ session, added, skipped }` (P2-1).
  Invite more people after creation. Organizer/admin (403 first, like `PATCH`), `open`
  and not started (400). `user_ids` is required and not empty; at most 20 distinct ids
  at once, the session's organizer dropped (nobody left → 200 with `added: 0`). The
  roster never grows past 50 by invitation (400 「这局最多 50 人，已经有 N 人了」).
  New people land in `invited`; a row already there — going, maybe, out or invited — is
  never touched, and unknown ids are dropped. `added` = rows inserted, `skipped` = the
  other requested ids. On PostgreSQL each new row queues one invitation DM under the
  same allowances as at creation; nothing in the answer says who can be reached by DM.
- `POST /api/sessions/:id/rsvp` `{ rsvp, starts_at? }` → `{ session }`. Self only, and only
  `going | maybe | out` — `invited` is organizer-assigned and rejected here.
  `starts_at` is the start time the client showed: for `going` / `maybe`, **409**
  if the session has moved since (nothing is written; reload and answer again).
  Omitted, the answer is to the current time (but still 409 if a move lands
  between the read and the write).
  Blocked once the session started, is full, or is not `open`. The organizer
  cannot RSVP out. **Only `going` consumes a capacity slot**, so over-inviting is
  intentional and safe.
- `GET /api/me/invites` → `{ sessions: InvitedSessionItem[] }`. Open, future sessions the
  caller was invited to and has not answered. Drives the one-tap invite banner. Each says why:
  `invite_reason: 'moved'` with `prev_rsvp` / `prev_starts_at` when the caller had answered and the
  time then changed (a later move keeps the time they answered; answering again clears it), else `'new'`.
- `POST /api/sessions/:id/rollcall` `{ entries: [{ user_id, attendance, late_minutes?, note? }] }`
  → `{ session, drafts: CaseDraft[] }`. Organizer/admin, after `starts_at`, only
  for signed-up players. **Writes attendance only — no score changes.** Repeatable
  until settlement.
- `POST /api/sessions/:id/settle` `{ file: [{ user_id, type?, claim? }], skip_all? }`
  → `{ session, created, skipped }`. Organizer/admin, once (409 afterwards).
  - `skip_all` or an empty `file` settles with **zero** score impact;
  - only players who answered `going` are filed against — penalties and the
    `on_time_bonus` alike (an invitee or a `maybe` made no promise);
  - the violation type is always re-derived server-side from stored attendance;
    a client `type` is honoured only for `no_show → no_show_group`;
  - a non-judge organizer may file inside their own session unless
    `SESSION_ORGANIZER_CAN_FILE="false"`;
  - `organizer_bonus` is granted automatically when ≥ 2 people who answered
    `going` actually attended, still bounded by `WEEKLY_BONUS_CAP`.

### Weekly report
- `GET /api/report/latest` → `{ report: WeeklyReport | null }` (public, read-only).
  `null` is normal — first week, or nothing has happened yet.
- Every figure in `stats` is computed in SQL (`worker/report.ts`); the AI writes
  only `narrative`. It is never asked to add, rank or compare a number.
- Generation is idempotent via the `weekly_reports` primary key, and the row is
  claimed with the deterministic fallback text BEFORE the AI call, so a
  Monday-morning rush produces one narrative rather than one per visitor.
- Last week's report is written from **Monday 10:30** board time on (not at
  midnight), and once every case filed that week has been judged — waiting at
  most one statement window past the week's end, plus an hour — so a case
  filed late on Sunday is counted (cases filed, total penalty) in its week. On
  the Worker the lazy job runs after the overdue-case sweep for that reason.
  本周之星 / 鸽王 count score movement within the week (a case judged on Monday
  moves next week's), and neither the weekly heal nor an admin's corrections.
  Until last week's report is out, `/api/report/latest` is the one before.
- On the Node backend, a newly written report is posted to the Discord verdict
  channel (once per week, the latest finished week only) and a rewrite edits
  that post.

### Admin (is_admin)
- `POST /api/admin/report/:week/regenerate` → `{ report }`. Re-roll the narrative
  for `YYYY-MM-DD` (a local Monday); recomputes the stats too. Only a finished
  week: a non-Monday or a week still running is a 400.
- `POST /api/admin/users/:id` `{ is_participant?, is_judge?, is_admin?, score?, delete? }` → `{ ok: true }`.
  `score` sets it by hand (clamped to 0–100, logged as `admin_adjust`); on the
  Node backend a real change DMs the player if they are bound (old → new). The
  player page offers it to admins (type the number, then confirm).
- `POST /api/admin/records/:id/override` `{ delta, reason }` → `{ record }`.
  `decided`/`appealed` only; delta is clamped to the violation range; the score
  moves by the difference so the record ends up worth exactly the new delta.
- `GET /api/admin/ai-config` → current config + `has_api_key` + 7-day health
  (`total`, `fallbackRate`, `clampRate`, `avgLatencyMs`). Never returns the key.
- `POST /api/admin/ai-config`
  `{ enabled?, base_url?, model?, temperature?, prompt?, classify_prompt?, report_prompt? }`
  → `{ ok, enabled, prompt_version }`. Sending `api_key` is a 400 by design.
  Three prompts, all hot-editable: sentencing, classification, weekly narrative.
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
- A pre-verdict case must never render its `delta` as `0` — show the pending
  range, or 判决后公开 when the API hid it (`pending_hidden`). Such a case says
  only that it exists — for a subject named 老王, 「老王有一起记录在处理中，判决后公开。」
  — and its feed row shows only the name and 「处理中」.
- Prefer `claim_summary` over the raw `claim` for headlines; fall back to the type
  label when it is null (pre-v3 rows).
- An invitation is an action the user owes, so the invite banner outranks the
  weekly report on the page.
- `verdict.source === 'fallback'` must be visually distinct from `'ai'`; users
  should never mistake a base-score fallback for an actual AI judgment.
- Links into the app (the bot's DMs and replies use them) stay valid for ever:
  `/?session=<id>` and `/?case=<id>`. Only a positive integer id is read
  (anything else is ignored and simply stripped), and the parameter is
  translated into that view's own address: `/?session=<id>` becomes
  `/sessions/<id>`; `/?case=<id>` looks the case up once
  (`GET /api/records/<id>`) and becomes
  `/players/<subject>/cases/<id>`, where that case is moved (not copied) to the
  top of its subject's page, scrolled to the centre and focused. Other query
  parameters (`utm`, …) are kept. The link only picks which ordinary view
  opens — what it shows and which controls come from the API and `/api/me` as
  always. A link never writes. A case that is gone leaves you on `/` with
  「链接里的案件不存在了。」 (any other failure: 「打不开链接里的案件，稍后再试。」).
  These parameters are read on `/` only. `?linked=discord` is stripped and shows
  the Discord-linked notice; `?onboarding=1` (on any path) opens the first-login
  dialog first, and the link's target opens once it is closed.
- Routes (`src/lib/routes.ts` parses, `src/lib/router.ts` owns `history`; no
  router library). Only these exist; every other path renders the front-end
  page 「这页不存在」 with a 「回大厅」 link:

  | Path | Phone (< 1024px) | Desktop (≥ 1024px) |
  |---|---|---|
  | `/` | the hall | the hall |
  | `/sessions/<id>` | a page with a sticky 「‹ 返回」 bar | a right-hand drawer over the hall |
  | `/players/<userId>` | a page with a sticky 「‹ 返回」 bar | a right-hand drawer over the hall |
  | `/players/<userId>/cases/<id>` | that player's page, the case moved to the top and focused | the same, in the drawer |
  | `/cases/<id>` | alias: looks the case up once, then replaces itself with the row above | the same |

  Numeric ids match `^[1-9]\d{0,14}$` (so `/sessions/07` is not a session). A
  user id is the OAuth subject: non-empty, at most 128 characters, no NUL,
  always `encodeURIComponent`-ed in the path. When a case's `subject.id` is not
  the `<userId>` in the address, the address is replaced with the subject's —
  never an error. Not found: `/sessions/<id>` → 「找不到这局，链接可能写错了。」;
  `/players/<userId>` → 「找不到这位选手。」; a case → 「链接里的案件不存在了。」, any
  other failure → 「打不开链接里的案件，稍后再试。」. A cancelled session is not a
  404; it shows as cancelled.
- No route starts with `/api`, `/auth` or `/link` (those belong to the API), and
  routing never uses the hash: a `popstate` that only changed the hash is
  ignored. Every host must serve `index.html` for any other path (SPA
  fallback), so the build output must never contain a `404.html`
  (`npm run build:pages` fails if it does).
- History. Every entry the router writes carries `history.state.edg === 1`
  (plus `idx`; an overlay's entry also `sheet` and `layer`; `y` is the scroll
  position to restore). Opening a deep address without that mark (a new tab, a
  bookmark, a link from Discord) puts one `/` entry under it, once — reloading
  never adds another, so one back from such an address reaches the hall. An
  overlay (a sheet or a dialog; the routed drawers are addresses of their own)
  adds one entry at the same address: the back key closes only the topmost
  overlay (one that holds a draft asks first, and keeps its entry if the user
  stays), and closing it from the UI goes back over its entry silently, so the
  next back behaves as if it had never opened. A reload never reopens an
  overlay. `history.scrollRestoration` is `manual`: going back
  restores the scroll position the entry was left at.
- Login return. Right before the top-level jump to the API's `/auth/login`, the
  current address (path and query, no hash) is saved as JSON in
  `sessionStorage['edg.return']` (a page not worth coming back to — `/` or an
  unknown path — saves nothing and drops any old value; a lobby row's
  「登录后报名」 saves that session's address instead), e.g.
  `{"v":1,"path":"/sessions/5","savedAt":1761500000000,"intent":{"kind":"rsvp","sessionId":5,"rsvp":"going"}}`
  (`intent` only when a visitor pressed 来 / 待定 / 不来). On the first signed-in
  load (the OAuth callback lands on `/`; after the first-login dialog, if one
  opens) it is read once and always deleted; a valid one saved less than 30
  minutes ago opens that address. It is only ever an in-app path — at most 512
  characters, starts with `/` but not `//`, no `\` or `#`, an app route other
  than `/` — so it can never become an open redirect. The intent only becomes
  a hint, 「你登录前点的是「来」，确认一下？」: nothing is sent until the user
  presses the button again. A legacy `?case=` / `?session=` link wins over it;
  logging out clears it.
- A case with `redacted: true` says a statement exists (when `statement_at` is
  set) rather than calling it a verdict in absence, and shows no verdict words.
