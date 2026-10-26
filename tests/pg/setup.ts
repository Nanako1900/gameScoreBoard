// Per-test isolation for the PG run: every table emptied and identities reset,
// matching the fresh isolated storage Miniflare gives each D1 test.

import { beforeEach } from 'vitest';
import { pool } from './cloudflare-test';

const TABLES = [
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
