// The one HTTP app the Node process serves, split by Host header. Cloudflare
// Tunnel forwards every public hostname to the same container port and keeps the
// original Host, so the hostname is what tells the share page (discord.*) apart
// from the API (api.*, from P3a).

import { Hono } from 'hono';

export interface AppParts {
  /** Hostname that serves the Discord share page, e.g. discord.nanako.org. */
  shareHost: string | null;
  share: Hono | null;
}

function hostnameOf(hostHeader: string | undefined): string {
  return (hostHeader ?? '').split(':')[0].trim().toLowerCase();
}

export function createApp(parts: AppParts): Hono {
  const app = new Hono();

  // Before host routing: Docker and Coolify probe with Host: localhost. Liveness
  // only — it must not depend on Discord, or a Discord outage would get the
  // container restarted for nothing.
  app.get('/healthz', (c) => c.text('ok'));

  app.all('*', (c) => {
    const host = hostnameOf(c.req.header('host'));
    if (parts.share && parts.shareHost && host === parts.shareHost) {
      return parts.share.fetch(c.req.raw);
    }
    return c.json({ error: 'Not found' }, 404);
  });

  return app;
}
