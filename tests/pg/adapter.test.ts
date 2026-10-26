// What the D1-compatible adapter (server/src/db/d1.ts) does that only
// PostgreSQL needs, so the shared worker suite cannot cover it.

import { describe, expect, it } from 'vitest';
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

describe('migrate', () => {
  it('accepts the C-collated test database and is idempotent', async () => {
    const result = await migrate(pool, new URL('../../server/migrations', import.meta.url).pathname);
    expect(result.applied).toEqual([]);
    expect(result.skipped.length).toBeGreaterThan(0);
  });
});
