-- S2: welcome only new/replaced bindings; existing rows are never backfilled.
CREATE OR REPLACE FUNCTION discord_links_welcome() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('edg.importing', true) = 'on' THEN
    RETURN NULL;
  END IF;

  -- linked_at is second-resolution text. The UUID preserves one event per
  -- genuine insertion, including an unlink/rebind within the same second.
  PERFORM outbox_emit(
    'dm.welcome', 'user', NEW.user_id,
    'dm:welcome:' || NEW.discord_user_id || ':' || NEW.linked_at || ':' || gen_random_uuid()::text,
    '{}'::jsonb, now()
  );
  PERFORM pg_notify('outbox', '');
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS discord_links_welcome ON discord_links;
CREATE TRIGGER discord_links_welcome
  AFTER INSERT ON discord_links
  FOR EACH ROW EXECUTE FUNCTION discord_links_welcome();

-- The Node-only retry endpoint calls this once. Keep quota admission, reopening
-- DMs and enqueueing in one transaction, including when requests arrive together.
CREATE OR REPLACE FUNCTION queue_welcome_resend(p_user_id text, p_millis text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  notifications bigint;
  retries bigint;
BEGIN
  -- The user survives unlink/rebind. NO KEY UPDATE serializes their retries
  -- without conflicting with the FK's KEY SHARE lock when a binding is inserted.
  PERFORM id FROM users WHERE id = p_user_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN 'unbound';
  END IF;

  SELECT notify_dm INTO notifications FROM discord_links WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'unbound';
  END IF;
  IF notifications <> 1 THEN
    RETURN 'off';
  END IF;

  -- A separate statement after acquiring the lock sees retries committed by
  -- earlier contenders. Queued, sent, skipped and dead attempts all count.
  SELECT count(*) INTO retries FROM outbox
    WHERE kind = 'dm.welcome' AND entity = 'user' AND entity_id = p_user_id
      AND dedupe_key LIKE '%:resend:%' AND created_at > now() - interval '24 hours';
  IF retries >= 3 THEN
    RETURN 'limited';
  END IF;

  UPDATE discord_links SET dm_ok = 1 WHERE user_id = p_user_id;
  PERFORM outbox_emit(
    'dm.welcome', 'user', p_user_id,
    'dm:welcome:' || p_user_id || ':resend:' || p_millis || ':' || gen_random_uuid()::text,
    '{}'::jsonb, now()
  );
  PERFORM pg_notify('outbox', '');
  RETURN 'queued';
END;
$$;
