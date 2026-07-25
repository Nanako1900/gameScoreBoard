-- ============================================================================
-- EDG 信誉分 — v1 → v2 迁移：AI 裁决 + 预约约局
--
-- 只在**已有 v1 数据**的库上跑一次：
--   wrangler d1 execute edg-credit --local  --file=./migrations/002_v2_cases_and_sessions.sql
--   wrangler d1 execute edg-credit --remote --file=./migrations/002_v2_cases_and_sessions.sql
--
-- 全新部署请直接用 schema.sql（已含全部 v2 列与表），不要跑这个文件。
--
-- SQLite 没有 `ADD COLUMN IF NOT EXISTS`，重复执行会对每条 ALTER 报
-- "duplicate column name" —— 这是预期的，代表迁移已经做过了。其余语句
-- （CREATE TABLE IF NOT EXISTS 与几条 UPDATE）本身幂等，重跑不会损坏数据。
--
-- 已验证：在 v1 库上跑完这个文件，得到的表结构与索引与直接跑 schema.sql 完全一致。
-- ============================================================================

-- --- records: 案件化 --------------------------------------------------------
ALTER TABLE records ADD COLUMN claim              TEXT;
ALTER TABLE records ADD COLUMN session_id         INTEGER;
ALTER TABLE records ADD COLUMN statement          TEXT;
ALTER TABLE records ADD COLUMN statement_at       TEXT;
ALTER TABLE records ADD COLUMN appeal_reason      TEXT;
ALTER TABLE records ADD COLUMN deadline_at        TEXT;
ALTER TABLE records ADD COLUMN judging_started_at TEXT;
ALTER TABLE records ADD COLUMN verdict_source     TEXT;
ALTER TABLE records ADD COLUMN verdict_headline   TEXT;
ALTER TABLE records ADD COLUMN verdict_reason     TEXT;
ALTER TABLE records ADD COLUMN verdict_factors    TEXT;

-- 旧状态映射到新状态机。v1 的记录都是已结算的人工判罚。
UPDATE records SET status = 'decided'  WHERE status = 'active';
UPDATE records SET status = 'appealed' WHERE status = 'disputed';
UPDATE records SET verdict_source = 'manual' WHERE verdict_source IS NULL;

-- v1 的 note 同时承担「事实描述」的角色，迁移过来当 claim 的初值，便于旧记录也能
-- 在 v2 的判词卡片里显示上下文。
UPDATE records SET claim = note WHERE claim IS NULL AND note IS NOT NULL;

-- --- AI 审计 + 运行时设置 ----------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_verdicts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id      INTEGER NOT NULL,
  provider       TEXT NOT NULL,
  model          TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  raw_response   TEXT,
  parsed_delta   INTEGER,
  applied_delta  INTEGER NOT NULL,
  clamped        INTEGER NOT NULL DEFAULT 0,
  confidence     REAL,
  latency_ms     INTEGER,
  error          TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (record_id) REFERENCES records(id)
);

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
  starts_at    TEXT NOT NULL,
  duration_min INTEGER,
  capacity     INTEGER,
  note         TEXT,
  status       TEXT NOT NULL DEFAULT 'open',
  settled_at   TEXT,
  settled_by   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (organizer_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS session_players (
  session_id      INTEGER NOT NULL,
  user_id         TEXT NOT NULL,
  rsvp            TEXT NOT NULL DEFAULT 'going',
  rsvp_at         TEXT NOT NULL DEFAULT (datetime('now')),
  attendance      TEXT,
  late_minutes    INTEGER,
  attendance_note TEXT,
  record_id       INTEGER,
  PRIMARY KEY (session_id, user_id),
  FOREIGN KEY (session_id) REFERENCES game_sessions(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_records_status   ON records(status, deadline_at);
CREATE INDEX IF NOT EXISTS idx_records_session  ON records(session_id);
CREATE INDEX IF NOT EXISTS idx_verdicts_record  ON ai_verdicts(record_id);
CREATE INDEX IF NOT EXISTS idx_verdicts_created ON ai_verdicts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_starts  ON game_sessions(starts_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_status  ON game_sessions(status, starts_at);
CREATE INDEX IF NOT EXISTS idx_players_user     ON session_players(user_id);
