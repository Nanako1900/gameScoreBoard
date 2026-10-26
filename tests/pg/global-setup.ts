// Starts one PostgreSQL for the whole PG run of the worker suite and applies
// server/migrations. CI provides its own server (TEST_DATABASE_URL, a
// `services: postgres` container); locally an embedded PostgreSQL 17 is started
// in a temp directory, so no Docker or system install is needed.

import { mkdtempSync, rmSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { migrate } from '../../server/src/db/migrate';

const DB_NAME = 'edg_test';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

const READY_TIMEOUT_MS = 60_000;

/** Resolve once the helper prints READY; reject if it dies or takes too long. */
function waitForReady(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('embedded PostgreSQL did not start')), READY_TIMEOUT_MS);
    child.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('READY')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`embedded PostgreSQL exited early (code ${code})`));
    });
  });
}

async function createDatabase(adminUrl: string): Promise<string> {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    // C collation = byte / code-point order, like SQLite's BINARY.
    await admin.query(
      `CREATE DATABASE ${DB_NAME} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8'`,
    );
  } finally {
    await admin.end();
  }
  const url = new URL(adminUrl);
  url.pathname = `/${DB_NAME}`;
  return url.toString();
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  let stop: () => Promise<void> = async () => undefined;
  let adminUrl = process.env.TEST_DATABASE_URL;

  if (!adminUrl) {
    const dir = mkdtempSync(path.join(tmpdir(), 'edg-pg-'));
    const port = await freePort();
    const child = spawn(
      process.execPath,
      [path.resolve(__dirname, 'embedded-server.mjs'), path.join(dir, 'data'), String(port)],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    await waitForReady(child);
    adminUrl = `postgres://edg:edg@127.0.0.1:${port}/postgres`;
    stop = async () => {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGTERM');
      await exited;
      rmSync(dir, { recursive: true, force: true });
    };
  }

  const url = await createDatabase(adminUrl);
  const pool = new pg.Pool({ connectionString: url, options: '-c TimeZone=UTC' });
  try {
    await migrate(pool, path.resolve(__dirname, '../../server/migrations'));
    // Test-only: SQLite's typeof(), which a few tests use to pin that a column
    // holds an integer. Not part of the production schema.
    await pool.query(`CREATE OR REPLACE FUNCTION typeof(value anyelement) RETURNS text
      LANGUAGE sql IMMUTABLE AS $$
        SELECT CASE
          WHEN value IS NULL THEN 'null'
          WHEN pg_typeof(value) IN ('bigint'::regtype, 'integer'::regtype, 'smallint'::regtype) THEN 'integer'
          WHEN pg_typeof(value) IN ('double precision'::regtype, 'real'::regtype, 'numeric'::regtype) THEN 'real'
          ELSE 'text'
        END
      $$`);
  } finally {
    await pool.end();
  }
  project.provide('pgUrl', url);
  return stop;
}

declare module 'vitest' {
  export interface ProvidedContext {
    pgUrl: string;
  }
}
