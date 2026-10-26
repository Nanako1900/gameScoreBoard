-- P7: game sessions in Discord — a card in the session channel that follows
-- the session (RSVP counts, time, cancellation), and DMs: an invitation, 15
-- minutes before the start for those going, a roll-call reminder for the
-- organizer, and a note when a session is moved or cancelled.
--
-- Same outbox as 0003/0004. Card events are per session (entity 'session');
-- DMs per recipient (entity 'user'). 'session.starting' is delivered by
-- fanning out to whoever is going at that moment.
--
-- Notifications skip the organizer on the assumption that they made the
-- change; when an admin cancels or moves someone else's session, the organizer
-- sees it on the card and the web instead.

/** A stored ISO 8601 instant (starts_at) as timestamptz; NULL if it is not one. */
CREATE OR REPLACE FUNCTION outbox_iso(value text) RETURNS timestamptz
LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN value::timestamptz;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

/**
 * The timed events of a session, (re)scheduled from its time and length: the
 * 15-minute reminder, the card's own refresh at the start (its RSVP buttons go
 * then), and the organizer's roll-call reminder at the end.
 */
CREATE OR REPLACE FUNCTION outbox_session_reminders(s game_sessions) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  sid text := s.id::text;
  ref jsonb := jsonb_build_object('session_id', s.id);
  starts timestamptz := outbox_iso(s.starts_at);
BEGIN
  IF starts IS NULL THEN
    RETURN;
  END IF;
  IF starts - interval '15 minutes' > now() THEN
    PERFORM outbox_schedule('session.starting', 'session', sid, 'session:' || sid || ':starting', ref,
                            starts - interval '15 minutes');
  ELSE
    -- Moved to start within 15 minutes: an older reminder would now be wrong.
    UPDATE outbox SET processed_at = now(), result = 'skipped', last_error = 'start moved too close'
     WHERE dedupe_key = 'session:' || sid || ':starting' AND processed_at IS NULL;
  END IF;
  IF starts > now() THEN
    PERFORM outbox_schedule('session.card', 'session', sid, 'session:' || sid || ':card:start', ref, starts);
  END IF;
  PERFORM outbox_schedule('dm.session.rollcall', 'user', s.organizer_id, 'dm:session:' || sid || ':rollcall', ref,
                          starts + make_interval(mins => COALESCE(s.duration_min, 120)::int));
END;
$$;

CREATE OR REPLACE FUNCTION sessions_outbox() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  sid text := NEW.id::text;
  ref jsonb := jsonb_build_object('session_id', NEW.id);
BEGIN
  IF current_setting('edg.importing', true) = 'on' THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'open' THEN
      RETURN NULL;
    END IF;
    PERFORM outbox_emit('session.card', 'session', sid, 'session:' || sid || ':card:' || txid_current(), ref, NULL);
    PERFORM outbox_session_reminders(NEW);
  ELSE
    -- Only what the card shows. (setRsvp's lock writes the row unchanged.)
    IF NEW.title IS NOT DISTINCT FROM OLD.title AND NEW.game IS NOT DISTINCT FROM OLD.game
       AND NEW.starts_at IS NOT DISTINCT FROM OLD.starts_at AND NEW.capacity IS NOT DISTINCT FROM OLD.capacity
       AND NEW.duration_min IS NOT DISTINCT FROM OLD.duration_min AND NEW.note IS NOT DISTINCT FROM OLD.note
       AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
      RETURN NULL;
    END IF;
    PERFORM outbox_emit('session.card', 'session', sid, 'session:' || sid || ':card:' || txid_current(), ref, NULL);

    IF NEW.status = 'cancelled' AND OLD.status = 'open' THEN
      -- Tell everyone who said they would (or might) come.
      INSERT INTO outbox (kind, entity, entity_id, dedupe_key, payload)
      SELECT 'dm.session.cancelled', 'user', sp.user_id, 'dm:session:' || sid || ':cancelled:' || sp.user_id, ref
        FROM session_players sp
       WHERE sp.session_id = NEW.id AND sp.rsvp IN ('going', 'maybe') AND sp.user_id <> NEW.organizer_id
      ON CONFLICT (dedupe_key) DO NOTHING;
    ELSIF NEW.status = 'open' AND NEW.starts_at IS DISTINCT FROM OLD.starts_at THEN
      INSERT INTO outbox (kind, entity, entity_id, dedupe_key, payload)
      SELECT 'dm.session.changed', 'user', sp.user_id,
             'dm:session:' || sid || ':changed:' || txid_current() || ':' || sp.user_id, ref
        FROM session_players sp
       WHERE sp.session_id = NEW.id AND sp.rsvp IN ('going', 'maybe', 'invited') AND sp.user_id <> NEW.organizer_id
      ON CONFLICT (dedupe_key) DO NOTHING;
      PERFORM outbox_session_reminders(NEW);
    ELSIF NEW.status = 'open' AND NEW.duration_min IS DISTINCT FROM OLD.duration_min THEN
      -- A longer or shorter session: the roll-call reminder moves with its end.
      PERFORM outbox_session_reminders(NEW);
    END IF;
  END IF;

  PERFORM pg_notify('outbox', '');
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS sessions_outbox ON game_sessions;
CREATE TRIGGER sessions_outbox
  AFTER INSERT OR UPDATE ON game_sessions
  FOR EACH ROW EXECUTE FUNCTION sessions_outbox();

-- Who is coming changed: refresh the card; a new invitation is a DM.
CREATE OR REPLACE FUNCTION session_players_outbox() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  s_id bigint;
BEGIN
  IF current_setting('edg.importing', true) = 'on' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN
    s_id := OLD.session_id;
  ELSE
    s_id := NEW.session_id;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.rsvp IS NOT DISTINCT FROM OLD.rsvp THEN
    RETURN NULL;
  END IF;
  PERFORM outbox_emit('session.card', 'session', s_id::text, 'session:' || s_id || ':card:' || txid_current(),
                      jsonb_build_object('session_id', s_id), NULL);
  IF TG_OP = 'INSERT' AND NEW.rsvp = 'invited' THEN
    PERFORM outbox_emit('dm.session.invited', 'user', NEW.user_id, 'dm:session:' || s_id || ':invited:' || NEW.user_id,
                        jsonb_build_object('session_id', s_id), NULL);
  END IF;
  PERFORM pg_notify('outbox', '');
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS session_players_outbox ON session_players;
CREATE TRIGGER session_players_outbox
  AFTER INSERT OR DELETE OR UPDATE OF rsvp ON session_players
  FOR EACH ROW EXECUTE FUNCTION session_players_outbox();

-- A session deleted (its organizer's account was): take its card down.
CREATE OR REPLACE FUNCTION sessions_outbox_removed() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  posted record;
BEGIN
  SELECT channel_id, message_id INTO posted
    FROM discord_messages WHERE entity = 'session' AND entity_id = OLD.id::text AND purpose = 'card';
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  INSERT INTO outbox (kind, entity, entity_id, dedupe_key, payload)
  VALUES ('session.removed', 'session', OLD.id::text, 'session:' || OLD.id || ':removed',
          jsonb_build_object('channel_id', posted.channel_id, 'message_id', posted.message_id))
  ON CONFLICT (dedupe_key) DO NOTHING;
  PERFORM pg_notify('outbox', '');
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS sessions_outbox_removed ON game_sessions;
CREATE TRIGGER sessions_outbox_removed
  AFTER DELETE ON game_sessions
  FOR EACH ROW EXECUTE FUNCTION sessions_outbox_removed();
