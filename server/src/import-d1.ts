// Imports a D1 export (one JSON array of rows per table, see
// scripts/d1-export.mjs) into an empty PostgreSQL database created by
// server/migrations — in ONE transaction that verifies itself before it
// commits: every table is read back and compared row by row with the export.
// Anything off rolls the whole import back.
//
// What PostgreSQL cannot store the way D1 did is reported, not silently fixed
// up, except U+0000, which PG text cannot hold at all and is dropped (counted).

import { createHash } from 'node:crypto';
import type pg from 'pg';

export type Row = Record<string, unknown>;
export type Export = Record<string, Row[]>;

/** Foreign-key order, and the primary key each table is sorted by. */
export const TABLES: ReadonlyArray<{ name: string; key: string[]; identity: boolean }> = [
  { name: 'users', key: ['id'], identity: false },
  { name: 'game_sessions', key: ['id'], identity: true },
  { name: 'records', key: ['id'], identity: true },
  { name: 'session_players', key: ['session_id', 'user_id'], identity: false },
  { name: 'score_events', key: ['id'], identity: true },
  { name: 'ai_verdicts', key: ['id'], identity: true },
  { name: 'weekly_heals', key: ['week_start'], identity: false },
  { name: 'weekly_reports', key: ['week_start'], identity: false },
  { name: 'app_settings', key: ['key'], identity: false },
];

/** Declared foreign keys (server/migrations/0001_init.sql): child column → parent. */
const FOREIGN_KEYS: ReadonlyArray<[table: string, column: string, parent: string, parentKey: string]> = [
  ['records', 'subject_id', 'users', 'id'],
  ['records', 'reporter_id', 'users', 'id'],
  ['score_events', 'user_id', 'users', 'id'],
  ['ai_verdicts', 'record_id', 'records', 'id'],
  ['game_sessions', 'organizer_id', 'users', 'id'],
  ['session_players', 'session_id', 'game_sessions', 'id'],
  ['session_players', 'user_id', 'users', 'id'],
];

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

export interface Preflight {
  rows: Record<string, number>;
  /** Text values containing U+0000 (dropped on import), per table. */
  nul: Record<string, number>;
  /** Text values with an unpaired UTF-16 surrogate (PostgreSQL stores U+FFFD instead). */
  loneSurrogates: Record<string, number>;
  /** Rows whose foreign key points at nothing — the import refuses these. */
  dangling: string[];
  /** Export tables / columns this schema does not have — the import refuses these. */
  unknown: string[];
}

export class ImportError extends Error {
  override name = 'ImportError';
}

function keyOf(row: Row, key: string[]): string {
  return key.map((k) => String(row[k])).join('\u0001');
}

/** NUL-free copy of a row: what PostgreSQL will actually hold. */
function storable(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) out[k] = typeof v === 'string' ? v.replace(/\u0000/g, '') : v;
  return out;
}

function checksum(rows: Row[], key: string[], columns: string[]): string {
  const hash = createHash('sha256');
  const sorted = [...rows].sort((a, b) => (keyOf(a, key) < keyOf(b, key) ? -1 : 1));
  for (const row of sorted) {
    // Lone surrogates come back from PG as U+FFFD; compare what PG can represent.
    const values = columns.map((c) => {
      const v = row[c] ?? null;
      return typeof v === 'string' ? Buffer.from(v, 'utf8').toString('utf8') : v;
    });
    hash.update(JSON.stringify(values));
  }
  return hash.digest('hex');
}

async function columnsOf(client: pg.PoolClient, table: string): Promise<string[]> {
  const res = await client.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position`,
    [table],
  );
  return res.rows.map((r) => r.column_name);
}

export async function preflight(client: pg.PoolClient, data: Export): Promise<Preflight> {
  const report: Preflight = { rows: {}, nul: {}, loneSurrogates: {}, dangling: [], unknown: [] };
  const known = new Set(TABLES.map((t) => t.name));
  for (const table of Object.keys(data)) if (!known.has(table)) report.unknown.push(table);
  for (const { name } of TABLES) {
    const rows = data[name] ?? [];
    report.rows[name] = rows.length;
    const columns = new Set(await columnsOf(client, name));
    let nul = 0;
    let lone = 0;
    for (const row of rows) {
      for (const [column, value] of Object.entries(row)) {
        if (!columns.has(column)) report.unknown.push(`${name}.${column}`);
        if (typeof value !== 'string') continue;
        if (value.includes('\u0000')) nul += 1;
        if (LONE_SURROGATE.test(value)) lone += 1;
      }
    }
    if (nul) report.nul[name] = nul;
    if (lone) report.loneSurrogates[name] = lone;
  }
  for (const [table, column, parent, parentKey] of FOREIGN_KEYS) {
    const parents = new Set((data[parent] ?? []).map((r) => String(r[parentKey])));
    for (const row of data[table] ?? []) {
      const ref = row[column];
      if (ref !== null && ref !== undefined && !parents.has(String(ref))) {
        report.dangling.push(`${table}.${column}=${String(ref)} → ${parent}`);
      }
    }
  }
  report.unknown = [...new Set(report.unknown)];
  return report;
}

export interface ImportResult {
  preflight: Preflight;
  /** sha256 of each table's rows, identical in the export and in PostgreSQL. */
  checksums: Record<string, string>;
  /** Next identity value per table after the import. */
  sequences: Record<string, number>;
}

/**
 * Import `data` into an EMPTY database. `sequences` is D1's sqlite_sequence
 * (name → seq): AUTOINCREMENT never reuses an id, even after the row with the
 * highest id was deleted, so the PG identity must start above both.
 */
export async function importD1(
  pool: pg.Pool,
  data: Export,
  sequences: Record<string, number> = {},
): Promise<ImportResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const report = await preflight(client, data);
    if (report.unknown.length > 0) {
      throw new ImportError(`export has tables/columns this schema lacks: ${report.unknown.join(', ')}`);
    }
    if (report.dangling.length > 0) {
      throw new ImportError(`dangling foreign keys (${report.dangling.length}): ${report.dangling.slice(0, 20).join('; ')}`);
    }
    for (const { name } of TABLES) {
      const existing = await client.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${name}`);
      if (existing.rows[0].n > 0) throw new ImportError(`${name} is not empty — import into a fresh database only`);
    }

    const checksums: Record<string, string> = {};
    const nextIds: Record<string, number> = {};
    for (const { name, key, identity } of TABLES) {
      const rows = (data[name] ?? []).map(storable);
      const columns = await columnsOf(client, name);
      const present = columns.filter((c) => rows.some((r) => c in r));
      for (const row of rows) {
        const values = present.map((c) => row[c] ?? null);
        const placeholders = present.map((_, i) => `$${i + 1}`).join(', ');
        const overriding = identity ? ' OVERRIDING SYSTEM VALUE' : '';
        await client.query(`INSERT INTO ${name} (${present.join(', ')})${overriding} VALUES (${placeholders})`, values);
      }
      if (identity) {
        const max = rows.reduce((m, r) => Math.max(m, Number(r.id ?? 0)), 0);
        const next = Math.max(max, sequences[name] ?? 0) + 1;
        await client.query(`SELECT setval(pg_get_serial_sequence($1, 'id'), $2, false)`, [name, next]);
        nextIds[name] = next;
      }
      // Verify before moving on: what PG holds must be exactly the export.
      const back = await client.query(`SELECT ${present.join(', ')} FROM ${name}`);
      const want = checksum(rows, key, present);
      const got = checksum(back.rows as Row[], key, present);
      if (back.rowCount !== rows.length || want !== got) {
        throw new ImportError(`${name}: read-back mismatch (${back.rowCount} rows vs ${rows.length} exported)`);
      }
      checksums[name] = got;
    }
    await client.query('COMMIT');
    return { preflight: report, checksums, sequences: nextIds };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
