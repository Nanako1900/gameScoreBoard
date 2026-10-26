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
