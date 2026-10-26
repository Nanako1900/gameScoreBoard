// One-shot migration job (compose service `migrate`): apply
// server/migrations/*.sql to DATABASE_URL, then exit. The api service only
// starts after this exits 0, so a failed migration never meets live traffic.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { migrate } from './db/migrate';

async function run(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = process.env.MIGRATIONS_DIR ?? path.resolve(here, '../migrations');
  const pool = new pg.Pool({ connectionString: url, max: 1, options: '-c TimeZone=UTC' });
  try {
    const { applied, skipped } = await migrate(pool, dir);
    console.log(`migrations: applied ${applied.length} (${applied.join(', ') || '—'}), already applied ${skipped.length}`);
  } finally {
    await pool.end();
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
