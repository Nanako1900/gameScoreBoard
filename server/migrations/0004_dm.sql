-- P6: direct messages about a person's own cases — filed (with a 写陈述
-- button), 2 hours before the statement deadline, the verdict, an override, a
-- revoke, a withdrawal — and appeals to the admins. Same outbox and trigger as
-- 0003: each event commits with the change that caused it.
--
-- DM events are queued per recipient (entity 'user', entity_id = users.id), so
-- one person's messages go out in order; payload.record_id names the case.

-- Set false when Discord says this person does not accept DMs from the bot
-- (50007); back to true when they next use the bot or /notify.
ALTER TABLE discord_links ADD COLUMN IF NOT EXISTS dm_ok bigint NOT NULL DEFAULT 1;

-- When Discord first refused (401/403) to deliver this event: retries are
-- counted from here, not from when the event was created.
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS refused_since timestamptz;

/** A stored 'YYYY-MM-DD HH:MM:SS' (UTC) as timestamptz; NULL if it is not one. */
CREATE OR REPLACE FUNCTION outbox_utc(value text) RETURNS timestamptz
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN value::timestamp AT TIME ZONE 'UTC';
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

-- A one-off event: the first one with this dedupe key wins.
CREATE OR REPLACE FUNCTION outbox_emit(
  p_kind text, p_entity text, p_entity_id text, p_dedupe text, p_payload jsonb, p_at timestamptz
) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO outbox (kind, entity, entity_id, dedupe_key, payload, available_at)
  VALUES (p_kind, p_entity, p_entity_id, p_dedupe, p_payload, COALESCE(p_at, now()))
  ON CONFLICT (dedupe_key) DO NOTHING;
$$;

-- A reminder: re-scheduled (and re-armed, even if already sent) when its time moves.
CREATE OR REPLACE FUNCTION outbox_schedule(
  p_kind text, p_entity text, p_entity_id text, p_dedupe text, p_payload jsonb, p_at timestamptz
) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO outbox (kind, entity, entity_id, dedupe_key, payload, available_at)
  VALUES (p_kind, p_entity, p_entity_id, p_dedupe, p_payload, p_at)
  ON CONFLICT (dedupe_key) DO UPDATE
    SET available_at = excluded.available_at, processed_at = NULL, result = NULL,
        claim_token = NULL, claimed_at = NULL, attempts = 0, last_error = NULL,
        refused_since = NULL, created_at = now();
$$;

CREATE OR REPLACE FUNCTION records_outbox() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  rid text := NEW.id::text;
  dm jsonb := jsonb_build_object('record_id', NEW.id);
  remind timestamptz;
BEGIN
  -- The D1 import (server/src/import-d1.ts) copies history; none of it is news.
  IF current_setting('edg.importing', true) = 'on' THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Bonuses arrive already decided: nothing to tell anyone.
    IF NEW.status <> 'awaiting_statement' THEN
      RETURN NULL;
    END IF;
    -- A few minutes' grace: a case withdrawn or answered on the web straight
    -- away never DMs at all (delivery checks it is still awaiting).
    PERFORM outbox_emit('dm.filed', 'user', NEW.subject_id, 'dm:case:' || rid || ':filed', dm,
                        now() + interval '3 minutes');
    remind := outbox_utc(NEW.deadline_at) - interval '2 hours';
    IF remind > now() + interval '3 minutes' THEN
      PERFORM outbox_schedule('dm.deadline', 'user', NEW.subject_id, 'dm:case:' || rid || ':deadline', dm, remind);
    END IF;

  ELSIF NEW.status = 'decided' AND OLD.status = 'judging' THEN
    PERFORM outbox_emit('case.decided', 'record', rid, 'case:' || rid || ':decided', '{}', NULL);
    PERFORM outbox_emit('dm.decided', 'user', NEW.subject_id, 'dm:case:' || rid || ':decided', dm, NULL);

  ELSIF NEW.status = 'decided' AND OLD.status IN ('decided', 'appealed') AND NEW.verdict_source = 'admin_override'
        AND (NEW.delta IS DISTINCT FROM OLD.delta OR OLD.verdict_source IS DISTINCT FROM 'admin_override'
             OR OLD.status = 'appealed') THEN
    -- (An appeal answered by an override, even at the same points, is news to the subject.)
    -- A case can be re-sentenced more than once: one event per transaction.
    PERFORM outbox_emit('case.overridden', 'record', rid, 'case:' || rid || ':overridden:' || txid_current(), '{}', NULL);
    PERFORM outbox_emit('dm.overridden', 'user', NEW.subject_id,
                        'dm:case:' || rid || ':overridden:' || txid_current(), dm, NULL);

  ELSIF NEW.status = 'revoked' AND OLD.status IS DISTINCT FROM 'revoked' THEN
    PERFORM outbox_emit('case.revoked', 'record', rid, 'case:' || rid || ':revoked', '{}', NULL);
    PERFORM outbox_emit('dm.revoked', 'user', NEW.subject_id, 'dm:case:' || rid || ':revoked', dm, NULL);

  ELSIF NEW.status = 'withdrawn' AND OLD.status IS DISTINCT FROM 'withdrawn' THEN
    PERFORM outbox_emit('dm.withdrawn', 'user', NEW.subject_id, 'dm:case:' || rid || ':withdrawn', dm, NULL);

  ELSIF NEW.status = 'appealed' AND OLD.status = 'decided' THEN
    -- Every admin, each in their own queue.
    INSERT INTO outbox (kind, entity, entity_id, dedupe_key, payload)
    SELECT 'dm.appealed', 'user', u.id, 'dm:case:' || rid || ':appeal:' || txid_current() || ':' || u.id, dm
      FROM users u
     WHERE u.is_admin = 1
    ON CONFLICT (dedupe_key) DO NOTHING;

  ELSIF NEW.status = 'awaiting_statement' AND NEW.deadline_at IS DISTINCT FROM OLD.deadline_at THEN
    -- The deadline moved (e.g. extended over an outage): move the reminder too
    -- — at once, if the new deadline is already less than 2 hours away; but
    -- never before the filing DM (and its grace for a withdrawal straight away).
    IF outbox_utc(NEW.deadline_at) > now() THEN
      remind := GREATEST(outbox_utc(NEW.deadline_at) - interval '2 hours', now(),
                         outbox_utc(NEW.created_at) + interval '3 minutes');
      PERFORM outbox_schedule('dm.deadline', 'user', NEW.subject_id, 'dm:case:' || rid || ':deadline', dm, remind);
    END IF;

  ELSE
    RETURN NULL;
  END IF;

  -- Delivered only when (and if) the transaction commits.
  PERFORM pg_notify('outbox', '');
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS records_outbox ON records;
CREATE TRIGGER records_outbox
  AFTER INSERT OR UPDATE OF status, delta, deadline_at ON records
  FOR EACH ROW EXECUTE FUNCTION records_outbox();

-- A record deleted (its user was): besides its channel post (0003), the DMs
-- about it — the filing and the reminder, which quote the accusation — are
-- rewritten to say so. The record is gone by then, so the message ids travel.
CREATE OR REPLACE FUNCTION records_outbox_removed() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  posted record;
BEGIN
  FOR posted IN
    SELECT purpose, channel_id, message_id FROM discord_messages
     WHERE entity = 'record' AND entity_id = OLD.id::text
  LOOP
    IF posted.purpose = 'verdict' THEN
      INSERT INTO outbox (kind, entity, entity_id, dedupe_key, payload)
      VALUES ('case.removed', 'record', OLD.id::text, 'case:' || OLD.id || ':removed',
              jsonb_build_object('channel_id', posted.channel_id, 'message_id', posted.message_id))
      ON CONFLICT (dedupe_key) DO NOTHING;
    ELSE
      INSERT INTO outbox (kind, entity, entity_id, dedupe_key, payload)
      VALUES ('dm.removed', 'user', OLD.subject_id, 'dm:case:' || OLD.id || ':removed:' || posted.purpose,
              jsonb_build_object('record_id', OLD.id, 'purpose', posted.purpose,
                                 'channel_id', posted.channel_id, 'message_id', posted.message_id))
      ON CONFLICT (dedupe_key) DO NOTHING;
    END IF;
  END LOOP;
  PERFORM pg_notify('outbox', '');
  RETURN NULL;
END;
$$;
