// @ts-check
// Exports every table of the D1 database to <out>/<table>.json for
// server/src/import-d1-main.ts. Read-only: SELECTs only.
//
//   node scripts/d1-export.mjs export/            # production (--remote)
//   node scripts/d1-export.mjs export/ --local    # your local wrangler state
//
// Needs a logged-in wrangler (`npx wrangler login`). Run it while the Worker
// is in READ_ONLY mode, so nothing changes between the first and last table.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DB = process.env.D1_DATABASE ?? 'edg-credit';
const TABLES = [
  'users',
  'game_sessions',
  'records',
  'session_players',
  'score_events',
  'ai_verdicts',
  'weekly_heals',
  'weekly_reports',
  'app_settings',
  'sqlite_sequence',
];

const [out, flag] = process.argv.slice(2);
if (!out) {
  console.error('usage: node scripts/d1-export.mjs <out-dir> [--local]');
  process.exit(1);
}
const where = flag === '--local' ? ['--local'] : ['--remote'];
// For rehearsals against a throwaway local state (wrangler dev --persist-to).
if (flag === '--local' && process.env.D1_PERSIST_TO) where.push('--persist-to', process.env.D1_PERSIST_TO);
mkdirSync(out, { recursive: true });

/** wrangler prints `{ "error": { "text": … } }` on stdout when a query fails. */
function wranglerError(error) {
  const stdout = /** @type {{ stdout?: string }} */ (error).stdout ?? '';
  try {
    return JSON.parse(stdout).error?.text ?? String(error);
  } catch {
    return String(error);
  }
}

for (const table of TABLES) {
  let json;
  try {
    json = execFileSync(
      'npx',
      ['wrangler', 'd1', 'execute', DB, ...where, '--json', '--command', `SELECT * FROM ${table}`],
      { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (error) {
    console.error(`${table}: ${wranglerError(error)}`);
    console.error('export aborted — is this database on the current schema (schema.sql)?');
    process.exit(1);
  }
  const parsed = JSON.parse(json);
  const rows = parsed.flatMap((/** @type {{ results: unknown[] }} */ chunk) => chunk.results);
  writeFileSync(path.join(out, `${table}.json`), JSON.stringify(rows));
  console.log(`${table}: ${rows.length} rows`);
}
