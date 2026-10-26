import { describe, expect, it } from 'vitest';
import { createApp, type HostedApp } from '../src/app';
import { hostSet } from '../src/hosts';

function hosted(hosts: string, body: string): HostedApp {
  return { hosts: hostSet(hosts), fetch: () => new Response(body) };
}

const call = (app: ReturnType<typeof createApp>, url: string, host: string) =>
  app.request(url, { headers: { Host: host } });

describe('createApp', () => {
  const app = createApp({
    share: hosted('discord.nanako.org, discord-next.nanako.org', 'share page'),
    api: hosted('api.nanako.org', 'api'),
  });

  it('answers /healthz on any host, before host routing', async () => {
    for (const host of ['localhost:8787', '127.0.0.1', 'discord.nanako.org', 'api.nanako.org', 'unknown.example']) {
      const res = await call(app, 'http://x/healthz', host);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('ok');
    }
  });

  it('routes each host (case-insensitively, ignoring the port) to its app', async () => {
    for (const host of ['discord.nanako.org', 'Discord.Nanako.org', 'discord.nanako.org:443', 'discord-next.nanako.org']) {
      expect(await (await call(app, 'http://x/', host)).text()).toBe('share page');
    }
    expect(await (await call(app, 'http://x/api/leaderboard', 'API.nanako.org')).text()).toBe('api');
  });

  it('404s every other host', async () => {
    const res = await call(app, 'http://x/', 'evil.example');
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'Not found' });
  });

  it('runs without an API (share page only, as in P1)', async () => {
    const shareOnly = createApp({ share: hosted('discord.nanako.org', 'share page'), api: null });
    expect((await call(shareOnly, 'http://x/api/leaderboard', 'api.nanako.org')).status).toBe(404);
  });
});

describe('/status', () => {
  it('reports dependency health with 200 / 503 — separate from /healthz', async () => {
    const healthy = createApp({ share: null, api: null, status: async () => ({ ok: true, db: 'ok' }) });
    expect((await call(healthy, 'http://x/status', 'localhost')).status).toBe(200);
    const sick = createApp({ share: null, api: null, status: async () => ({ ok: false, db: 'down' }) });
    const res = await call(sick, 'http://x/status', 'localhost');
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ ok: false, db: 'down' });
    // Liveness is unaffected by a sick dependency.
    expect((await call(sick, 'http://x/healthz', 'localhost')).status).toBe(200);
  });
});

describe('hostSet', () => {
  it('lowercases, trims and drops empties', () => {
    expect([...hostSet(' A.example ,b.example,, ')]).toEqual(['a.example', 'b.example']);
    expect(hostSet(undefined).size).toBe(0);
  });
});
