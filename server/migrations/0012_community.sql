-- Community control plane is Node/PostgreSQL-only. No Discord identifier is
-- returned by the web DTOs. References are independently generated UUIDs.
CREATE TABLE IF NOT EXISTS community_settings (
  guild_id text PRIMARY KEY,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings)='object'),
  version integer NOT NULL DEFAULT 0 CHECK(version>=0),
  runtime_ready boolean NOT NULL DEFAULT false,
  runtime_synced_at timestamptz,
  runtime_applied_version integer NOT NULL DEFAULT 0 CHECK(runtime_applied_version>=0),
  runtime_problem text,
  runtime_updated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS community_resources (
  ref uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('category','voice','text','role','member')),
  external_id text NOT NULL,
  name text NOT NULL,
  available boolean NOT NULL DEFAULT true,
  safe boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(metadata)='object'),
  seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(guild_id,kind,external_id),
  UNIQUE(guild_id,ref)
);
CREATE INDEX IF NOT EXISTS community_resources_catalog ON community_resources(guild_id,kind,name,ref);
CREATE TABLE IF NOT EXISTS community_rooms (
  ref uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id text NOT NULL,
  owner_ref uuid REFERENCES community_resources(ref),
  channel_ref uuid UNIQUE REFERENCES community_resources(ref),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'creating' CHECK(status IN ('creating','active','closing','closed','needs_review')),
  visibility text NOT NULL DEFAULT 'open' CHECK(visibility IN ('open','locked','hidden')),
  user_limit integer NOT NULL DEFAULT 0 CHECK(user_limit BETWEEN 0 AND 99),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  transfer_to_ref uuid REFERENCES community_resources(ref),
  transfer_expires_at timestamptz,
  owner_left_at timestamptz,
  empty_since timestamptz,
  cleanup_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(metadata)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(guild_id,ref)
);
CREATE UNIQUE INDEX IF NOT EXISTS community_rooms_live_owner ON community_rooms(guild_id,owner_ref)
  WHERE owner_ref IS NOT NULL AND status IN ('creating','active','closing','needs_review');
CREATE INDEX IF NOT EXISTS community_rooms_due_cleanup ON community_rooms(guild_id,cleanup_at)
  WHERE status IN ('active','creating','needs_review');
CREATE TABLE IF NOT EXISTS community_room_access (
  room_ref uuid NOT NULL REFERENCES community_rooms(ref) ON DELETE CASCADE,
  member_ref uuid NOT NULL REFERENCES community_resources(ref),
  allowed boolean NOT NULL DEFAULT false,
  blocked boolean NOT NULL DEFAULT false,
  present boolean NOT NULL DEFAULT false,
  joined_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(room_ref,member_ref),
  CHECK(NOT(allowed AND blocked))
);
CREATE TABLE IF NOT EXISTS community_operations (
  ref uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id text NOT NULL,
  kind text NOT NULL,
  room_ref uuid REFERENCES community_rooms(ref),
  actor_source text NOT NULL CHECK(actor_source IN ('web','discord','system')),
  actor_user_id text,
  actor_member_ref uuid REFERENCES community_resources(ref),
  actor_key text NOT NULL,
  request_key text NOT NULL,
  request_hash text NOT NULL,
  scope_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  expected_version integer,
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','retry_wait','succeeded','failed','conflict','canceled','needs_review')),
  claim_token uuid,
  claimed_at timestamptz,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
  available_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  result jsonb NOT NULL DEFAULT 'null'::jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE(guild_id,actor_key,request_key)
);
CREATE INDEX IF NOT EXISTS community_operations_due ON community_operations(guild_id,available_at,created_at,ref)
  WHERE status IN ('queued','retry_wait');
CREATE INDEX IF NOT EXISTS community_operations_scope ON community_operations(guild_id,scope_key,created_at,ref)
  WHERE status IN ('queued','running','retry_wait','needs_review');
CREATE TABLE IF NOT EXISTS community_audit (
  ref uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id text NOT NULL,
  actor_source text NOT NULL CHECK(actor_source IN ('web','discord','system')),
  actor_user_id text,
  actor_member_ref uuid REFERENCES community_resources(ref),
  actor_label text NOT NULL,
  action text NOT NULL,
  target_ref uuid,
  outcome text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS community_audit_recent ON community_audit(guild_id,created_at DESC,ref DESC);

-- Foundation tables for the later feature services; business rules are enforced
-- by those services and the sole Discord executor, not by frontend inputs.
CREATE TABLE IF NOT EXISTS community_fun (
  ref uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('poll','teams','draw','roll','topic','ai')),
  title text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  room_ref uuid REFERENCES community_rooms(ref),
  creator_ref uuid REFERENCES community_resources(ref),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  closes_at timestamptz
);
CREATE INDEX IF NOT EXISTS community_fun_recent ON community_fun(guild_id,created_at DESC,ref DESC);
CREATE TABLE IF NOT EXISTS community_poll_votes (
  fun_ref uuid NOT NULL REFERENCES community_fun(ref) ON DELETE CASCADE,
  member_ref uuid NOT NULL REFERENCES community_resources(ref),
  choice integer NOT NULL CHECK(choice>=0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(fun_ref,member_ref)
);
CREATE TABLE IF NOT EXISTS community_ai_usage (
  guild_id text NOT NULL,
  day date NOT NULL,
  member_ref uuid NOT NULL REFERENCES community_resources(ref),
  count integer NOT NULL DEFAULT 0 CHECK(count>=0),
  PRIMARY KEY(guild_id,day,member_ref)
);
CREATE TABLE IF NOT EXISTS community_role_choices (
  guild_id text NOT NULL,
  member_ref uuid NOT NULL REFERENCES community_resources(ref),
  role_ref uuid NOT NULL REFERENCES community_resources(ref),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(guild_id,member_ref,role_ref)
);
CREATE TABLE IF NOT EXISTS community_welcomes (
  guild_id text NOT NULL,
  member_ref uuid NOT NULL REFERENCES community_resources(ref),
  joined_at timestamptz,
  last_sent_at timestamptz,
  pending_ref uuid REFERENCES community_operations(ref),
  PRIMARY KEY(guild_id,member_ref)
);
