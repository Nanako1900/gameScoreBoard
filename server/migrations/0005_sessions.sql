-- P7: game sessions in Discord — a card in the session channel that follows
-- the session (RSVP counts, time, cancellation), and DMs: an invitation, 15
-- minutes before the start for those going, a roll-call reminder for the
-- organizer, and a note when a session is moved or cancelled.
--
-- Same outbox as 0003/0004. Card events are per session (entity 'session');
-- DMs per recipient (entity 'user'). 'session.starting' is delivered by
-- fanning out to whoever is going at that moment; it has its own queue
-- (entity_id '<id>:starting') so a card stuck in retries cannot hold it up.
--
-- Bursty changes are coalesced, not queued one by one: the card has ONE
-- refresh event per session, re-armed a moment out on every change (delivery
-- renders the current state anyway), and "the time changed" is one DM per
-- (session, person), re-armed a few minutes out — an RSVP toggled 60 times, or
-- a session moved 10 times, is one edit and one DM.
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

/** The card's one refresh event, due a moment from now (coalescing a burst). */
CREATE OR REPLACE FUNCTION outbox_session_card(p_session_id bigint) RETURNS void
LANGUAGE sql AS $$
  SELECT outbox_schedule('session.card', 'session', p_session_id::text, 'session:' || p_session_id || ':card',
                         jsonb_build_object('session_id', p_session_id), now() + interval '2 seconds');
$$;

/**
 * The timed events of a session, (re)scheduled from its time and length: the
 * 15-minute reminder, the card's own refresh at the start (its RSVP buttons go
 * then), and the organizer's roll-call reminder at the end. `start_moved` is
 * false when only the length changed: then a due-but-unsent start reminder is
 * left alone.
 */
CREATE OR REPLACE FUNCTION outbox_session_reminders(s game_sessions, start_moved boolean) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  sid text := s.id::text;
  ref jsonb := jsonb_build_object('session_id', s.id);
  starts timestamptz := outbox_iso(s.starts_at);
  ends timestamptz;
BEGIN
  IF starts IS NULL THEN
    RETURN;
  END IF;
  IF start_moved THEN
    IF starts - interval '15 minutes' > now() THEN
      PERFORM outbox_schedule('session.starting', 'session', sid || ':starting', 'session:' || sid || ':starting', ref,
                              starts - interval '15 minutes');
    ELSE
      -- Moved to start within 15 minutes: an older reminder would now be wrong.
      UPDATE outbox SET processed_at = now(), result = 'skipped', last_error = 'start moved too close'
       WHERE dedupe_key = 'session:' || sid || ':starting' AND processed_at IS NULL;
    END IF;
    IF starts > now() THEN
      PERFORM outbox_schedule('session.card', 'session', sid, 'session:' || sid || ':card:start', ref, starts);
    END IF;
  END IF;
  ends := starts + make_interval(mins => COALESCE(s.duration_min, 120)::int);
  -- Not again for an end that has already come (and been reminded of).
  IF ends > now() OR NOT EXISTS (
       SELECT 1 FROM outbox WHERE dedupe_key = 'dm:session:' || sid || ':rollcall' AND processed_at IS NOT NULL) THEN
    PERFORM outbox_schedule('dm.session.rollcall', 'user', s.organizer_id, 'dm:session:' || sid || ':rollcall', ref, ends);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION sessions_outbox() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  sid text := NEW.id::text;
  ref jsonb := jsonb_build_object('session_id', NEW.id);
  player record;
BEGIN
  IF current_setting('edg.importing', true) = 'on' THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'open' THEN
      RETURN NULL;
    END IF;
    PERFORM outbox_session_card(NEW.id);
    PERFORM outbox_session_reminders(NEW, true);
  ELSE
    -- Only what the card shows. (setRsvp's lock writes the row unchanged.)
    IF NEW.title IS NOT DISTINCT FROM OLD.title AND NEW.game IS NOT DISTINCT FROM OLD.game
       AND NEW.starts_at IS NOT DISTINCT FROM OLD.starts_at AND NEW.capacity IS NOT DISTINCT FROM OLD.capacity
       AND NEW.duration_min IS NOT DISTINCT FROM OLD.duration_min AND NEW.note IS NOT DISTINCT FROM OLD.note
       AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
      RETURN NULL;
    END IF;
    PERFORM outbox_session_card(NEW.id);

    IF NEW.status = 'cancelled' AND OLD.status = 'open' AND outbox_iso(NEW.starts_at) > now() THEN
      -- Tell everyone still in it — a yes, a maybe, or an invitation not yet
      -- answered (a move puts the yeses back there) — while it is still ahead:
      -- cancelling one that already happened is bookkeeping, not news.
      INSERT INTO outbox (kind, entity, entity_id, dedupe_key, payload)
      SELECT 'dm.session.cancelled', 'user', sp.user_id, 'dm:session:' || sid || ':cancelled:' || sp.user_id, ref
        FROM session_players sp
       WHERE sp.session_id = NEW.id AND sp.rsvp IN ('going', 'maybe', 'invited') AND sp.user_id <> NEW.organizer_id
      ON CONFLICT (dedupe_key) DO NOTHING;
    ELSIF NEW.status = 'open' AND NEW.starts_at IS DISTINCT FROM OLD.starts_at THEN
      -- One "the time changed" DM per person, however often it moves — to
      -- everyone in it: a move asks them all to answer again, a no included.
      FOR player IN
        SELECT sp.user_id FROM session_players sp
         WHERE sp.session_id = NEW.id AND sp.user_id <> NEW.organizer_id
      LOOP
        PERFORM outbox_schedule('dm.session.changed', 'user', player.user_id,
                                'dm:session:' || sid || ':changed:' || player.user_id, ref, now() + interval '3 minutes');
      END LOOP;
      PERFORM outbox_session_reminders(NEW, true);
    ELSIF NEW.status = 'open' AND NEW.duration_min IS DISTINCT FROM OLD.duration_min THEN
      -- A longer or shorter session: the roll-call reminder moves with its end.
      PERFORM outbox_session_reminders(NEW, false);
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
  PERFORM outbox_session_card(s_id);
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
