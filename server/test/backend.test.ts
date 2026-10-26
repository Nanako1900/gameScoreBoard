import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { createBackend } from '../src/backend';
import { envFlag, envInt, MAX_TIMER_MS } from '../src/env';

const API_ENV = {
  API_HOST: 'api.example.com',
  DATABASE_URL: 'postgres://u:p@db:5432/edg',
  OAUTH_BASE_URL: 'https://idp.example.com',
  OAUTH_CLIENT_ID: 'client',
  OAUTH_CLIENT_SECRET: 'secret',
  SESSION_SECRET: 'test-session-secret-0123456789abcdef',
  APP_URL: 'https://api.example.com',
};

function quietLog() {
  return { error: vi.fn(), warn: vi.fn() };
}

function fakePool(query: () => Promise<unknown> = async () => ({ rows: [] })) {
  const pool = { on: vi.fn(), query: vi.fn(query), end: vi.fn(async () => undefined), connect: vi.fn() };
  return { pool, createPool: vi.fn(() => pool as unknown as pg.Pool) };
}

describe('createBackend', () => {
  it('builds nothing until API_HOST names a host — the share page needs no API secrets', () => {
    const { createPool } = fakePool();
    // compose always sets DATABASE_URL; the secrets may well be empty before the cutover.
    const backend = createBackend(
      { API_HOST: '', DATABASE_URL: API_ENV.DATABASE_URL, SESSION_SECRET: '' },
      { createPool, log: quietLog() },
    );
    expect(backend).toBeNull();
    expect(createPool).not.toHaveBeenCalled();
  });

  it('answers 503 on the API hosts when a secret is missing, instead of crashing', async () => {
    const log = quietLog();
    const { pool, createPool } = fakePool();
    const backend = createBackend({ ...API_ENV, SESSION_SECRET: '' }, { createPool, log });
    expect(backend?.part.hosts.has('api.example.com')).toBe(true);
    const res = await backend!.part.fetch(new Request('https://api.example.com/api/me'));
    expect(res.status).toBe(503);
    expect(await backend!.status()).toEqual({ ok: false, api: 'misconfigured' });
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('SESSION_SECRET'));
    expect(pool.end).toHaveBeenCalled();
  });

  it('answers 503 when DATABASE_URL is missing', async () => {
    const backend = createBackend({ ...API_ENV, DATABASE_URL: '' }, { log: quietLog() });
    expect((await backend!.part.fetch(new Request('https://api.example.com/api/me'))).status).toBe(503);
  });

  it('reports a database failure on /status without the driver message', async () => {
    const log = quietLog();
    const { createPool } = fakePool(async () => {
      throw new Error('connect ECONNREFUSED 172.18.0.3:5432');
    });
    const backend = createBackend(API_ENV, { createPool, log });
    const status = await backend!.status();
    expect(status).toEqual({ ok: false, api: 'ok', db: 'error' });
    expect(JSON.stringify(status)).not.toContain('172.18');
    expect(log.error).toHaveBeenCalled();
  });

  it('reports a healthy database', async () => {
    const { createPool } = fakePool();
    expect(await createBackend(API_ENV, { createPool, log: quietLog() })!.status()).toEqual({
      ok: true,
      api: 'ok',
      db: 'ok',
    });
  });

  it('runs no jobs unless JOBS_ENABLED says so', () => {
    vi.useFakeTimers();
    try {
      for (const value of [undefined, '', '0', 'false', 'off', 'nope']) {
        const { pool, createPool } = fakePool();
        const backend = createBackend({ ...API_ENV, JOBS_ENABLED: value }, { createPool, log: quietLog() });
        backend!.startJobs();
        vi.advanceTimersByTime(120_000);
        expect(pool.query, `JOBS_ENABLED=${value}`).not.toHaveBeenCalled();
        backend!.stopJobs();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives the pool a connection timeout and the configured size', () => {
    const { createPool } = fakePool();
    createBackend({ ...API_ENV, PG_POOL_MAX: '4' }, { createPool, log: quietLog() });
    expect(createPool).toHaveBeenCalledWith(
      expect.objectContaining({ connectionString: API_ENV.DATABASE_URL, max: 4, connectionTimeoutMillis: 10_000 }),
    );
  });
});

describe('envFlag / envInt', () => {
  it('reads the usual yes/no spellings and falls back on blank or junk', () => {
    const warn = vi.fn();
    expect(['1', 'true', 'YES', ' on '].map((v) => envFlag(v, false, 'X', warn))).toEqual([true, true, true, true]);
    expect(['0', 'false', 'No', 'off'].map((v) => envFlag(v, true, 'X', warn))).toEqual([false, false, false, false]);
    expect(envFlag(undefined, true, 'X', warn)).toBe(true);
    expect(envFlag('', false, 'X', warn)).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    expect(envFlag('maybe', false, 'X', warn)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('never turns a blank or junk interval into 0 ms', () => {
    const warn = vi.fn();
    const rule = { name: 'JOBS_INTERVAL_MS', min: 5_000 };
    expect(envInt('', 60_000, rule, warn)).toBe(60_000);
    expect(envInt(undefined, 60_000, rule, warn)).toBe(60_000);
    expect(envInt('30000', 60_000, rule, warn)).toBe(30_000);
    expect(warn).not.toHaveBeenCalled();
    for (const junk of ['0', '10', 'abc', '1.5', '-60000']) expect(envInt(junk, 60_000, rule, warn)).toBe(60_000);
    expect(warn).toHaveBeenCalledTimes(5);
    // Past Node's timer limit setInterval would fire every 1 ms.
    expect(envInt('3000000000', 60_000, { ...rule, max: MAX_TIMER_MS }, warn)).toBe(60_000);
    expect(warn).toHaveBeenCalledTimes(6);
  });
});
