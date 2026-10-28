// What the D1-compatible adapter (server/src/db/d1.ts) does that only
// PostgreSQL needs, so the shared worker suite cannot cover it.

import pg from 'pg';
import { afterEach, describe, expect, inject, it } from 'vitest';
import { migrate } from '../../server/src/db/migrate';
import { env, pool } from './cloudflare-test';

describe('PgD1Database', () => {
  it('strips U+0000 from bound text, which PostgreSQL cannot store', async () => {
    // Business code refuses NUL at the HTTP edge; this is the last line behind it.
    await env.DB.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)').bind('k', 'a\u0000b').run();
    const row = await env.DB.prepare('SELECT value FROM app_settings WHERE key = ?').bind('k').first<{ value: string }>();
    expect(row?.value).toBe('ab');
    await env.DB.batch([env.DB.prepare('UPDATE app_settings SET value = ? WHERE key = ?').bind('c\u0000d', 'k')]);
    expect(await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'k'").first('value')).toBe('cd');
  });

  it('survives the connection dying in the middle of a batch', async () => {
    // Without an 'error' listener on the checked-out client this would be an
    // uncaught exception — in production, the whole process gone.
    const killer = setTimeout(() => {
      void pool.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
          WHERE query LIKE '%pg_sleep(5)%' AND pid <> pg_backend_pid()`,
      );
    }, 200);
    try {
      await expect(env.DB.batch([env.DB.prepare('SELECT pg_sleep(5)')])).rejects.toThrow();
    } finally {
      clearTimeout(killer);
    }
    // The broken connection was discarded, not handed back to the pool.
    for (let i = 0; i < 10; i += 1) {
      const [res] = await env.DB.batch([env.DB.prepare('SELECT 1 AS one')]);
      expect(res.results).toEqual([{ one: 1 }]);
    }
  });
});

const MIGRATIONS = new URL('../../server/migrations', import.meta.url).pathname;

describe('migrate', () => {
  let cleanupDatabase: string | null = null;
  // DROP DATABASE waits for a cluster checkpoint. The larger integration suite
  // can leave enough dirty relation files for cleanup to exceed a test's 5 s
  // budget; keep that I/O outside the unchanged collation assertions.
  afterEach(async () => {
    const name = cleanupDatabase;
    cleanupDatabase = null;
    if (name) await pool.query(`DROP DATABASE IF EXISTS ${name}`);
  }, 30_000);

  it('accepts the C-collated test database and is idempotent', async () => {
    const result = await migrate(pool, MIGRATIONS);
    expect(result.applied).toEqual([]);
    expect(result.skipped.length).toBeGreaterThan(0);
  });

  it('refuses a database whose text does not sort by code point, before touching it', async (ctx) => {
    const name = 'edg_collation_test';
    await pool.query(`DROP DATABASE IF EXISTS ${name}`);
    // ICU where the server has it, else a libc locale; skip if it has neither.
    const created = await pool
      .query(`CREATE DATABASE ${name} TEMPLATE template0 LOCALE_PROVIDER icu ICU_LOCALE 'en-US' LOCALE 'C'`)
      .then(() => true)
      .catch(() =>
        pool
          .query(`CREATE DATABASE ${name} TEMPLATE template0 LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8'`)
          .then(() => true)
          .catch(() => false),
      );
    if (!created) ctx.skip();
    cleanupDatabase = name;
    const url = new URL(inject('pgUrl'));
    url.pathname = `/${name}`;
    const other = new pg.Pool({ connectionString: url.toString(), max: 1 });
    try {
      await expect(migrate(other, MIGRATIONS)).rejects.toThrow(/collation .* it must be C/);
      const tables = await other.query("SELECT COUNT(*)::int AS n FROM pg_tables WHERE tablename = 'schema_migrations'");
      expect(tables.rows[0].n).toBe(0);
    } finally {
      await other.end();
    }
  });
});
