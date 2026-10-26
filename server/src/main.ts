// Node entry point for the Coolify container. One long-lived process: an HTTP
// server split by Host (app.ts) serving
//   * the Discord share page, kept fresh by a background poller;
//   * the scoreboard API (once API_HOST is set), with a timer for the jobs the
//     Worker's cron used to run.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createApp, type HostedApp } from './app';
import { createBackend } from './backend';
import { hostSet } from './hosts';
import {
  createShareApp,
  createSnapshotPoller,
  readShareConfig,
  readSnapshotFile,
  writeSnapshotFile,
} from './share';

const SHUTDOWN_GRACE_MS = 10_000;

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
  // Only once API_HOST names a hostname; a broken API config answers 503 on
  // those hostnames instead of crashing the share page (backend.ts).
  const backend = createBackend(process.env);
  backend?.startJobs();

  const app = createApp({
    share,
    api: backend?.part ?? null,
    status: async () => (backend ? { ...(await backend.status()) } : { ok: true }),
  });

  const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
    const hosts = [...shareHosts, ...(backend?.part.hosts ?? [])].join(', ');
    console.log(`listening on :${info.port} (${hosts})`);
  });

  const shutdown = (signal: string): void => {
    console.log(`${signal}: shutting down`);
    poller.stop();
    backend?.stopJobs();
    setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS).unref();
    server.close(async () => {
      await backend?.close(SHUTDOWN_GRACE_MS / 2);
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
