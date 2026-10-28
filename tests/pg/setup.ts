// Per-test isolation for the PG run: every table emptied and identities reset,
// matching the fresh isolated storage Miniflare gives each D1 test.

import { beforeEach } from 'vitest';
import { pool } from './cloudflare-test';

const TABLES = [
  'community_welcomes',
  'community_role_choices',
  'community_ai_usage',
  'community_poll_votes',
  'community_fun',
  'community_audit',
  'community_operations',
  'community_room_access',
  'community_rooms',
  'community_resources',
  'community_settings',
  'voice_sessions',
  'voice_coverage',
  'ai_verdicts',
  'session_players',
  'game_sessions',
  'score_events',
  'records',
  'weekly_heals',
  'weekly_reports',
  'app_settings',
  'discord_links',
  'link_audit',
  'outbox',
  'discord_messages',
  'users',
];

beforeEach(async () => {
  await pool.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
});
