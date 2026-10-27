-- S3 voice evidence, UTC text supplied by the writer; safe to repeat.
CREATE TABLE IF NOT EXISTS voice_sessions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  discord_user_id TEXT NOT NULL,
  channel_id      TEXT NOT NULL,
  channel_name    TEXT NOT NULL,
  joined_at       TEXT NOT NULL,
  left_at         TEXT,
  start_reason    TEXT NOT NULL CHECK (start_reason IN ('joined', 'moved', 'bot_online')),
  end_reason      TEXT CHECK (end_reason IN ('left', 'moved', 'bot_offline', 'unlinked')),
  CHECK ((left_at IS NULL) = (end_reason IS NULL)),
  CHECK (left_at IS NULL OR left_at >= joined_at)
);
CREATE INDEX IF NOT EXISTS voice_sessions_user_joined ON voice_sessions (user_id, joined_at);
CREATE UNIQUE INDEX IF NOT EXISTS voice_sessions_one_open ON voice_sessions (discord_user_id) WHERE left_at IS NULL;

CREATE TABLE IF NOT EXISTS voice_coverage (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  CHECK (last_seen_at >= started_at)
);
CREATE INDEX IF NOT EXISTS voice_coverage_seen ON voice_coverage (last_seen_at);
