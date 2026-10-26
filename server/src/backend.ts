// The scoreboard API as the container runs it: the PostgreSQL pool, the Worker
// app on top of it (api.ts), the Discord binding routes beside it (P4) and the
// job timer.
//
// The share page has been live on this container since P1, so the API must
// never be able to take it down:
//   * API_HOST empty (until the cutover) → no API at all: no pool, and none of
//     the API's secrets are needed;
//   * API_HOST set but the API misconfigured → its hostnames answer 503 and
//     /status says so, while the share page keeps serving.

import pg from 'pg';
import type { Env } from '../../worker/types';
import { buildEnv, ConfigError, createApi } from './api';
import { createApiHost } from './api-host';
import type { HostedApp } from './app';
import { asD1, installTypeParsers, PgD1Database } from './db/d1';
import { envFlag, envInt, MAX_TIMER_MS } from './env';
import { hostSet } from './hosts';
import { createLinkRoutes } from './link-routes';

const DEFAULT_JOBS_INTERVAL_MS = 60_000;
const MIN_JOBS_INTERVAL_MS = 5_000;

export interface BackendStatus {
  ok: boolean;
  api: 'ok' | 'misconfigured';
  /** 'ok' or 'error' — never the driver's message, which names hosts and users. */
  db?: 'ok' | 'error';
}

export interface Backend {
  /** What the API hostnames are routed to. */
  part: HostedApp;
  status(): Promise<BackendStatus>;
  /** Start the job timer (heal, overdue judging, weekly report) if JOBS_ENABLED. */
  startJobs(): void;
  /** Stop starting new jobs. */
  stopJobs(): void;
  /** Wait (bounded) for running jobs and waitUntil() work, then close the pool. */
  close(graceMs: number): Promise<void>;
}

export interface BackendDeps {
  log?: Pick<Console, 'error' | 'warn'>;
  createPool?: (config: pg.PoolConfig) => pg.Pool;
}

export function createBackend(processEnv: NodeJS.ProcessEnv, deps: BackendDeps = {}): Backend | null {
  const log = deps.log ?? console;
  const warn = (message: string): void => log.warn(message);
  const hosts = hostSet(processEnv.API_HOST);
  if (hosts.size === 0) return null;
  if (!processEnv.DATABASE_URL) return misconfigured(hosts, 'missing required env: DATABASE_URL', log);

  installTypeParsers();
  const pool = (deps.createPool ?? ((config) => new pg.Pool(config)))({
    connectionString: processEnv.DATABASE_URL,
    max: envInt(processEnv.PG_POOL_MAX, 10, { name: 'PG_POOL_MAX', min: 1 }, warn),
    // Waiting longer than this for a connection means PostgreSQL is in trouble:
    // fail the request instead of piling more up behind it.
    connectionTimeoutMillis: 10_000,
    // The Worker's SQL binds zone-less 'YYYY-MM-DD HH:MM:SS' strings meant as UTC.
    options: '-c TimeZone=UTC -c statement_timeout=30000',
  });
  pool.on('error', (error) => log.error('idle PostgreSQL client error', error));

  let env: Env;
  let api: ReturnType<typeof createApi>;
  try {
    env = buildEnv(processEnv, asD1(new PgD1Database(pool)));
    api = createApi(env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    void pool.end().catch(() => undefined);
    return misconfigured(hosts, error.message, log);
  }
  const fetch = withDiscordBinding(processEnv, env, api.fetch, log);

  const jobsEnabled = envFlag(processEnv.JOBS_ENABLED, false, 'JOBS_ENABLED', warn);
  const interval = envInt(
    processEnv.JOBS_INTERVAL_MS,
    DEFAULT_JOBS_INTERVAL_MS,
    { name: 'JOBS_INTERVAL_MS', min: MIN_JOBS_INTERVAL_MS, max: MAX_TIMER_MS },
    warn,
  );
  let timer: ReturnType<typeof setInterval> | null = null;

  return {
    part: { hosts, fetch },
    async status() {
      try {
        await pool.query('SELECT 1');
        return { ok: true, api: 'ok', db: 'ok' };
      } catch (error) {
        log.error('status: database check failed', error);
        return { ok: false, api: 'ok', db: 'error' };
      }
    },
    startJobs() {
      if (!jobsEnabled || timer) return;
      void api.runJobs();
      timer = setInterval(() => void api.runJobs(), interval);
    },
    stopJobs() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    async close(graceMs) {
      this.stopJobs();
      await api.drain(graceMs);
      await pool.end().catch(() => undefined);
    },
  };
}

/**
 * The Discord binding routes (/link/discord/*, /api/me/discord*, link-routes.ts)
 * in front of the Worker app — once the bot's OAuth client is configured.
 * Without it those paths fall through to the Worker, which answers 404, and
 * the SPA simply hides its Discord card.
 */
function withDiscordBinding(
  processEnv: NodeJS.ProcessEnv,
  env: Env,
  workerFetch: (request: Request) => Promise<Response>,
  log: Pick<Console, 'warn'>,
): (request: Request) => Promise<Response> {
  const clientId = (processEnv.DISCORD_CLIENT_ID ?? '').trim();
  const clientSecret = (processEnv.DISCORD_CLIENT_SECRET ?? '').trim();
  if (!clientId || !clientSecret) {
    log.warn('Discord binding disabled: DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET not set');
    return workerFetch;
  }
  const linkRoutes = createLinkRoutes({ env, db: env.DB, discord: { clientId, clientSecret } });
  return createApiHost({ linkRoutes, workerFetch });
}

function misconfigured(hosts: ReadonlySet<string>, problem: string, log: Pick<Console, 'error'>): Backend {
  log.error(`scoreboard API disabled: ${problem}`);
  return {
    part: { hosts, fetch: async () => Response.json({ error: 'API 暂不可用' }, { status: 503 }) },
    status: async () => ({ ok: false, api: 'misconfigured' }),
    startJobs() {},
    stopJobs() {},
    async close() {},
  };
}
