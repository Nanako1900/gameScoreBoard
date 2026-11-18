-- Music bot: a separate process plays audio in one voice room at a time. The
-- API and the music process exchange work only through these tables. Nothing
-- here references scores, cases or voice evidence.

-- One row per invitation. At most one session per guild is not yet ended: a
-- single bot account can sit in a single voice channel.
CREATE TABLE IF NOT EXISTS music_sessions (
  ref uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id text NOT NULL,
  room_ref uuid NOT NULL REFERENCES community_rooms(ref),
  invited_by uuid NOT NULL REFERENCES community_resources(ref),
  status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','connecting','active','ended')),
  end_reason text,
  state jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(state)='object'),
  state_version integer NOT NULL DEFAULT 0 CHECK(state_version>=0),
  -- Whose saved account this session plays with. Cleared when the session ends.
  account_owner uuid REFERENCES community_resources(ref),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  CHECK((status='ended')=(ended_at IS NOT NULL)),
  CHECK(status<>'ended' OR account_owner IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS music_sessions_one_live ON music_sessions(guild_id) WHERE status<>'ended';
CREATE INDEX IF NOT EXISTS music_sessions_room ON music_sessions(guild_id,room_ref,created_at DESC);
CREATE INDEX IF NOT EXISTS music_sessions_ended ON music_sessions(ended_at) WHERE status='ended';

-- Player commands in submission order. request_key makes retries idempotent.
CREATE TABLE IF NOT EXISTS music_commands (
  id bigserial PRIMARY KEY,
  session_ref uuid NOT NULL REFERENCES music_sessions(ref) ON DELETE CASCADE,
  actor uuid NOT NULL REFERENCES community_resources(ref),
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(payload)='object'),
  request_key text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','done','failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE(session_ref,actor,request_key)
);
CREATE INDEX IF NOT EXISTS music_commands_pending ON music_commands(session_ref,id) WHERE status='queued';

-- A member's own source login, encrypted with the shared master key and kept
-- for a limited time. Never returned to a browser.
CREATE TABLE IF NOT EXISTS music_accounts (
  guild_id text NOT NULL,
  member_ref uuid NOT NULL REFERENCES community_resources(ref),
  source text NOT NULL DEFAULT 'netease' CHECK(source IN ('netease')),
  cookie_encrypted text NOT NULL,
  nickname text NOT NULL,
  vip boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(guild_id,member_ref)
);
CREATE INDEX IF NOT EXISTS music_accounts_expiry ON music_accounts(expires_at);

-- Liveness of the music process, so the web can tell "offline" from "idle".
CREATE TABLE IF NOT EXISTS music_runtime (
  guild_id text PRIMARY KEY,
  heartbeat_at timestamptz NOT NULL DEFAULT now()
);
