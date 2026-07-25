-- EDG 信誉分 — D1 schema (v2: AI 裁决 + 预约约局)
-- Fresh install:  npm run db:local   /   npm run db:remote
-- Upgrading an existing v1 database? Run migrations/002_v2_cases_and_sessions.sql
-- instead — this file only CREATEs, it does not ALTER.

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,               -- OAuth subject id (stable per user)
  username       TEXT NOT NULL,                  -- raw OAuth (Nanako) username, refreshed on login
  display_name   TEXT,                           -- user's chosen display name; NULL = use username
  avatar_url     TEXT,
  email          TEXT,
  is_participant INTEGER NOT NULL DEFAULT 0,      -- 上榜选手 (has a credit score)
  is_judge       INTEGER NOT NULL DEFAULT 0,      -- 可立案
  is_admin       INTEGER NOT NULL DEFAULT 0,
  score          INTEGER NOT NULL DEFAULT 100,    -- current credit, clamped 0..100
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A "record" is a case: filed by a judge, argued by the subject, sentenced by the AI.
-- Penalties run the full trial; bonuses settle immediately at their base value.
CREATE TABLE IF NOT EXISTS records (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id         TEXT NOT NULL,                  -- 被告选手
  reporter_id        TEXT NOT NULL,                  -- 立案的裁判 / 组织者
  type               TEXT NOT NULL,                  -- ViolationType (see shared/scoring.ts)
  delta              INTEGER NOT NULL DEFAULT 0,     -- signed points actually applied (0 until decided)
  note               TEXT,                           -- 裁判备注（注意：随 API 公开返回）
  claim              TEXT,                           -- 裁判陈述的事实（v2 起 penalty 必填）
  session_id         INTEGER,                        -- 来源预约局；NULL = 手动立案
  statement          TEXT,                           -- 被告陈述原文
  statement_at       TEXT,
  appeal_reason      TEXT,                           -- 被告申诉理由
  deadline_at        TEXT,                           -- 陈述截止（UTC sqlite datetime）
  judging_started_at TEXT,                           -- 认领时间，用于回收僵尸 judging 行
  verdict_source     TEXT,                           -- ai | fallback | manual | admin_override
  verdict_headline   TEXT,
  verdict_reason     TEXT,
  verdict_factors    TEXT,                           -- JSON array of {kind, text}
  status             TEXT NOT NULL DEFAULT 'awaiting_statement',
                     -- awaiting_statement | judging | decided | appealed | revoked | withdrawn
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (subject_id) REFERENCES users(id),
  FOREIGN KEY (reporter_id) REFERENCES users(id)
);

-- Every score change is logged here so the per-user history chart is trivial + auditable.
CREATE TABLE IF NOT EXISTS score_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT NOT NULL,
  delta           INTEGER NOT NULL,
  reason          TEXT NOT NULL,                  -- record:<id> | revoke:<id> | override:<id> | weekly_heal | admin_adjust
  resulting_score INTEGER NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Idempotency ledger for the weekly recovery (one row per healed week).
CREATE TABLE IF NOT EXISTS weekly_heals (
  week_start TEXT PRIMARY KEY,                     -- YYYY-MM-DD (local Monday)
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  affected   INTEGER NOT NULL DEFAULT 0
);

-- Full audit of every AI judging call: lets an admin spot a model that suddenly
-- judges everything at the lenient end (a prompt-injection tell) and diff verdict
-- drift across prompt versions.
CREATE TABLE IF NOT EXISTS ai_verdicts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id      INTEGER NOT NULL,
  provider       TEXT NOT NULL,                    -- hostname of the configured base_url
  model          TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  raw_response   TEXT,                             -- truncated to 4000 chars
  parsed_delta   INTEGER,                          -- what the model asked for (pre-clamp)
  applied_delta  INTEGER NOT NULL,                 -- what actually took effect
  clamped        INTEGER NOT NULL DEFAULT 0,
  confidence     REAL,
  latency_ms     INTEGER,
  error          TEXT,                             -- non-null => fell back to base
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (record_id) REFERENCES records(id)
);

-- Runtime-editable settings (AI base_url / model / prompt …). The API key is
-- deliberately NOT stored here — it lives only in a Worker secret.
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- --- 预约约局 ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS game_sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  organizer_id TEXT NOT NULL,
  title        TEXT NOT NULL,
  game         TEXT,
  starts_at    TEXT NOT NULL,                      -- ISO 8601 UTC
  duration_min INTEGER,
  capacity     INTEGER,                            -- NULL = 不限人数
  note         TEXT,
  status       TEXT NOT NULL DEFAULT 'open',       -- open | cancelled | settled
  settled_at   TEXT,
  settled_by   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (organizer_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS session_players (
  session_id      INTEGER NOT NULL,
  user_id         TEXT NOT NULL,
  rsvp            TEXT NOT NULL DEFAULT 'going',   -- going | maybe | out
  rsvp_at         TEXT NOT NULL DEFAULT (datetime('now')),
  attendance      TEXT,                            -- NULL 未点名 | on_time | late | no_show | left_early | excused
  late_minutes    INTEGER,
  attendance_note TEXT,
  record_id       INTEGER,                         -- case filed from this outcome
  PRIMARY KEY (session_id, user_id),
  FOREIGN KEY (session_id) REFERENCES game_sessions(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_records_subject   ON records(subject_id);
CREATE INDEX IF NOT EXISTS idx_records_created   ON records(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_records_status    ON records(status, deadline_at);
CREATE INDEX IF NOT EXISTS idx_records_session   ON records(session_id);
CREATE INDEX IF NOT EXISTS idx_events_user       ON score_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_users_participant ON users(is_participant, score DESC);
CREATE INDEX IF NOT EXISTS idx_verdicts_record   ON ai_verdicts(record_id);
CREATE INDEX IF NOT EXISTS idx_verdicts_created  ON ai_verdicts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_starts   ON game_sessions(starts_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_status   ON game_sessions(status, starts_at);
CREATE INDEX IF NOT EXISTS idx_players_user      ON session_players(user_id);
