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
**Cases**
- `POST /api/records` — two shapes, both requiring `is_judge`:
  - **v3 default (batch, AI classifies):** `{ subject_ids: string[], claim, extras?, note? }`
    → `{ records: RecordItem[], failed: { subject_id, error }[] }`.
    One case per subject, each classified by its own AI call. `extras[subject_id]`
    is appended to that person's claim as `补充：…`. Max `maxBatchSubjects` (8).
    **Partial failure is not an error**: an invalid subject lands in `failed` and
    the rest are still filed, so a judge never loses everything they typed.
  - **Deterministic (single):** `{ subject_id, type?, claim?, note? }` → `{ record, records, failed }`.
    Used when the judge already knows a penalty type. Omitting `type` here
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
- Home DOM order: 「要你处理」 for signed-in readers / the welcome card for visitors,
  then the participant's score, `BoardMini`, 「最近案件」 and the compact weekly report.
  Desktop uses two columns: todo / welcome and recent cases on the left, score / board / report
  on the right. The same DOM serves both layouts. Recent cases reuse `RecordsFeed` with
  `previewCount={5}`, retain 「看更多」 and add 「全部动态」 to `/board/feed` below it.
- Navigation calls the home page 「首页」; no create-session entry remains. Phone bottom tabs are
  exactly 「首页·N」「信誉榜」「我的」. Judges and admins keep 「记一笔」 in the avatar menu.
  Todos include statements, escalation, appeal outcomes / admin review, unbound Discord and failed
  DMs. S1 retains `OnboardingDialog` and these Discord status cards; the welcome wizard is S2.
- `verdict.source === 'fallback'` must be visually distinct from `'ai'`; users
  should never mistake a base-score fallback for an actual AI judgment.
- Links into the app (the bot's DMs and replies use them) stay valid for ever:
  `/?session=<id>` and `/?case=<id>`. Only a positive integer id is read
  (anything else is ignored and simply stripped), and the parameter is
  handled once: `?session=N` stays on the home page（首页）, shows Toast「约局功能已下线」
  and clears the parameter with replace.
  `/?case=<id>` looks the case up once
  (`GET /api/records/<id>`) and becomes
  `/players/<subject>/cases/<id>`, where that case is moved (not copied) to the
  top of its subject's page, scrolled to the centre and focused. Other query
  parameters (`utm`, …) are kept. The link only picks which ordinary view
  opens — what it shows and which controls come from the API and `/api/me` as
  always. A link never writes. A case that is gone leaves you on `/` with
  「链接里的案件不存在了。」 (any other failure: 「打不开链接里的案件，稍后再试。」).
  These parameters are read on `/` only. `?linked=discord` is stripped and shows
  the Discord-linked notice; `?onboarding=1` (on any path) opens the first-login
  dialog first; the case target opens or the retired-session Toast appears once it is closed.
- Routes (`src/lib/routes.ts` parses, `src/lib/router.ts` owns `history`; no
  router library). Only these exist; every other path renders the front-end
  page 「这页不存在」 with a 「回大厅」 link:

  | Path | Phone (< 1024px) | Desktop (≥ 1024px) |
  |---|---|---|
  | `/` | the home page | the home page |
  | `/sessions`, `/sessions/*` | 「约局功能已下线」 landing | the same page |
  | `/board`, `/board/feed`, `/board/report`, `/board/rules` | standings, feed, full report, rules | the same pages |
  | `/players/<userId>` | a page with a sticky 「‹ 返回」 bar | a right-hand drawer over the home page |
  | `/players/<userId>/cases/<id>` | that player's page, the case moved to the top and focused | the same, in the drawer |
  | `/cases/<id>` | alias: looks the case up once, then replaces itself with the row above | the same |

  Case ids match `^[1-9]\d{0,14}$` (so `/cases/07` is invalid). All paths under `/sessions` are retired landings. A
  user id is the OAuth subject: non-empty, at most 128 characters, no NUL,
  always `encodeURIComponent`-ed in the path. When a case's `subject.id` is not
  the `<userId>` in the address, the address is replaced with the subject's —
  never an error. `/sessions` and any child path, including `/sessions/new`, `/sessions/history`
  and `/sessions/<id>/rollcall`, show the fixed title 「约局功能已下线」, body
  「约人直接在 Discord 里喊；迟到、放鸽子由裁判记录。」 and a 「回首页」 button.
  Not found: `/players/<userId>` → 「找不到这位选手。」 with 「看信誉榜」; a case →
  「链接里的案件不存在了。」, any other failure → 「打不开链接里的案件，稍后再试。」.
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
  unknown path — saves nothing and drops any old value), e.g.
  `{"v":1,"path":"/players/player-5","savedAt":1761500000000}`.
  On the first signed-in load (the OAuth callback lands on `/`; after the first-login dialog,
  if one opens) it is read once and always deleted; a valid one saved less than 30 minutes ago
  opens that address. It is only ever an in-app path — at most 512 characters, starts with `/`
  but not `//`, no `\` or `#`, an app route other than `/` — so it can never become an open
  redirect. Old values with an `intent` field still yield the validated address, with the
  field ignored; a stored `/sessions` or child path resolves to `/`. No RSVP hint or automatic
  business action remains. A legacy `?case=` / `?session=` link wins over the saved address;
  logging out clears it.
- A case with `redacted: true` says a statement exists (when `statement_at` is
  set) rather than calling it a verdict in absence, and shows no verdict words.
