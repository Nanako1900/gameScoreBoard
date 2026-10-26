// CLI for the D1 → PostgreSQL cutover:
//   docker compose run --rm migrate node server/dist/import-d1-main.js /import
// where /import holds one <table>.json per table from scripts/d1-export.mjs
// (raw arrays or `wrangler d1 execute --json` output), plus an optional
// sqlite_sequence.json. Run it against a freshly migrated, empty database.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { installTypeParsers } from './db/d1';
import { importD1, TABLES, type Export, type Row } from './import-d1';

/** Accept a raw row array or wrangler's [{ results: [...] }] envelope. */
function rowsOf(file: string): Row[] {
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object' && parsed[0] !== null && 'results' in parsed[0]) {
    return (parsed as Array<{ results: Row[] }>).flatMap((chunk) => chunk.results);
  }
  if (Array.isArray(parsed)) return parsed as Row[];
  throw new Error(`${file}: not a JSON array`);
}

async function run(): Promise<void> {
  const dir = process.argv[2];
  const url = process.env.DATABASE_URL;
  if (!dir || !url) throw new Error('usage: DATABASE_URL=... node import-d1-main.js <export-dir>');

  const data: Export = {};
  for (const { name } of TABLES) {
    const file = path.join(dir, `${name}.json`);
    if (!existsSync(file)) throw new Error(`missing ${file} — export every table, even empty ones`);
    data[name] = rowsOf(file);
  }
  const sequences: Record<string, number> = {};
  const seqFile = path.join(dir, 'sqlite_sequence.json');
  if (existsSync(seqFile)) {
    for (const row of rowsOf(seqFile)) sequences[String(row.name)] = Number(row.seq);
  }

  installTypeParsers();
  const pool = new pg.Pool({ connectionString: url, max: 1, options: '-c TimeZone=UTC' });
  try {
    const result = await importD1(pool, data, sequences);
    console.log(JSON.stringify(result, null, 2));
    const { nul, loneSurrogates } = result.preflight;
    if (Object.keys(nul).length) console.warn('U+0000 dropped from text values:', nul);
    if (Object.keys(loneSurrogates).length) console.warn('unpaired surrogates stored as U+FFFD:', loneSurrogates);
    console.log('import committed and verified');
  } finally {
    await pool.end();
  }
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
