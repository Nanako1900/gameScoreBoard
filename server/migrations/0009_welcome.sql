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
