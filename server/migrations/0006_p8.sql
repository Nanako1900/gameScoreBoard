-- P8: more of what happens on the board reaches Discord.
--
-- Same outbox as 0003–0005; the D1 import (edg.importing) emits nothing.

-- The weekly report: posted in the verdict channel when a week's report is
-- written, edited when it is rewritten (the AI's paragraph landing after the
-- template, an admin's re-roll). Entity 'report', entity_id the week.
CREATE OR REPLACE FUNCTION weekly_reports_outbox() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  week text := NEW.week_start;
  ref jsonb := jsonb_build_object('week_start', NEW.week_start);
BEGIN
  IF current_setting('edg.importing', true) = 'on' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'INSERT' THEN
    -- A minute's wait: the AI's paragraph (at most 20 s) normally replaces the
    -- template first, so the first post already has it.
    PERFORM outbox_emit('report.ready', 'report', week, 'report:' || week || ':ready', ref,
                        now() + interval '1 minute');
  ELSIF NEW.narrative IS DISTINCT FROM OLD.narrative OR NEW.stats_json IS DISTINCT FROM OLD.stats_json
        OR NEW.source IS DISTINCT FROM OLD.source THEN
    -- One edit for a burst of rewrites.
    PERFORM outbox_schedule('report.updated', 'report', week, 'report:' || week || ':updated', ref,
                            now() + interval '2 seconds', true);
  ELSE
    RETURN NULL;
  END IF;
  PERFORM pg_notify('outbox', '');
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS weekly_reports_outbox ON weekly_reports;
CREATE TRIGGER weekly_reports_outbox
  AFTER INSERT OR UPDATE ON weekly_reports
  FOR EACH ROW EXECUTE FUNCTION weekly_reports_outbox();

-- The AI's escalation hint (escalation_suggested) is the filing judge's to
-- settle: a DM asks them while it is open (awaiting a statement, flag set),
-- and is rewritten without its buttons once it is not — confirmed, dismissed,
-- re-typed, withdrawn, or the case gone to judgment. At once, no grace: the
-- judge can settle it before the subject's filing DM goes out (+3 min).
CREATE OR REPLACE FUNCTION records_outbox_escalation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  rid text := NEW.id::text;
  ref jsonb := jsonb_build_object('record_id', NEW.id);
  was_open boolean := TG_OP = 'UPDATE' AND OLD.status = 'awaiting_statement' AND OLD.escalation_suggested = 1;
  is_open boolean := NEW.status = 'awaiting_statement' AND NEW.escalation_suggested = 1;
BEGIN
  IF current_setting('edg.importing', true) = 'on' THEN
    RETURN NULL;
  END IF;
  IF is_open AND NOT was_open THEN
    PERFORM outbox_emit('dm.escalation', 'user', NEW.reporter_id, 'dm:case:' || rid || ':esc', ref, now());
  ELSIF was_open AND NOT is_open THEN
    PERFORM outbox_emit('dm.escalation.closed', 'user', NEW.reporter_id, 'dm:case:' || rid || ':esc:closed', ref, NULL);
  ELSE
    RETURN NULL;
  END IF;
  PERFORM pg_notify('outbox', '');
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS records_outbox_escalation ON records;
CREATE TRIGGER records_outbox_escalation
  AFTER INSERT OR UPDATE OF status, escalation_suggested ON records
  FOR EACH ROW EXECUTE FUNCTION records_outbox_escalation();

-- A charge changed before the verdict (an escalation confirmed, a re-type):
-- the subject's filing DM and reminder say what they are accused of, so they
-- are rewritten in place — no new DM. One for a burst of changes.
CREATE OR REPLACE FUNCTION records_outbox_recharged() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('edg.importing', true) = 'on' THEN
    RETURN NULL;
  END IF;
  IF NEW.type IS NOT DISTINCT FROM OLD.type OR NEW.status <> 'awaiting_statement' THEN
    RETURN NULL;
  END IF;
  PERFORM outbox_schedule('dm.recharged', 'user', NEW.subject_id, 'dm:case:' || NEW.id || ':recharged',
                          jsonb_build_object('record_id', NEW.id), now() + interval '2 seconds', true);
  PERFORM pg_notify('outbox', '');
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS records_outbox_recharged ON records;
CREATE TRIGGER records_outbox_recharged
  AFTER UPDATE OF type ON records
  FOR EACH ROW EXECUTE FUNCTION records_outbox_recharged();

-- As in 0004, plus: the escalation DM went to the reporter, not the subject.
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
      VALUES ('dm.removed', 'user',
              CASE WHEN posted.purpose = 'dm:esc' THEN OLD.reporter_id ELSE OLD.subject_id END,
              'dm:case:' || OLD.id || ':removed:' || posted.purpose,
              jsonb_build_object('record_id', OLD.id, 'purpose', posted.purpose,
                                 'channel_id', posted.channel_id, 'message_id', posted.message_id))
      ON CONFLICT (dedupe_key) DO NOTHING;
    END IF;
  END LOOP;
  PERFORM pg_notify('outbox', '');
  RETURN NULL;
END;
$$;

-- An admin set someone's score by hand: tell them (old → new). Only real
-- changes, and only admin corrections — verdicts, revokes and overrides have
-- DMs of their own; the weekly heal and bonuses are in the weekly report.
CREATE OR REPLACE FUNCTION score_events_outbox() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('edg.importing', true) = 'on' THEN
    RETURN NULL;
  END IF;
  PERFORM outbox_emit('dm.score.adjusted', 'user', NEW.user_id, 'dm:score:' || NEW.id,
                      jsonb_build_object('score_event_id', NEW.id, 'delta', NEW.delta, 'resulting_score', NEW.resulting_score),
                      NULL);
  PERFORM pg_notify('outbox', '');
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS score_events_outbox ON score_events;
CREATE TRIGGER score_events_outbox
  AFTER INSERT ON score_events
  FOR EACH ROW WHEN (NEW.reason = 'admin_adjust' AND NEW.delta <> 0)
  EXECUTE FUNCTION score_events_outbox();
