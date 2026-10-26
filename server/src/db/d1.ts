// A D1-compatible facade over node-postgres, so the Worker's domain code
// (worker/*.ts — 80+ prepared statements) runs on PostgreSQL unchanged.
//
// It reproduces the D1 behaviour that code and tests rely on:
//   prepare(sql).bind(...).first() / .all() / .run()   with D1's result shapes
//   run().meta.changes / meta.last_row_id
//   batch([...])                                       all-or-nothing
//   `?` placeholders, JS booleans stored as 1/0, `undefined` refused
// and papers over the two places PostgreSQL is stricter than SQLite about the
// values themselves: NUL characters in text (rejected by PG) are stripped, and
// COUNT/SUM (int8) and AVG (numeric) come back as JS numbers, not strings.
//
// Deliberately NOT emulated: SQLite's own SQL dialect. Statements must be
// valid in both engines; `datetime('now'[, modifier])` is provided by a SQL
// function in server/migrations/0001_init.sql.

import pg from 'pg';

/** int8 (COUNT, SUM, bigint ids) and numeric (AVG) as numbers — D1 returns numbers. */
export function installTypeParsers(): void {
  pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
  pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));
}

/** Anything that can run a query: a Pool, or one client inside a transaction. */
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<pg.QueryResult>;
}

export interface D1Meta {
  changes: number;
  last_row_id: number | null;
  duration: number;
}

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: true;
  meta: D1Meta;
}

const NUL = /\u0000/g;

/** Convert one bound value the way D1 accepts it. */
function toParam(value: unknown, index: number): unknown {
  if (value === undefined) {
    throw new TypeError(`D1_TYPE_ERROR: Type 'undefined' not supported for value at index ${index}`);
  }
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') return value.replace(NUL, '');
  return value;
}

/**
 * `?` → `$1, $2, …`, skipping quoted literals, quoted identifiers and comments
 * so a `?` inside them is never mistaken for a placeholder.
 */
export function toPgPlaceholders(sql: string): string {
  let out = '';
  let n = 0;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "'" || ch === '"') {
      const end = closingQuote(sql, i, ch);
      out += sql.slice(i, end + 1);
      i = end;
    } else if (ch === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length - 1 : end;
      out += sql.slice(i, stop + 1);
      i = stop;
    } else if (ch === '?') {
      n += 1;
      out += `$${n}`;
    } else {
      out += ch;
    }
  }
  return out;
}

function closingQuote(sql: string, start: number, quote: string): number {
  for (let i = start + 1; i < sql.length; i += 1) {
    if (sql[i] !== quote) continue;
    if (sql[i + 1] === quote) {
      i += 1; // doubled quote = escaped
      continue;
    }
    return i;
  }
  return sql.length - 1;
}

const INSERT = /^\s*insert\b/i;
const RETURNING = /\breturning\b/i;

interface Prepared {
  text: string;
  /** RETURNING added only to learn last_row_id; its rows are not the caller's. */
  addedReturning: boolean;
}

function prepareText(sql: string): Prepared {
  const text = toPgPlaceholders(sql.trim().replace(/;\s*$/, ''));
  // D1 reports the new rowid of every INSERT. PostgreSQL only reports what a
  // RETURNING clause asks for, so add one when the statement has none.
  if (INSERT.test(text) && !RETURNING.test(text)) {
    return { text: `${text} RETURNING *`, addedReturning: true };
  }
  return { text, addedReturning: false };
}

async function execute(on: Queryable, sql: string, params: unknown[]): Promise<D1Result> {
  const started = Date.now();
  const prepared = prepareText(sql);
  const res = await on.query(prepared.text, params as unknown[]);
  const rows = res.rows as Record<string, unknown>[];
  const firstId = rows[0]?.id;
  const isWrite = res.command === 'INSERT' || res.command === 'UPDATE' || res.command === 'DELETE';
  return {
    results: prepared.addedReturning ? [] : rows,
    success: true,
    meta: {
      changes: isWrite ? (res.rowCount ?? 0) : 0,
      last_row_id: res.command === 'INSERT' && typeof firstId === 'number' ? firstId : null,
      duration: Date.now() - started,
    },
  };
}

export class PgPreparedStatement {
  constructor(
    private readonly db: PgD1Database,
    readonly sql: string,
    readonly params: readonly unknown[] = [],
  ) {}

  /**
   * Like D1: returns a NEW statement (the prepared one stays reusable), and
   * rejects an unsupported value right here, synchronously, as D1 does.
   */
  bind(...values: unknown[]): PgPreparedStatement {
    return new PgPreparedStatement(this.db, this.sql, values.map(toParam));
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const { results } = await execute(this.db.queryable, this.sql, [...this.params]);
    const row = results[0];
    if (row === undefined) return null;
    return (column === undefined ? row : (row[column] ?? null)) as T | null;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return (await execute(this.db.queryable, this.sql, [...this.params])) as D1Result<T>;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return (await execute(this.db.queryable, this.sql, [...this.params])) as D1Result<T>;
  }

  /** @internal used by batch(), which runs every statement on one client. */
  runOn(client: Queryable): Promise<D1Result> {
    return execute(client, this.sql, [...this.params]);
  }
}

export interface PoolLike extends Queryable {
  connect(): Promise<pg.PoolClient>;
}

export class PgD1Database {
  constructor(readonly queryable: PoolLike) {}

  prepare(sql: string): PgPreparedStatement {
    return new PgPreparedStatement(this, sql);
  }

  /** D1 batches are atomic: one transaction, rolled back as a whole on any error. */
  async batch(statements: readonly PgPreparedStatement[]): Promise<D1Result[]> {
    const client = await this.queryable.connect();
    try {
      await client.query('BEGIN');
      const results: D1Result[] = [];
      for (const statement of statements) results.push(await statement.runOn(client));
      await client.query('COMMIT');
      return results;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

/** The facade typed as the Worker sees it (worker/types.ts → Env.DB). */
export function asD1(db: PgD1Database): D1Database {
  return db as unknown as D1Database;
}
