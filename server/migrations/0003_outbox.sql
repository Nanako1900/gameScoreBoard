-- P5: verdicts posted to the Discord channel, through a transactional outbox.
--
-- Events come from a trigger on `records`, not from the domain code: that code
-- (worker/*.ts) is shared with the Worker, which still runs on D1, where no
-- outbox exists. A trigger is just as transactional — the event row commits
-- or rolls back with the verdict that caused it — and fires only for rows an
-- UPDATE really changed, so a guarded write that matched nothing emits nothing.
--
-- The bot's dispatcher (server/src/outbox/dispatcher.ts) delivers the events.
-- Unlike 0001/0002 these tables are read by the dispatcher alone, never by the
-- Worker code, so they use real timestamptz.

CREATE TABLE IF NOT EXISTS outbox (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind         text NOT NULL,                     -- case.decided | case.revoked | case.overridden
  entity       text NOT NULL CHECK (entity IN ('record', 'session', 'report', 'link', 'user')),
  entity_id    text NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  dedupe_key   text NOT NULL UNIQUE,
  available_at timestamptz NOT NULL DEFAULT now(),
  -- A random token per claim: comparing timestamps would not work, because a
  -- parsed timestamptz loses its microseconds.
  claim_token  uuid,
  claimed_at   timestamptz,
  processed_at timestamptz,
  result       text CHECK (result IN ('sent', 'skipped', 'dead')),
  attempts     integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_outbox_due    ON outbox (available_at, id) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_outbox_entity ON outbox (entity, entity_id, id) WHERE processed_at IS NULL;

-- The message posted for an entity, so a later event edits it instead of
-- posting again.
CREATE TABLE IF NOT EXISTS discord_messages (
  entity     text NOT NULL CHECK (entity IN ('record', 'session', 'report')),
  entity_id  text NOT NULL,
  purpose    text NOT NULL,
  channel_id text NOT NULL,
  message_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity, entity_id, purpose)
);

-- The three verdict events of a case. Which one a change is follows from the
-- status transition:
--   judging            → decided   case.decided    (AI or fallback verdict)
--   decided / appealed → decided   case.overridden (an admin's new sentence
--                                                   that moved the delta)
--   anything           → revoked   case.revoked
-- A bonus is inserted already decided and then has its applied delta written
-- in (decided → decided): not an override, and never an event.
CREATE OR REPLACE FUNCTION records_outbox() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  event text;
  dedupe text;
BEGIN
  IF NEW.status = 'decided' AND OLD.status = 'judging' THEN
    event := 'case.decided';
    dedupe := 'case:' || NEW.id || ':decided';
  ELSIF NEW.status = 'decided' AND OLD.status IN ('decided', 'appealed')
        AND NEW.verdict_source = 'admin_override' AND NEW.delta IS DISTINCT FROM OLD.delta THEN
    event := 'case.overridden';
    -- A case can be re-sentenced more than once: one event per transaction.
    dedupe := 'case:' || NEW.id || ':overridden:' || txid_current();
  ELSIF NEW.status = 'revoked' AND OLD.status IS DISTINCT FROM 'revoked' THEN
    event := 'case.revoked';
    dedupe := 'case:' || NEW.id || ':revoked';
  ELSE
    RETURN NULL;
  END IF;
  INSERT INTO outbox (kind, entity, entity_id, dedupe_key)
  VALUES (event, 'record', NEW.id::text, dedupe)
  ON CONFLICT (dedupe_key) DO NOTHING;
  -- Delivered only when (and if) the transaction commits.
  PERFORM pg_notify('outbox', '');
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS records_outbox ON records;
CREATE TRIGGER records_outbox
  AFTER UPDATE OF status, delta ON records
  FOR EACH ROW EXECUTE FUNCTION records_outbox();
