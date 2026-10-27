-- S1: retire session notifications without removing tables or historical rows.
DROP TRIGGER IF EXISTS sessions_outbox ON game_sessions;
DROP TRIGGER IF EXISTS session_players_outbox ON session_players;
DROP TRIGGER IF EXISTS sessions_outbox_removed ON game_sessions;
DROP TRIGGER IF EXISTS session_players_knows ON session_players;

DROP FUNCTION IF EXISTS sessions_outbox();
DROP FUNCTION IF EXISTS session_players_outbox();
DROP FUNCTION IF EXISTS sessions_outbox_removed();
DROP FUNCTION IF EXISTS session_players_knows();
DROP FUNCTION IF EXISTS outbox_session_card(bigint);
DROP FUNCTION IF EXISTS outbox_session_reminders(game_sessions, boolean);
DROP FUNCTION IF EXISTS outbox_iso(text);

DELETE FROM outbox
 WHERE processed_at IS NULL AND (entity = 'session' OR kind LIKE 'dm.session.%');

-- The old card's location travels with the removal, even when its channel is
-- no longer configured. outbox_emit's dedupe key makes re-execution safe.
SELECT outbox_emit(
  'session.removed', 'session', entity_id, 'session:' || entity_id || ':removed:s1',
  jsonb_build_object('channel_id', channel_id, 'message_id', message_id), now()
)
  FROM discord_messages
 WHERE entity = 'session' AND purpose = 'card';
