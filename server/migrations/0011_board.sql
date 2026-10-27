-- S4: public information board. Keep retired session entities and history.
ALTER TABLE outbox DROP CONSTRAINT IF EXISTS outbox_entity_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_entity_check
  CHECK (entity IN ('record', 'session', 'report', 'link', 'user', 'board'));
ALTER TABLE discord_messages DROP CONSTRAINT IF EXISTS discord_messages_entity_check;
ALTER TABLE discord_messages ADD CONSTRAINT discord_messages_entity_check
  CHECK (entity IN ('record', 'session', 'report', 'board'));

-- Both triggers and the bot's startup use this entry point. An advisory lock
-- also covers the first schedule, when there is not yet a dedupe row to lock.
-- It is deliberately distinct from the delivery lock: source writes never
-- wait for a Discord request while holding this scheduling lock.
CREATE OR REPLACE FUNCTION schedule_board_refresh() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('edg.importing', true) = 'on' THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('board:main:schedule', 0));
  PERFORM outbox_schedule('board.refresh', 'board', 'main', 'board:main:refresh',
    '{}'::jsonb, now() + interval '10 seconds', true);
  PERFORM pg_notify('outbox', '');
END;
$$;

-- Acquire the shared scheduling lock before any source row is locked. Case
-- transactions lock records before users, while score edits start with users;
-- taking this lock only AFTER the statement would invert those row-lock orders.
CREATE OR REPLACE FUNCTION board_refresh_lock() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('edg.importing', true) = 'on' THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('board:main:schedule', 0));
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION board_refresh() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM schedule_board_refresh();
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS score_events_board_lock ON score_events;
CREATE TRIGGER score_events_board_lock
  BEFORE INSERT ON score_events
  FOR EACH STATEMENT EXECUTE FUNCTION board_refresh_lock();

DROP TRIGGER IF EXISTS score_events_board_refresh ON score_events;
CREATE TRIGGER score_events_board_refresh
  AFTER INSERT ON score_events
  FOR EACH STATEMENT EXECUTE FUNCTION board_refresh();

DROP TRIGGER IF EXISTS records_board_lock ON records;
CREATE TRIGGER records_board_lock
  BEFORE INSERT OR UPDATE OF status OR DELETE ON records
  FOR EACH STATEMENT EXECUTE FUNCTION board_refresh_lock();

DROP TRIGGER IF EXISTS records_board_refresh ON records;
CREATE TRIGGER records_board_refresh
  AFTER INSERT OR UPDATE OF status OR DELETE ON records
  FOR EACH STATEMENT EXECUTE FUNCTION board_refresh();

DROP TRIGGER IF EXISTS users_board_lock ON users;
CREATE TRIGGER users_board_lock
  BEFORE INSERT OR DELETE OR UPDATE OF username, display_name, is_participant, score ON users
  FOR EACH STATEMENT EXECUTE FUNCTION board_refresh_lock();

DROP TRIGGER IF EXISTS users_board_refresh ON users;
CREATE TRIGGER users_board_refresh
  AFTER INSERT OR DELETE OR UPDATE OF username, display_name, is_participant, score ON users
  FOR EACH STATEMENT EXECUTE FUNCTION board_refresh();

DROP TRIGGER IF EXISTS weekly_reports_board_lock ON weekly_reports;
CREATE TRIGGER weekly_reports_board_lock
  BEFORE INSERT OR UPDATE ON weekly_reports
  FOR EACH STATEMENT EXECUTE FUNCTION board_refresh_lock();

DROP TRIGGER IF EXISTS weekly_reports_board_refresh ON weekly_reports;
CREATE TRIGGER weekly_reports_board_refresh
  AFTER INSERT OR UPDATE ON weekly_reports
  FOR EACH STATEMENT EXECUTE FUNCTION board_refresh();
