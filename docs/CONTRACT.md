# EDG 信誉分 — 前后端契约 (single source of truth for implementers)

> Both the Worker (`worker/*`) and the React frontend (`src/*`) MUST match this
> document exactly. Scoring constants live in `shared/scoring.ts`; historical
> case reclassification rules live in `shared/attendance.ts` — import them, never re-hardcode. Do not
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
| `worker/ai/config.ts` | runtime AI config resolution (`app_settings` > env > default) |
| `worker/ai/prompt.ts` | prompt building, input sanitisation, verdict parsing |
| `worker/ai/provider.ts` | sentencing client (OpenAI-compatible), never throws |
| `worker/ai/classify.ts` | classification client — reads the judge's text ONLY |
| `worker/ai/report.ts` | weekly narrative; never does arithmetic |
| `worker/report.ts` | weekly stats (all SQL) + idempotent generation |
| `worker/voice.ts` | private voice history and day roster reads, shared by D1 and PostgreSQL |
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

  // AI 裁决 — saved provider settings override env; credentials are encrypted in app_settings.
  AI_ENABLED?: string;
  AI_BASE_URL?: string;      // must end at /v1; code appends /chat/completions
  AI_MODEL?: string;
  AI_API_KEY?: string;       // legacy fallback only when credential row is absent
  AI_CONFIG_MASTER_KEY?: string; // external Base64 32-byte master; identical in app + bot
  AI_SYSTEM_PROMPT?: string;
  AI_TEMPERATURE?: string;
  STATEMENT_WINDOW_HOURS?: string;     // default 12

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
- **Bonus types** remain in `VIOLATIONS` only for historical records; new manual filings reject them with 400 「加分类型已停用」. Rules list penalties only.
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
  session_id: number | null;     // originating historical session, if any; read-only context is retained
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

interface HistoryPoint { at: string; score: number; }
```

> **Timestamp formats are not interchangeable.** `created_at` / `deadline_at` use
> D1's `datetime('now')` shape (`YYYY-MM-DD HH:MM:SS`, UTC); historical session
> `starts_at` is ISO 8601. SQL compares both as plain strings, so a query must use the matching
> format — `'T'` sorts above `' '`, which silently inverts same-day comparisons.

## Endpoints

Booleans in JSON are real booleans (convert D1's 0/1). All error responses:
`{ "error": string }` with an appropriate 4xx/5xx status.

### Public (no auth)

Routes returning cases (`/api/records`, `/api/records/:id`, `/api/users/:id`)
shape each case for the caller (see `RecordItem`'s PRIVATE
fields) and answer `Cache-Control: private, no-store`.
- `GET /api/config`
  → `{ violations, tiers, weeklyHeal, statementWindowHours, aiEnabled, maxBatchSubjects, nextResetAt, boardTzOffsetHours }`
  `boardTzOffsetHours` is `RESET_TZ_OFFSET` as a number of hours (default 8; may be fractional, e.g. 5.5): the board's
  time zone used by the weekly reset and report boundaries.
  Also fires (non-blocking) three idempotent jobs: the weekly heal, the
  overdue-case sweep, and last week's report generation.
- `GET /api/leaderboard` → `{ participants: PublicUser[] }` — `is_participant = 1`, `score DESC, username ASC`.
- `GET /api/records?limit=&subject=&status=&session=&mine=pending`
  → `{ records: RecordItem[] }`, newest first. Default limit 50, max 200.
  `mine=pending` requires auth and returns only the caller's `awaiting_statement` cases.
- `GET /api/records/:id` → `{ record }`.
- `GET /api/users/:id` → `{ user: PublicUser, records: RecordItem[], history: HistoryPoint[] }`.
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

**Discord binding (Node-only)**

These authenticated endpoints are served by `server/src/link-routes.ts`, not the Worker.
When Discord binding is disabled, they return 404; the SPA hides unsupported controls.

- `GET /api/me/discord` → `{ link }`, unchanged. An unbound caller gets `link: null`;
  a bound caller receives their existing private binding view, including `discord_username`,
  `notify_dm` and `dm_ok`. The nickname is visible only to its owner; no Discord user ID
  or channel ID is returned. Responses are `Cache-Control: no-store`.
- `POST /api/me/discord/notify` `{ on: boolean }` → `{ link }`. The same switch as `/notify`;
  unbound is 409, a missing or invalid `on` is 400. Enabling also reopens `dm_ok` for another try.
- `POST /api/me/discord/unlink` → `{ ok: true, removed: boolean }`.
- `POST /api/me/discord/welcome` → `{ ok: true }`. Queue a new welcome guide for the caller;
  401 if signed out, 409 if unbound or notifications are off (「先打开私信通知」),
  429 after 3 manual retries per rolling 24 hours (「24 小时内已经重发 3 次，稍后再试」),
  and 503 in read-only mode. Automatic binding welcomes do not count toward this quota;
  manual attempts count whether queued, sent, skipped or dead. PostgreSQL atomically checks
  the quota, sets `dm_ok = 1`, emits `dm.welcome` and wakes the dispatcher, so concurrent
  requests cannot spend the same remaining slot. Success means queued, not delivered.

All three POST endpoints return 503 in read-only mode and enforce the existing CSRF policy.
No per-message delivery tracking or onboarding completion field is added to the GET response.

**Cases**
- `POST /api/records` — two shapes, both requiring `is_judge || is_admin` (裁判或管理员):
  - **v3 default (batch, AI classifies):** `{ subject_ids: string[], claim, extras?, note? }`
    → `{ records: RecordItem[], failed: { subject_id, error }[] }`.
    One case per subject, each classified by its own AI call. `extras[subject_id]`
    is appended to that person's claim as `补充：…`. Max `maxBatchSubjects` (8).
    **Partial failure is not an error**: an invalid subject lands in `failed` and
    the rest are still filed, so the caller never loses everything they typed.
  - **Deterministic (single):** `{ subject_id, type?, claim?, note? }` → `{ record, records, failed }`.
    Used when the caller already knows a penalty type. Omitting `type` here
    also triggers AI classification; explicit bonus types return 400 「加分类型已停用」.
  - Common rules: reject self-reports, unknown types, non-participants; penalties
    require `claim` (≥ `MIN_CLAIM_LEN`) and open `awaiting_statement` with
    `delta = 0` and `deadline_at = now + STATEMENT_WINDOW_HOURS`; rate limits ≤ 40 cases per
    reporter / 24h and ≤ 5 per subject / 24h → 429.
- `POST /api/records/:id/escalate` → `{ record }`. Filing judge or admin; promotes
  a flagged case to `no_show_group`. `awaiting_statement` only — after a verdict
  the subject argued against the lesser charge, so re-sentencing is an admin override.
- `POST /api/records/:id/escalate/dismiss` → `{ record }`. Keep the lesser charge.
  Same rules as `escalate`: filing judge or admin, a flagged case, `awaiting_statement`
  only (400 otherwise), 409 if it changed meanwhile.
- `POST /api/records/:id/reclassify` `{ type }` → `{ record }`. Filing judge or
  admin overrides the AI's category, pre-verdict, penalties only. A historical roll-call case
  (`classified_by = 'derived'`) may only move between `no_show` and
  `no_show_group` unless an admin does it — the charge follows the roll call.
- `POST /api/records/:id/statement` `{ statement }` → `{ record }`. Subject only,
  `awaiting_statement` only, **once**. Claims the case atomically and runs the
  verdict synchronously, so the response already carries the judgment.
- `POST /api/records/:id/withdraw` → `{ record }`. Reporter (pre-verdict) or admin.
- `POST /api/records/:id/appeal` `{ reason? }` → `{ record }`. Subject, `decided` only.
  Sets `appealed`; score unchanged. `POST …/dispute` is a legacy alias.
- `POST /api/records/:id/revoke` → `{ record }`. Admin anytime, or the reporter
  within 15 min of creation. Reverses the applied delta.

### Voice evidence (D1 and PostgreSQL)

These read-only endpoints run on both backends, including during maintenance.
Responses use `Cache-Control: private, no-store`. Both require a
session (401 if signed out). Permission denial is 404, before date validation or target lookup.

- `GET /api/voice?user=&from=&to=` → `VoiceHistoryResponse` from `shared/voiceApi.ts`:
  `{ user, days, gaps, retention_days }`. `user` is required and is a Nanako user ID.
  The caller can read their own history; judges and admins can read another existing user.
  A nonexistent user is 404. A missing or NUL-containing user ID is 400; IDs are not trimmed.
  `from` and `to` are board dates (`YYYY-MM-DD`), both included, with a default last 7 days.
  An explicit `to` anchors the default start six dates earlier; omitted `to` means today.
- `GET /api/voice/day?date=` → `VoiceDayResponse` from the same module:
  `{ date, users, gaps, retention_days }`. Judges and admins only; everyone else gets 404.
  `date` defaults to today in the board's fixed offset (`boardTzOffsetHours`). Each entry
  contains `user`, `first_join`, `total_min`, `in_voice_now`, `has_open_segment`.
  Sort by first join ascending, null last, then Nanako user ID for ties.

Both validate real calendar dates and at most 31 inclusive board dates; malformed,
reversed or longer ranges return 400. Range starts before the rolling 90-day cutoff
(`now - 90 days`, compared in UTC) also return 400 with the first available board date.
Even a partly expired first date is rejected: `firstAvailableVoiceDate` in
`shared/voiceDays.ts` supplies the first complete queryable date, also used for the date picker minimum.
`retention_days` comes from `VOICE_RETENTION_DAYS` in `shared/voice.ts`.

The public `user` reference contains only `{ id, username, avatar_url }`; names are the
Nanako display name or username. History `days` contain `{ date, first_join, total_min, segments }`.
Each segment has only `{ channel_name, joined_at, left_at, start_reason, end_reason, continued }`:
no Discord account IDs or channel IDs, and no database row IDs. All timestamp strings,
including gap endpoints `{ from, to }`, are second-resolution UTC `YYYY-MM-DD HH:MM:SS`;
`date` is a board calendar date. Web and bot convert times using the board's offset, never the device's zone.

Daily totals clip each segment to the selected board day and fixed query time, sum seconds for each day, then floor once to minutes.
A segment crossing midnight appears on both days; `continued` means it began before that day.
`first_join` is the earliest actual join begun on that day, or null if there is no such join.
A nonempty day with only continued segments displays 「接上一天」; an empty day displays 「首次 —」.
Original segment timestamps stay intact. Every requested day is returned, including empty days.
An open segment is capped at the fixed query time for arithmetic and displayed with 「尚未记录离开」 and
「时长按查询时刻估算」. `bot_online` adds 「机器人上线时已在语音里」;
`bot_offline` adds 「之后机器人离线，离开时间不确定」.

`gaps` are the complement of the union of persisted `[started_at, last_seen_at]` coverage intervals,
clipped to the requested range up to the fixed query time. Readers never extend coverage to the query time,
even when the last heartbeat is recent. Readers take coverage snapshots before and after the segment read
and use their interval-set intersection. New checkpoints cannot certify an earlier, incomplete segment read,
and coverage withdrawn by a concurrent retention cleanup cannot survive alongside already-deleted segments.
A day row's `in_voice_now` is true only for an open segment on the current
board day whose query time is inside persisted coverage. `has_open_segment` alone only means
「尚未记录离开」. History details never label an unclosed segment as online.

Render gaps visibly, with second-resolution endpoints and 「这段时间机器人不在线，没有记录不代表没来。」.
Keep the qualifier 「未覆盖表示缺少完整证据，也可能来自记录清理或尚未持久化的心跳尾段。」
on the web and bot, including truncated bot output; a gap is not a claim that the Gateway was definitely offline.
An empty result says 「没有保存的语音记录，不代表没来」: the requested period may predate binding,
or records may have expired or be unavailable.
Neither a gap nor an empty day proves absence.

### Retired scheduling data

Scheduling and invitation API routes have been removed and return the existing 404 response.
`game_sessions` and `session_players`, their historical rows and `records.session_id` remain.
`worker/cases.ts` keeps its read-only historical context lookup; `GET /api/records` still accepts
`session` to filter those records. There is no new scheduling, attendance, settlement or bonus entry.

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
  most one statement window past the week's end, plus an hour. Cases, total
  penalty and 最会说话 count the week a case was judged — its first
  `record:<id>` score event for the subject; older rows without that event fall
  back to when they were filed. New stats carry `basis: 'verdict'`; reports
  written before this change keep the numbers they were written with. On the
  Worker the lazy job still runs after the overdue-case sweep.
  本周之星 / 鸽王 count score movement within the week (a case judged on Monday
  moves next week's), and neither the weekly heal nor an admin's corrections.
  Until last week's report is out, `/api/report/latest` is the one before.
- New `stats` contain `basis`, `weekStart`, `weekEnd`, `casesFiled`, `totalPenalty`,
  `absentVerdicts`, `star`, `pigeon`, `bestTalker` and `harshest`. They do not query
  `game_sessions` / `session_players` or include `sessionsPlayed`, `sessionsCollapsed`,
  `attendanceRate`, `topOrganizer` or `upcomingNextWeek`; a week with only old scheduling
  activity does not generate a new report. AI input and the fallback narrative omit those figures.
- Stored reports keep their original JSON and narrative. Web and Discord continue to read old
  reports; any historical scheduling figures they display are hidden when absent or zero.
  Admin-customized report prompts are not rewritten.
- On the Node backend, a newly written report is posted to the Discord verdict
  channel (once per week, the latest finished week only) and a rewrite edits
  that post.

### Admin (is_admin)
- `GET /api/admin/users` → `{ users: AdminUserRow[], truncated: boolean }`.
  Includes unlisted accounts (judges and visitors as well as participants), ordered by
  `created_at DESC, id ASC`. Read at most 501 rows, return at most 500; `truncated` is
  true only when a 501st row exists. No pagination or server-side search parameters.
  `AdminUserRow` contains exactly `id`, `username` (effective display name, falling back
  to the OAuth account name), `avatar_url`, `is_participant`, `is_judge`, `is_admin`,
  `score`, `created_at`; role flags are booleans and registration is UTC text.
  Returns no email, OAuth username or Discord fields. `Cache-Control: private, no-store`
  applies to success and denial responses; 401 when signed out, 403 for non-admins.
  Available on both D1 and PostgreSQL, including read-only mode.
- `POST /api/admin/report/:week/regenerate` → `{ report }`. Re-roll the narrative
  for `YYYY-MM-DD` (a local Monday); recomputes the stats too. Only a finished
  week: a non-Monday or a week still running is a 400.
- `POST /api/admin/users/:id` `{ is_participant?, is_judge?, is_admin?, score?, delete? }` → `{ ok: true }`.
  `score` sets it by hand (clamped to 0–100, logged as `admin_adjust`); on the
  Node backend a real change DMs the player if they are bound (old → new). The
  player and members pages link admins to `/tools/score?user=<encoded Nanako ID>`
  (type the number, then confirm on that tool page).
  These existing backend capabilities remain available; the members UI has
  no delete, admin-grant or participant-toggle controls.
- `POST /api/admin/records/:id/override` `{ delta, reason }` → `{ record }`.
  `decided`/`appealed` only; delta is clamped to the violation range; the score
  moves by the difference so the record ends up worth exactly the new delta.
- All three AI admin routes require an administrator and return `Cache-Control: private, no-store`.
- `GET /api/admin/ai-config` → current config + `has_api_key`,
  `api_key_source: 'database' | 'environment' | 'none'`, `configured_enabled`,
  `can_update_api_key`, `disabled_reason` + 7-day health
  (`total`, `fallbackRate`, `clampRate`, `avgLatencyMs`). `enabled` means actually
  available; `configured_enabled` preserves the saved switch even without a
  usable key. No credential plaintext or ciphertext is returned.
- `POST /api/admin/ai-config`
  `{ enabled?, base_url?, model?, api_key?: string | null, temperature?, prompt?, classify_prompt?, report_prompt? }`
  → `{ ok, enabled, prompt_version }`. Omitted `api_key` preserves the credential;
  a nonempty string replaces it; `null` explicitly clears it. Reject NUL/CR/LF
  before trimming, then reject empty or over-4096-character keys. Validate every
  field and encrypt before one atomic `db.batch()`; any failure leaves all settings
  unchanged. Keep `updated_by` / `updated_at`, never log key contents.
  Three prompts, all hot-editable: sentencing, classification, weekly narrative.
- `POST /api/admin/ai-config/test` `{ claim?, statement? }` → dry-run verdict
  using saved configuration. No `raw` response; writes nothing and touches nobody's score.

`ai.api_key_encrypted` in the existing `app_settings` stores a versioned JSON
AES-256-GCM envelope `{v:1,state:'set',iv,ciphertext}` or the explicit clear marker
`{v:1,state:'cleared'}`. The external `AI_CONFIG_MASTER_KEY` is Base64-encoded
32-byte randomness shared by app and bot; each encryption has a random 12-byte IV,
128-bit authentication tag and fixed AAD `edg-credit:ai.api_key:v1`. No SQL migration.
The old plaintext `ai.api_key` row is ignored. Only an absent credential row may
fall back to legacy `AI_API_KEY`; clearing or unreadable ciphertext never revives it.
Without a usable master, ordinary settings and explicit clearing remain available,
but setting/replacing a key fails without writing. Missing/mismatched master or
corrupt ciphertext disables AI safely; `/api/config` remains readable. Restoring
the original master recovers the same ciphertext. App and bot load committed
settings on each call with no process cache, so future calls see saved changes.

## AI judging

Request: `POST <AI_BASE_URL>/chat/completions`, OpenAI Chat Completions shape,
`response_format: {type:'json_object'}`, `temperature` from config. A `400` is
retried **once** without `response_format` (compatible endpoints vary in support).

Expected model output (schema is also spelled out in the system prompt):

```json
{"delta": -12, "headline": "…", "reasoning": "…",
 "factors": [{"kind":"mitigating|aggravating","text":"…"}], "confidence": 0.8}
```

Every call is audited in `ai_verdicts` (filtered response, pre-clamp delta, applied
delta, `clamped` flag, latency, error). Classification, sentencing and weekly
narrative clients filter the active key's exact text from upstream content before
it reaches errors, audits, verdicts or reports; configuration failures use fixed
messages. The historical column name `raw_response` holds filtered content. `judgeCase` **never throws**: any failure
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

## Voice storage

The recorder writes PostgreSQL; the Worker reads the same table shapes through D1 or the PG adapter.
`server/migrations/0010_voice.sql`, `migrations/005_voice.sql` and fresh-install `schema.sql` agree:

- `voice_sessions`: identity `id`; Nanako `user_id` referencing `users(id)` with `ON DELETE CASCADE`;
  private `discord_user_id` and `channel_id`; channel-name snapshot `channel_name`; UTC text `joined_at`,
  nullable `left_at`; `start_reason` (`joined`, `moved`, `bot_online`) and nullable `end_reason`
  (`left`, `moved`, `bot_offline`, `unlinked`). `left_at` and `end_reason` are null together;
  a closed segment cannot end before it began. Index `(user_id, joined_at)` supports history;
  a partial unique index on `discord_user_id WHERE left_at IS NULL` permits only one open segment per Discord account.
- `voice_coverage`: identity `id`, UTC text `started_at` and `last_seen_at` with
  `last_seen_at >= started_at`, indexed by `last_seen_at`. It records persisted observation intervals,
  not a promise that every member was already bound.

Timestamps have no database defaults: all voice writes supply second-resolution UTC text.
Storage-only Discord and channel identifiers never enter public DTOs, pages or command replies.
Binding deletion or replacement closes the old account's open segment with `unlinked` in the same transaction;
recording and binding changes serialize on the binding row, so a late write cannot revive the old binding.
The recorder checks complete available-guild snapshots, resumes and minute heartbeats; database failure
marks recording degraded and stops extending coverage until a successful reconciliation. Hourly cleanup enforces
`VOICE_RETENTION_DAYS`: segments whose `joined_at` predates the cutoff are removed as whole rows, including open rows.
If such a row overlaps the retained window, the same PostgreSQL transaction atomically withdraws coverage
from the cutoff through the latest deleted end (capped at cleanup time; open rows end at that time for withdrawal).
This is global coverage, so all users see the affected time as uncovered; no surviving records are removed for other users.
Unqueryable coverage prefixes are also discarded; trustworthy suffixes after the withdrawn interval are retained.
The old cursor is invalidated and a complete available snapshot is reconciled before coverage can resume from now.
Any cleanup failure rolls back both deletion and withdrawal and degrades the recorder. A still-present bound member
whose open row expired starts a new `bot_online` row at reconciliation time, without backdating evidence.
See the owner-run deployment checklist in `docs/DEPLOY-DISCORD.md`.

## Discord information board (S4)

`0011_board.sql` expands the PostgreSQL `outbox.entity` and `discord_messages.entity` CHECK lists
with `board`, retaining all previous entities including `session`. D1 needs no S4 migration;
the optional penalty-only record query is shared and tested on both backends.

`board.refresh` has entity `board`, entity ID `main`, payload `{}`, and dedupe key `board:main:refresh`.
`discord_messages` stores its sole mapping at `(board, main, board)`.
`score_events` inserts, `records` inserts/deletes/status updates, `users` inserts/deletes or
username/display_name/is_participant/score updates, and `weekly_reports` inserts/updates queue refreshes.
BEFORE STATEMENT guards acquire the board scheduling lock before source row locks; AFTER STATEMENT
triggers call `schedule_board_refresh()`. This preserves case/score lock order and avoids deadlocks.
Import mode (`edg.importing = on`) takes no board lock and emits nothing. The bot calls the same helper
once after ClientReady; a scheduling failure is logged without blocking voice recording or the dispatcher.

Scheduling uses the existing ten-second coalesce behavior: keep the earliest due time, preserve backoff,
and queue another event if the old one is claimed or processed. With the dispatcher's polling, normal changes
appear in about 10–40 seconds; no periodic board refresh is added. A deleted board is restored at the next
source-triggered or startup refresh, rather than by an additional message-deletion listener. Each delivery loads current data, ignoring event payload.

The public message has three embeds, individually clamped and collectively bounded to 6000 characters:

- Top 15 participants, using the same competition ranking as the website (`shared/rank.ts`), with effective Nanako names and scores; no tiers.
- Latest 5 decided penalties, excluding bonus types in SQL before LIMIT; zero-delta penalties remain.
  Ordering and timestamp match `/verdicts`: created_at descending, then ID descending. Links use permanent `?case=` URLs.
- Pending `awaiting_statement`/`judging` count only, an optional existing report title/link, and a Discord relative update time.

There are no Discord account IDs or channel IDs, pre-verdict names, accusations, statements or AI verdict text
in the board projection. Names are sanitized, and `allowed_mentions.parse` is empty.
The one-row buttons are `v1:board:me` (own score plus todo), `v1:board:voice` (own default seven-day history),
and a web link. Interactive replies are always ephemeral; only the configured guild is accepted, in any of its channels.
Other-guild and DM presses are rejected before private handlers; unbound callers get the existing binding prompt once.

`DISCORD_BOARD_CHANNEL_ID` is optional, empty disables posting, otherwise it must be 17–20 digits.
Delivery holds a separate advisory transaction lock and rechecks its claim after waiting; source transactions never wait
on an outbox row lock held across a Discord request. A successful in-flight send retains its physical message mapping
even if another claim has taken over; only the owning token can acknowledge the outbox event. The next owner edits that mapping.

Recovery does not rely solely on Discord's short nonce deduplication window. The production finder refreshes the
channel, bot member and roles, verifies ViewChannel and ReadMessageHistory before and after scanning, and inspects
only author IDs and the bot's own two-button marker. Ordinary chat bodies/embeds are not read or retained.
Missing mappings, deleted messages and channel changes use a complete paginated scan to find the oldest surviving
own board and delete duplicate own boards; a valid mapping bounds routine scans to newer messages. A failed or incomplete
scan, missing capability or missing permission cannot be treated as an empty channel and cannot trigger a new send.
Current-channel duplicate deletion failures retry; old-channel deletion ignores missing message/channel and 403 as planned.
New sends retain `nonceFor(row)` for short retry protection. A disappeared recovery candidate retries instead of blindly sending.

Only the welcome DM may add the configured board link `<#channelId>`.
Shared guide copy, the website, `/help`, other DMs and the public board do not acquire raw channel identifiers.
The welcome renderer's optional parameter is omitted for invalid/unconfigured channel IDs; notify preferences and DM refusal rules stay unchanged.

## Frontend expectations

- Fetch `/api/config`, `/api/leaderboard`, `/api/records`, `/api/me` on load, plus
  `/api/records?mine=pending` when `pending.statements > 0`. Signed-in readers also load
  `/api/me/discord`; admins with pending appeals load
  `/api/records?limit=50&status=appealed`. These supplemental reads settle independently;
  their failure never blocks the page or raises a global notice.
- Import scoring display constants from `@shared/scoring` and board timezone labels from `@shared/boardTime`.
- A pre-verdict case must never render its `delta` as `0` — show the pending
  range, or 判决后公开 when the API hid it (`pending_hidden`). Such a case says
  only that it exists — for a subject named 老王, 「老王有一起记录在处理中，判决后公开。」
  — and its feed row shows only the name and 「处理中」.
- Prefer `claim_summary` over the raw `claim` for headlines; fall back to the type
  label when it is null (pre-v3 rows).
- Home DOM order is greeting / standings link, an independent onboarding hint when needed,
  then score before todo summary, 「最近判决」 and a one-line report date/link. Only the score
  and todo summary sit side by side on wider screens; narrow screens follow the same DOM order.
  `MyScoreLine`'s optional `overview` variant and page clock retain its legacy `line` / `card`
  defaults. An unlisted account says 「当前不上榜」 without a score, rank or recovery preview;
  visitors get the compact welcome card. Zero known todos is one quiet line; unknown supplemental
  data stays loading rather than asserting zero. Admin appeal counts count cases, not cards.
  Recent verdicts are the first three in the existing feed order, limited to `decided` / `appealed`,
  excluding `pending_hidden` and historical bonus types. There is no home expansion or mini board.
  「全部案件」 opens `/cases?view=public`; the report row opens `/board/report`, never reproduces
  its narrative or awards, and quietly says 「暂无战报」 when none exists.
- One primary navigation in DOM order serves every viewport: 「首页」「信誉榜」「案件」「设置」.
  The signed-in todo count belongs to 「案件」. The account menu has only 「我的记录」「退出登录」;
  the cases page links judges/admins to 「裁判工具」. There is no separate phone bottom navigation.
  When the Node/PG community module is available, home adds one 「社区中心」 entry; its room,
  role and fun pages remain a separate feature group rather than another primary-navigation set.
  `/cases` defaults to 「我的待办」 for signed-in readers and 「公开记录」 for visitors.
  `?view=todo` / `?view=public` selects the section without changing `parseRoute`.
  Public-record filters operate only on the currently loaded records, including withdrawn,
  revoked and historical bonus rows; protected pending cases remain one 「处理中」 category.
  The full todo list includes statements, escalation, appeal outcomes and admin review.
- The home onboarding hint says 「还差 N 步完成入户」 and 「继续入户」 links to `/welcome`.
  N counts the missing server-derived steps 2–4 using the welcome page's pure function.
  It contributes neither a todo badge count nor an attention dot and is omitted from the cases
  todo list. Closing it stores account, timestamp and missing step IDs in
  `edg.todo.onboarding-dismissed` for 7 days. A newly missing step makes it reappear even when
  the missing count stays the same; completing steps does not undo the dismissal.
  This local preference never proves completion.
- `/welcome` has five ordered, expandable cards: login; join and bind Discord; enable DMs;
  name and identity; guide. Only login is actionable for visitors. Completed cards fold and the
  first unfinished one opens. Step 2 requires a binding; step 3 requires both `notify_dm` and
  `dm_ok`; step 4 requires `is_participant` or `is_judge`. The last step has no persisted viewed flag.
  Names and roles retain their existing `IdentityForm` save flow and tab-local draft;
  「裁判资格由管理员授予」 remains. Drafts never mark a step complete.
  A Discord GET 404 never marks steps 2 or 3 complete: controls hide and 「完成，去首页」 stays
  disabled. Loading or failed reads also cannot establish completion.
- The visitor welcome card's 「开始」 links to `/welcome`; `OnboardingDialog` is retired.
  Daily account editing lives in `/settings/profile` and `/settings/discord`, independent of
  onboarding completion. `/guide` is available without login. Both guide and welcome are full
  pages at every viewport size. `GuideContent`, `/help` and `dm.welcome` share `shared/guide.ts`.
  `GUIDE_TIPS` includes `voiceNotice()` from `shared/voice.ts`, so the guide, `/help`, welcome DM
  and welcome step 5 show the same recording notice and retention period. The rules also state
  that the bot records voice entry/exit as reference. The S4 information-board hint is shared;
  its raw channel link is added only to welcome DMs.
- Personal pages show score, history and records. Only the person's own page shows their tier
  name and description; other viewers never receive a tier label, blurb or tier-colored avatar.
  All score numerals, gauges and profile charts use stable neutral colors, including the owner's.
  The own page embeds personal 7 / 14 / 31-day voice history; staff viewing someone else get a
  scoped voice-tool link. An unavailable own voice module says 「语音记录暂不可用。」 locally,
  without turning the whole profile into NotFound or treating unavailable evidence as empty.
  Admin actions link to member settings and the subject's score tool, without inline role or score forms.
- A single-case page has heading 「案件 #N」, a subject profile link and exactly one focused
  `case-N` card. It does not stack the subject's other history, chart or voice below the case.
  Escalation, statement, appeal and override retain existing API role/status rules.
  Filing excludes the caller, requires at least 10 characters of facts and caps each optional
  personal supplement at 300 characters. Partial success retries only failed subjects.
  Statement submission immediately judges the case and cannot be edited afterwards; an appeal
  may have an empty reason and retains its confirmation. Withdrawal and revocation use inline
  confirmation with cancel first. Withdrawal remains for the reporter/admin only while
  `awaiting_statement`, including a reporter who is no longer a judge. Revocation remains for
  an admin or the reporter before the 15-minute cutoff measured from creation, only on
  `decided` / `appealed`; an expired reporter confirmation disappears. Override is admin-only,
  requires a reason and uses the existing server-clamped violation range.
- `verdict.source === 'fallback'` must be visually distinct from `'ai'`; users
  should never mistake a base-score fallback for an actual AI judgment.
- Links into the app (the bot's DMs and replies use them) stay valid for ever:
  `/?session=<id>` and `/?case=<id>`. Only a positive integer id is read
  (anything else is ignored and simply stripped), and the parameter is
  handled once: `?session=N` stays on the home page（首页）, shows Toast「约局功能已下线」
  and clears the parameter with replace.
  `/?case=<id>` looks the case up once
  (`GET /api/records/<id>`) and becomes
  `/players/<subject>/cases/<id>`, where only that case is displayed, scrolled
  to the centre and focused with one `case-<id>`. Other query
  parameters (`utm`, …) are kept. The link only picks which ordinary view
  opens — what it shows and which controls come from the API and `/api/me` as
  always. A link never writes. A case that is gone leaves you on `/` with
  「链接里的案件不存在了。」 (any other failure: 「打不开链接里的案件，稍后再试。」).
  Case and session parameters are read on `/` only. `?onboarding=1` on any app path first
  replaces the route with `/welcome`; `?linked=discord` also replaces it with `/welcome` and
  shows the existing 「Discord 绑定成功」 notice there. Both markers remain permanently compatible;
  the backend callback URLs stay unchanged. After 「完成，去首页」 returns to `/`, the original
  read-only destination continues: legacy case / session target first, then a valid `edg.return`,
  then the non-home app path that the welcome entry temporarily replaced. A retired-session
  destination still produces the S1 home Toast; it never opens a session or replays an action.
  `edg.welcome.return` in sessionStorage keeps only that validated destination in the same tab,
  expiring after 30 minutes, across Discord OAuth and welcome-page reloads. A current explicit app
  destination or legacy deep link wins over an older pending value. Completing welcome or
  logging out clears it. Unknown / external / overlong paths and old action intents cannot be replayed.
- Routes (`src/lib/routes.ts` parses, `src/lib/router.ts` owns `history`; no
  router library). Only these exist; every other path renders the front-end
  page 「这页不存在」 with a 「回大厅」 link:

  | Path | Page at every viewport | Helper / compatibility |
  |---|---|---|
  | `/` | overview | `HOME_PATH` |
  | `/board` | complete standings and weekly recovery countdown | `boardPath('list')` |
  | `/cases` | own todo / public records | `CASES_PATH`; `?view=public` selects public records |
  | `/community` | community room page, scoped to the current actor | community capability required |
  | `/community/roles` | self-service community interest roles | community capability required |
  | `/community/play` | community fun tools and authorized results | community capability required |
  | `/settings` | personal profile, same content as `/settings/profile` | default profile alias |
  | `/settings/profile` | personal display name and identity | `settingsPath('profile')` |
  | `/settings/discord` | Discord binding and DM preferences | `settingsPath('discord')` |
  | `/settings/members` | all-account role management, admins only | `settingsPath('members')` |
  | `/settings/ai` | AI connection, credentials and configuration, admins only | `settingsPath('ai')` |
  | `/settings/community` | community configuration, rooms, operations and audit, admins only | community capability required |
  | `/tools` | judge/admin tool directory | `toolsPath('home')`, also the default `toolsPath()` |
  | `/tools/filing` | judge/admin filing form | `toolsPath('filing')` |
  | `/tools/voice` | judge/admin voice evidence | `toolsPath('voice')` |
  | `/tools/score` | account picker or manual score editor, admins only | `toolsPath('score')` |
  | `/players/<userId>` | profile with a 「返回」 bar | `playerPath(userId)` |
  | `/players/<userId>/cases/<id>` | one focused case and subject link | `playerCasePath(userId, id)` |
  | `/cases/<id>` | look up the case once, then replace with its subject's case address | `casePath(id)` alias |
  | `/welcome` | five-step onboarding | `WELCOME_PATH` |
  | `/guide` | shared bot guide | `GUIDE_PATH` |
  | `/board/report` | full weekly report | `boardPath('report')` |
  | `/board/rules` | rules and guide | `boardPath('rules')` |
  | `/board/feed` | current public cases page | preserved old feed address |
  | `/admin`, `/admin/voice` | current voice tool, staff gate retained | preserved old management addresses |
  | `/admin/members`, `/admin/ai` | current members / AI settings, admins only | preserved old management addresses |
  | `/admin/community` | current community settings, admins only | preserved community-management address |
  | `/sessions`, `/sessions/*` | 「约局功能已下线」 landing | every retired scheduling address |

  All non-home routes cover the home content, while the global navigation remains available.
  The old feed/admin addresses render current pages without requiring a new redirect.
  `toolsPath('voice', userId)` and `toolsPath('score', userId)` add a URL-encoded `?user=`;
  other tool tabs do not add that query. Path parsing remains pure and never reads these queries.

  Case ids match `^[1-9]\d{0,14}$` (so `/cases/07` is invalid). All paths under `/sessions` are retired landings. A
  user id is the OAuth subject: non-empty, at most 128 characters, no NUL,
  always `encodeURIComponent`-ed in the path. When a case's `subject.id` is not
  the `<userId>` in the address, the address is replaced with the subject's —
  never an error. `/sessions` and any child path, including `/sessions/new`, `/sessions/history`
  and `/sessions/<id>/rollcall`, show the fixed title 「约局功能已下线」, body
  「约人直接在 Discord 里喊；迟到、放鸽子由裁判记录。」 and a 「回首页」 button.
  Not found: `/players/<userId>` → 「找不到这位选手。」 with 「看信誉榜」; a case →
  「链接里的案件不存在了。」, any other failure → 「打不开链接里的案件，稍后再试。」.
- Settings are centralized under 「设置」. Signed-in readers see 「个人资料」「Discord 与通知」;
  admins additionally see 「成员与权限」「AI 模型与密钥」 and, when supported, 「社区管理」.
  `/settings` continues to mean the profile default; community settings do not replace it or add
  another account-settings shell. A signed-out personal settings page
  offers login with the ordinary return destination. Members/AI settings require an admin
  before mounting their private form or making its API reads; a judge alone gets NotFound.
  API 403/404 removes unavailable private content; ordinary errors offer a local retry.
  A Discord GET 404 hides that category and its controls, without proving onboarding completion.
  Profile editing retains the Nanako/custom-name choice and 24-character limit, and can preserve
  an unlisted account without automatically opting it into the standings. Existing judge
  relinquishment and administrator self-service rules are unchanged.
- `/settings/discord` keeps binding controls separate from the saved DM preference form and
  welcome-DM resend action. AI settings put connection/credentials first; the three advanced
  prompts and the original four health statistics are collapsed. Dry run uses saved configuration
  (`{}`), never unsaved input. Credentials are never prefilled or stored in a draft; explicit key
  clearing preserves the existing API semantics for other submitted settings.
  `/settings/members` uses client-side name search over the returned latest-500 list and shows the truncation/search
  scope hint. Rows show avatar, effective name, role tags, neutral score and board-time registration.
  Admins can set/revoke judge status, with self-dismissal hidden; manual score changes link to
  `/tools/score?user=<encoded Nanako ID>`. No account deletion, admin-grant or participant-toggle
  UI is added. Successful role writes show a Toast, reload the list and invalidate `/api/leaderboard`,
  `/api/me` and `/api/records?limit=50`; a failed follow-up
  list read explicitly says the change was saved.
- `/tools` and `/tools/filing` require a judge or admin. The directory links to filing and voice;
  admins also get appeal review in `/cases` and manual scoring. `/tools/voice`, with no `?user`,
  shows a board-date picker (default today) and roster. Selecting a person opens
  `/tools/voice?user=<encoded Nanako ID>`; the personal view offers 7 / 14 / 31 days ending today.
  Invalid IDs or API 404 render NotFound. The same role checks apply at `/admin` and `/admin/voice`.
  Each selected filing subject has 「看 TA 的语音记录」 in a new tab with
  `target="_blank" rel="noopener"`,
  preserving the current filing draft. `/tools/score` is admin-only and includes unlisted accounts;
  changing a score keeps the existing input-then-confirm sequence and writes only `score`.
  Voice privacy, persisted-only coverage, uncertain departure and 90-day retention remain as specified above.
- Ordinary settings and score forms save independently. Unsaved SPA navigation, browser Back
  and logout ask inline first; staying restores focus to the previous control. A page unload with
  dirty input uses the browser's leave warning. Discarding clears the editor and sensitive input.
  Filing has its own retained draft and inline leave choice; ordinary navigation can leave an
  already-started filing request running, with partial-success drafts reduced to failed subjects.
  A successful save is not reported as unsaved merely because its follow-up read failed.
- Private reads, pinned cases, dialogs, drafts and mutations belong to the current actor's
  account/permission lease and, where relevant, subject/tab. A lease change hides old content
  before new effects, invalidates old callbacks and prevents a later role restoration from reviving
  an old privileged seed. Late responses cannot publish private data, clear another actor's draft,
  trigger their Toast/global refresh or start follow-up writes. A request already sent may still
  commit on the server; navigation is not a rollback. Cached feed records are restricted for the
  current viewer while refresh is pending, without undoing server redaction or replacing API authorization.
- The visual system is light: white/gray surfaces, charcoal primary actions, semantic status text,
  system UI fonts and a system monospace stack for numbers, with no external font requests.
  Body/input text is 16px, explanations 14px, timestamps 12px; standalone controls meet a 44px
  touch target. DOM order is visual order, with only the 600/1024 breakpoint families; hover rules
  require `(hover: hover)`, and visible focus, reduced motion and forced colors remain supported.
  CSP permits no inline `style` attributes, inline style elements or `dangerouslySetInnerHTML`.
  Static CSS classes and SVG presentation attributes carry the visuals, without gradient/glow decoration.
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
  overlay (a statement/appeal sheet or another actual dialog; routed pages have their own addresses)
  adds one entry at the same address: the back key closes only the topmost
  overlay (one that holds a draft asks first, and keeps its entry if the user
  stays), and closing it from the UI goes back over its entry silently, so the
  next back behaves as if it had never opened. A reload never reopens an
  overlay. `history.scrollRestoration` is `manual`: going back
  restores the scroll position the entry was left at.
- Login return. Right before the top-level jump to the API's `/auth/login`, the
  current address (path and query, no hash) is saved as JSON in
  `sessionStorage['edg.return']` (a page not worth coming back to — `/` or an
  unknown path — saves nothing and drops any old value), e.g.
  `{"v":1,"path":"/players/player-5","savedAt":1761500000000}`.
  On the first signed-in load (the OAuth callback lands on `/`; after welcome finishes,
  if it was requested) it is read once and always deleted; a valid one saved less than 30 minutes ago
  opens that address. It is only ever an in-app path — at most 512 characters, starts with `/`
  but not `//`, no `\` or `#`, an app route other than `/` — so it can never become an open
  redirect. Old values with an `intent` field still yield the validated address, with the
  field ignored; a stored `/sessions` or child path resolves to `/`. No RSVP hint or automatic
  business action remains. A legacy `?case=` / `?session=` link wins over the saved address;
  a stored welcome page (including its trailing-slash alias) is not reopened when finishing welcome.
  Logging out clears the login return and pending welcome destination.
- A case with `redacted: true` says a statement exists (when `statement_at` is
  set) rather than calling it a verdict in absence, and shows no verdict words.

## 5. 社区 Bot / 网页模块（Node / PostgreSQL 专属）

此新增模块的 Node/PG 边界已由机主确认。`COMMUNITY_ENABLED` 默认关闭；旧 Worker/D1 的下列路径返回 JSON 404，网页隐藏入口。既有信誉、案件、语音证据和绑定契约不变。

所有社区 API 需要现有 Nanako session，返回 `Cache-Control: no-store`。JSON POST 还要求受允许的 Origin，并遵守 READ_ONLY。网页个人控制需当前 Discord 绑定与服务器成员身份；社区管理员只来自当前 `users.is_admin`，无需 Discord 绑定也可配置和管理已有房间。Bot 普通命令不需要绑定。API 不持 Bot Token，只写持久任务；Bot 执行前以及多个外部副作用之间重查身份、权限、版本、租约和目标资源。

| 地址 | 方法 / 返回 |
|---|---|
| `/api/community` | GET `{settings: member projection, version, runtime, me}` |
| `/api/community/rooms` | GET `{rooms}`；POST `{name?, requestKey}` → 202 `{operation}` |
| `/api/community/rooms/:ref` | GET 当前可见房间；不可见与不存在同为 404 |
| `/api/community/rooms/:ref/actions` | POST `{action, expectedVersion, requestKey, ...fields}` → 202 `{operation}` |
| `/api/community/resources?kind=member\|role` | GET `{resources}`，成员只见安全的成员／白名单身份选择器 |
| `/api/community/roles` | GET `{choices, selectedRefs, maxChoices, enabled}`；POST `{roleRefs, requestKey}` → 202 `{operation}` |
| `/api/community/fun` | GET `{items}`；POST `{kind, input, roomRef?, requestKey}` → 202 `{operation}` |
| `/api/community/fun/:ref/actions` | POST `{action: vote\|close\|redraw, choice?, requestKey}` → 202 `{operation}` |
| `/api/community/operations/:ref` | GET `{operation}`，当前本人身份或管理员可读，目标范围仍须可见 |
| `/api/admin/community` | GET `{settings, version, runtime}`；POST `{settings, expectedVersion, requestKey}` 原子保存全配置及应用任务，202 返回同结构和 `operation` |
| `/api/admin/community/resources` | GET `{resources}`，管理员按名称选择分类／文字或语音频道／角色／成员 |
| `/api/admin/community/operations`、`/audit` | GET `{operations}` / `{audit}`，仅管理员 |
| `/api/admin/community/sync` | POST `{requestKey, kind?: resources.sync\|panel.refresh}` → 202 `{operation}` |
| `/api/admin/community/operations/:ref/review` | POST `{confirm: true, requestKey}` → `{operation}`，仅当前管理员二次确认后取消待对账旧任务；不重放动作、不直接恢复房间 |

房间动作：`join`、`rename {name}`、`limit {userLimit}`、`visibility {visibility}`、`grant/deny/kick/transfer {memberRef}`、`accept`、`claim`、`dissolve`、`admin_delete {confirm:true}`。加入前必须已连接语音，不能替未连接成员开始语音；管理员强制关闭必须先移动所有人到独立等候区，失败不删除。

- 所有 ref 是随机 UUID v4，与原始 Discord ID 无可逆关系。DTO、URL、错误、审计与选择器不含原始成员／频道／角色标识、CDN 头像或精确频道链接。管理员配置也只用 opaque refs。
- 成员配置投影不包含行政资源选择或私有 AI prompt。私房名称、成员、人数、互动与操作结果均按当前可见范围过滤。待对账房间对其他普通成员隔离；本人只见自身可读状态，管理员可诊断。
- 操作状态：`queued/running/retry_wait/succeeded/failed/conflict/canceled/needs_review`。202 不代表执行成功。相同 actor 和 requestKey 的相同请求返回同一任务，不同内容冲突；房间与同成员的跨端角色任务分别串行。过期 running 进入待对账，不自动重放。
- `runtime.ready` 有新鲜度限制；`appliedVersion` 与已保存 `version` 分开。恢复时只信完整资源／语音快照、已登记目标和严格审计标记，不把未知当作空房；Gap 后重新观察宽限。
- 人工 review 只取消旧任务、解除 scope 阻塞并记审计。欢迎保守计作已发送；房间须再经类型、分类、完整访问模型或唯一建房审计证明才能恢复。不可证明时继续隔离。
- 趣味结果不参与计分。投票同 Discord 身份跨端一票、可在截止前改票；抽签不放回，重抽保存旧记录；分队仅使用明确选定成员。
- 社区 AI 独立开关／prompt／配额，复用已保存提供商凭据；只用本次主动主题，按现有 reset 时区原子计配额（失败也计）。无房间范围的建议仅创建者与管理员可读；房间范围继承房间 ACL；应用名字是另一次房主管理动作。

新 PG 表均由可重复执行的 `0012_community.sql` 创建：settings、resources、rooms、room_access、operations、audit、fun、poll_votes、ai_usage、role_choices、welcomes（均带 `community_` 前缀）。不删除或复用约局／历史／语音证据表。

本 PR 已基于 `3119a96`（main #43，S6 清爽总览）融合。新增社区页面 `/community`、`/community/roles`、`/community/play`，管理页使用既有集中设置中的 `/settings/community`；`/admin/community` 为后者兼容别名。`/settings` 仍默认个人资料，S6 的四项主导航、工具路由、整页详情、原入户和永久深链均保留。社区接口能力关闭或旧 D1 返回 404 时隐藏社区入口，不影响既有设置／裁判工具。
