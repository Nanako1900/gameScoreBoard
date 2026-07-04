-- EDG 信誉分 — D1 schema
-- Apply locally:  npm run db:local
-- Apply remote:   npm run db:remote

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,               -- OAuth subject id (stable per user)
  username       TEXT NOT NULL,                  -- raw OAuth (Nanako) username, refreshed on login
  display_name   TEXT,                           -- user's chosen display name; NULL = use username
  avatar_url     TEXT,
  email          TEXT,
  is_participant INTEGER NOT NULL DEFAULT 0,      -- 上榜选手 (has a credit score)
  is_judge       INTEGER NOT NULL DEFAULT 0,      -- 可记录违约/守约
  is_admin       INTEGER NOT NULL DEFAULT 0,
  score          INTEGER NOT NULL DEFAULT 100,    -- current credit, clamped 0..100
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS records (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id  TEXT NOT NULL,                      -- 被记录的选手
  reporter_id TEXT NOT NULL,                      -- 记录的裁判
  type        TEXT NOT NULL,                      -- ViolationType (see shared/scoring.ts)
  delta       INTEGER NOT NULL,                   -- signed points actually applied
  note        TEXT,
  status      TEXT NOT NULL DEFAULT 'active',     -- active | disputed | revoked
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (subject_id) REFERENCES users(id),
  FOREIGN KEY (reporter_id) REFERENCES users(id)
);

-- Every score change is logged here so the per-user history chart is trivial + auditable.
CREATE TABLE IF NOT EXISTS score_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT NOT NULL,
  delta           INTEGER NOT NULL,
  reason          TEXT NOT NULL,                  -- record:<id> | revoke:<id> | weekly_heal | admin_adjust
  resulting_score INTEGER NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Idempotency ledger for the weekly recovery cron (one row per healed week).
CREATE TABLE IF NOT EXISTS weekly_heals (
  week_start TEXT PRIMARY KEY,                     -- YYYY-MM-DD (local Monday)
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  affected   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_records_subject   ON records(subject_id);
CREATE INDEX IF NOT EXISTS idx_records_created   ON records(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_user       ON score_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_users_participant ON users(is_participant, score DESC);
