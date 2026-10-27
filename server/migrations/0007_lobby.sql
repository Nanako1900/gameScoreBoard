-- v5 P2-3: invitation context and cancel reasons. The same change as D1's
-- migrations/004_lobby.sql. Same conventions as 0001: TEXT timestamps
-- (prev_starts_at ISO like starts_at; cancelled_at in SQLite's shape).
--
-- No trigger changes: session_players_outbox only looks at rsvp, and
-- sessions_outbox's cancel branch runs on the status change that is written in
-- the same UPDATE as cancel_reason / cancelled_at. The cancel DM reads the
-- session when it is delivered, so the reason is simply there.

ALTER TABLE session_players ADD COLUMN IF NOT EXISTS prev_rsvp      text;
ALTER TABLE session_players ADD COLUMN IF NOT EXISTS prev_starts_at text;
ALTER TABLE game_sessions   ADD COLUMN IF NOT EXISTS cancel_reason  text;
ALTER TABLE game_sessions   ADD COLUMN IF NOT EXISTS cancelled_at   text;
