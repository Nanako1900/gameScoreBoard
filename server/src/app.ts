// The one HTTP app the Node process serves, split by Host header. The reverse
// proxy (Coolify's) forwards every public hostname to the same container port
// and keeps the original Host, so the hostname is what tells the Discord share
// page (discord.*) apart from the scoreboard API (capi.*).

import { Hono } from 'hono';

export interface HostedApp {
  /** Lowercased hostnames this app answers. */
  hosts: ReadonlySet<string>;
  fetch: (request: Request) => Response | Promise<Response>;
}

export interface AppParts {
  /** The Discord share page — discord.nanako.org (+ a -next host during a cutover). */
  share: HostedApp | null;
  /** The scoreboard API (the Worker app on PostgreSQL) — capi.nanako.org. */
  api: HostedApp | null;
  /** Dependency health for external monitoring; /healthz deliberately has none. */
  status?: () => Promise<Record<string, unknown>>;
}

function hostnameOf(hostHeader: string | undefined): string {
  return (hostHeader ?? '').split(':')[0].trim().toLowerCase();
}

export function createApp(parts: AppParts): Hono {
  const app = new Hono();

  // Before host routing: Docker and Coolify probe with Host: localhost. Liveness
  // only — it must not depend on Discord or PostgreSQL, or an outage of either
  // would get the container restarted for nothing.
  app.get('/healthz', (c) => c.text('ok'));

  // For an external monitor (keyword check on "ok": true). Never used as the
  // container healthcheck, for the same reason.
  app.get('/status', async (c) => {
    if (!parts.status) return c.json({ ok: true });
    const report = await parts.status();
    return c.json(report, report.ok === true ? 200 : 503);
  });

  app.all('*', (c) => {
    const host = hostnameOf(c.req.header('host'));
    for (const part of [parts.api, parts.share]) {
      if (part && part.hosts.has(host)) return part.fetch(c.req.raw);
    }
    return c.json({ error: 'Not found' }, 404);
  });

  return app;
}
