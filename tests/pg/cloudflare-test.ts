// Stand-in for the `cloudflare:test` module when the worker suite runs on
// PostgreSQL (vitest.pg.config.ts aliases it). `env.DB` is the D1-compatible
// facade over node-postgres that production uses, so every test exercises the
// same adapter the Node backend runs on.

import pg from 'pg';
import { inject } from 'vitest';
import { asD1, installTypeParsers, PgD1Database } from '../../server/src/db/d1';

installTypeParsers();

export const pool = new pg.Pool({
  connectionString: inject('pgUrl'),
  max: 8,
  options: '-c TimeZone=UTC',
});

export const env = { DB: asD1(new PgD1Database(pool)) };

const PENDING = Symbol('pending');

interface TestContext extends ExecutionContext {
  [PENDING]: Promise<unknown>[];
}

export function createExecutionContext(): ExecutionContext {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(promise: Promise<unknown>) {
      pending.push(promise);
    },
    passThroughOnException() {},
    props: {},
    [PENDING]: pending,
  };
  return ctx as unknown as ExecutionContext;
}

/** Like Miniflare's: settle every waitUntil()'d promise, including ones added meanwhile. */
export async function waitOnExecutionContext(ctx: ExecutionContext): Promise<void> {
  const pending = (ctx as TestContext)[PENDING];
  let seen = 0;
  while (seen < pending.length) {
    const batch = pending.slice(seen);
    seen = pending.length;
    await Promise.allSettled(batch);
  }
}

export function createScheduledController(
  options: { scheduledTime?: number; cron?: string } = {},
): ScheduledController {
  return {
    scheduledTime: options.scheduledTime ?? Date.now(),
    cron: options.cron ?? '',
    noRetry() {},
  } as ScheduledController;
}
