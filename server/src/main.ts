// Node entry point for the Coolify container. One long-lived process: an HTTP
// server split by Host (app.ts) plus the background poller that keeps the
// Discord share page's snapshot fresh.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { createShareApp, createSnapshotPoller, readShareConfig } from './share';

const SHUTDOWN_GRACE_MS = 10_000;

function main(): void {
  const port = Number(process.env.PORT ?? 8787);
  if (!Number.isInteger(port) || port <= 0) throw new Error(`invalid PORT: ${process.env.PORT}`);

  // src/ under tsx, dist/ once bundled — share-public sits next to both.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const publicDir = process.env.SHARE_PUBLIC_DIR ?? path.resolve(here, '../share-public');

  const shareConfig = readShareConfig(process.env);
  const shareHost = (process.env.SHARE_HOST ?? new URL(shareConfig.siteUrl).hostname).toLowerCase();
  const poller = createSnapshotPoller(shareConfig, {
    onError: (error) => console.error('Discord snapshot refresh failed', error),
  });
  poller.start();

  const app = createApp({
    shareHost,
    share: createShareApp({ config: shareConfig, poller, publicDir }),
  });
  const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
    console.log(`listening on :${info.port} (share host ${shareHost})`);
  });

  const shutdown = (signal: string): void => {
    console.log(`${signal}: shutting down`);
    poller.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
