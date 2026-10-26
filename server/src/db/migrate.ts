// Applies server/migrations/*.sql in name order, each file once, each in its
// own transaction. A transaction-scoped advisory lock makes concurrent runs
// (two containers starting at once) wait for each other instead of racing.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type pg from 'pg';
import { checkOut } from './d1';

const LOCK_KEY = 4_318_027_771; // arbitrary, constant: "edg migrations"

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export async function migrate(pool: pg.Pool, dir: string): Promise<MigrationResult> {
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort();
  const tx = await checkOut(pool);
  const { client } = tx;
  const result: MigrationResult = { applied: [], skipped: [] };
  try {
    await requireCodePointCollation(client);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    for (const file of files) {
      await client.query('BEGIN');
      try {
        await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);
        const done = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
        if (done.rowCount && done.rowCount > 0) {
          await client.query('COMMIT');
          result.skipped.push(file);
          continue;
        }
        await client.query(readFileSync(path.join(dir, file), 'utf8'));
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        result.applied.push(file);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(`migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`, {
          cause: error,
        });
      }
    }
  } finally {
    tx.release();
  }
  return result;
}

/**
 * The API's ORDER BY on text (leaderboard ties, the weekly report's star and
 * pigeon) must sort by code point, as D1 does. That comes from the database's
 * collation, which is fixed when the database is created — compose.yaml asks
 * for C.UTF-8, but a restore into some other cluster would quietly not have it.
 */
async function requireCodePointCollation(client: pg.PoolClient): Promise<void> {
  // datlocprovider: c = libc (datcollate decides), b = builtin (always code
  // point order), i = ICU (linguistic order).
  const res = await client.query<{ collate: string; provider: string }>(
    `SELECT datcollate AS collate, datlocprovider AS provider
       FROM pg_database WHERE datname = current_database()`,
  );
  const { collate = '', provider = '' } = res.rows[0] ?? {};
  const codePoint = provider === 'b' || (provider === 'c' && /^(C|POSIX|C\.UTF-?8)$/i.test(collate));
  if (!codePoint) {
    throw new Error(
      `database collation is ${JSON.stringify(collate)} (provider ${provider}); it must be C — create the ` +
        `database with --locale=C.UTF-8 (see compose.yaml), or text sorts differently from D1`,
    );
  }
}
