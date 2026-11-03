-- A fresh generation for every delete/insert binding, including a rebind to the
-- same accounts. In-flight answers cannot inherit a later binding's authority.
ALTER TABLE discord_links ADD COLUMN IF NOT EXISTS binding_id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS discord_links_binding_id ON discord_links(binding_id);

CREATE TABLE IF NOT EXISTS community_agent_settings (
  guild_id text PRIMARY KEY,
  settings jsonb NOT NULL DEFAULT '{"enabled":false,"channelRefs":[],"userDailyLimit":20,"guildDailyLimit":200,"cooldownSeconds":10}'::jsonb CHECK(jsonb_typeof(settings)='object'),
  version integer NOT NULL DEFAULT 0 CHECK(version>=0),
  knowledge_version integer NOT NULL DEFAULT 0 CHECK(knowledge_version>=0),
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS community_agent_documents (
  ref uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id text NOT NULL REFERENCES community_agent_settings(guild_id),
  title text NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
  content text NOT NULL CHECK(length(content) BETWEEN 1 AND 8000),
  published boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK(version>=1),
  created_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_by text REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS community_agent_documents_active ON community_agent_documents(guild_id,updated_at DESC,ref) WHERE deleted_at IS NULL;
-- Deliberately metadata only: no question, answer, prompt or raw provider error.
CREATE TABLE IF NOT EXISTS community_agent_requests (
  ref uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id text NOT NULL REFERENCES community_agent_settings(guild_id),
  source_message_id text NOT NULL,
  reply_message_id text,
  discord_user_id text NOT NULL,
  channel_id text NOT NULL,
  user_id text NOT NULL,
  binding_id uuid NOT NULL,
  settings_version integer NOT NULL,
  knowledge_version integer NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','sending','succeeded','failed','canceled','isolated')),
  claim_token uuid,
  lease_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  error_code text CHECK(error_code IN ('provider_unavailable','provider_failed','no_sources','authorization_changed','configuration_changed','knowledge_changed','lease_expired','delivery_failed','delivery_unknown','interrupted')),
  model text,
  prompt_version text,
  latency_ms integer CHECK(latency_ms>=0),
  UNIQUE(guild_id,source_message_id)
);
-- Also supports reapplying this migration to an existing C9 request table.
ALTER TABLE community_agent_requests ADD COLUMN IF NOT EXISTS reply_message_id text;
CREATE INDEX IF NOT EXISTS community_agent_requests_recent ON community_agent_requests(guild_id,created_at DESC,ref DESC);
CREATE TABLE IF NOT EXISTS community_agent_usage (
  guild_id text NOT NULL REFERENCES community_agent_settings(guild_id),
  day date NOT NULL,
  user_id text NOT NULL,
  count integer NOT NULL DEFAULT 0 CHECK(count>=0),
  last_requested_at timestamptz NOT NULL,
  PRIMARY KEY(guild_id,day,user_id)
);
