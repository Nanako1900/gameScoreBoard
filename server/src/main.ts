// Node entry point for the Coolify container. One long-lived process: an HTTP
// server split by Host (app.ts) serving
//   * the Discord share page, kept fresh by a background poller;
//   * the scoreboard API (when DATABASE_URL is set), with a timer for the jobs
//     the Worker's cron used to run.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import pg from 'pg';
import { createApi, buildEnv } from './api';
import { createApp, type HostedApp } from './app';
import { asD1, installTypeParsers, PgD1Database } from './db/d1';
import { hostSet } from './hosts';
import {
  createShareApp,
  createSnapshotPoller,
  readShareConfig,
  readSnapshotFile,
  writeSnapshotFile,
} from './share';

const SHUTDOWN_GRACE_MS = 10_000;
const DEFAULT_JOBS_INTERVAL_MS = 60_000;

function main(): void {
  const port = Number(process.env.PORT ?? 8787);
  if (!Number.isInteger(port) || port <= 0) throw new Error(`invalid PORT: ${process.env.PORT}`);

  // src/ under tsx, dist/ once bundled — share-public sits next to both.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const publicDir = process.env.SHARE_PUBLIC_DIR ?? path.resolve(here, '../share-public');

  // --- Discord share page --------------------------------------------------
  const shareConfig = readShareConfig(process.env);
  // Comma-separated, e.g. "discord.nanako.org,discord-next.nanako.org" while a
  // cutover is being verified. Canonical / og URLs always come from SITE_URL.
  const shareHosts = hostSet(process.env.SHARE_HOST || new URL(shareConfig.siteUrl).hostname);
  // Optional: a file on a volume that keeps the last good snapshot across restarts.
  const snapshotFile = process.env.SNAPSHOT_FILE || null;
  const poller = createSnapshotPoller(shareConfig, {
    onError: (error) => console.error('Discord snapshot refresh failed', error),
    initial: snapshotFile ? readSnapshotFile(snapshotFile, shareConfig.guildId) : null,
    onSnapshot: (snapshot) => {
      if (!snapshotFile) return;
      try {
        writeSnapshotFile(snapshotFile, snapshot);
      } catch (error) {
        console.warn('could not persist the Discord snapshot', error);
      }
    },
  });
  poller.start();
  const share: HostedApp = {
    hosts: shareHosts,
    fetch: createShareApp({ config: shareConfig, poller, publicDir }).fetch,
  };

  // --- Scoreboard API (PostgreSQL) -----------------------------------------
  let pool: pg.Pool | null = null;
  let api: ReturnType<typeof createApi> | null = null;
  let jobsTimer: ReturnType<typeof setInterval> | null = null;
  const apiHosts = hostSet(process.env.API_HOST);
  if (process.env.DATABASE_URL) {
    installTypeParsers();
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX ?? 10),
      // The Worker's SQL binds zone-less 'YYYY-MM-DD HH:MM:SS' strings meant as UTC.
      options: '-c TimeZone=UTC -c statement_timeout=30000',
    });
    pool.on('error', (error) => console.error('idle PostgreSQL client error', error));
    api = createApi(buildEnv(process.env, asD1(new PgD1Database(pool))));
    if ((process.env.JOBS_ENABLED ?? 'true').trim().toLowerCase() !== 'false') {
      const interval = Number(process.env.JOBS_INTERVAL_MS ?? DEFAULT_JOBS_INTERVAL_MS);
      void api.runJobs();
      jobsTimer = setInterval(() => void api?.runJobs(), interval);
    }
  }

  const app = createApp({
    share,
    api: api && apiHosts.size > 0 ? { hosts: apiHosts, fetch: api.fetch } : null,
    status: async () => {
      const report: Record<string, unknown> = { ok: true };
      if (pool) {
        try {
          await pool.query('SELECT 1');
          report.db = 'ok';
        } catch (error) {
          report.ok = false;
          report.db = error instanceof Error ? error.message : String(error);
        }
      }
      return report;
    },
  });

  const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
    const hosts = [...shareHosts, ...(api ? apiHosts : [])].join(', ');
    console.log(`listening on :${info.port} (${hosts})`);
  });

  const shutdown = (signal: string): void => {
    console.log(`${signal}: shutting down`);
    poller.stop();
    if (jobsTimer) clearInterval(jobsTimer);
    setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS).unref();
    server.close(async () => {
      await api?.drain(SHUTDOWN_GRACE_MS / 2);
      await pool?.end().catch(() => undefined);
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
