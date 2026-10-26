import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';

function shareStub(): Hono {
  const share = new Hono();
  share.get('/', (c) => c.text('share page'));
  return share;
}

const call = (app: Hono, url: string, host: string) =>
  app.request(url, { headers: { Host: host } });

describe('createApp', () => {
  it('answers /healthz on any host, before host routing', async () => {
    const app = createApp({ shareHosts: new Set(['discord.nanako.org']), share: shareStub() });
    for (const host of ['localhost:8787', '127.0.0.1', 'discord.nanako.org', 'unknown.example']) {
      const res = await call(app, 'http://x/healthz', host);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('ok');
    }
  });

  it('routes the share host (case-insensitively, ignoring the port) to the share app', async () => {
    const app = createApp({ shareHosts: new Set(['discord.nanako.org']), share: shareStub() });
    for (const host of ['discord.nanako.org', 'Discord.Nanako.org', 'discord.nanako.org:443']) {
      const res = await call(app, 'http://x/', host);
      expect(await res.text()).toBe('share page');
    }
  });

  it('serves every listed share host — e.g. a -next host while verifying a cutover', async () => {
    const app = createApp({
      shareHosts: new Set(['discord.nanako.org', 'discord-next.nanako.org']),
      share: shareStub(),
    });
    expect(await (await call(app, 'http://x/', 'discord-next.nanako.org')).text()).toBe('share page');
  });

  it('404s every other host', async () => {
    const app = createApp({ shareHosts: new Set(['discord.nanako.org']), share: shareStub() });
    const res = await call(app, 'http://x/', 'api.nanako.org');
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'Not found' });
  });
});
