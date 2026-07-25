// Applies schema.sql to the in-memory D1 before each integration test file, and
// truncates between tests so cases from one test cannot leak into the next.

import { env } from 'cloudflare:test';
import { beforeAll, beforeEach } from 'vitest';
import schema from '../../schema.sql?raw';

const TABLES = [
  'ai_verdicts',
  'session_players',
  'game_sessions',
  'score_events',
  'records',
  'weekly_heals',
  'app_settings',
  'users',
];

/**
 * D1's `exec` chokes on the multi-line, comment-laden statements in schema.sql,
 * so strip comments and run the statements one at a time.
 */
function statementsOf(sql: string): string[] {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

beforeAll(async () => {
  for (const statement of statementsOf(schema)) {
    await env.DB.prepare(statement).run();
  }
});

beforeEach(async () => {
  for (const table of TABLES) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
});
