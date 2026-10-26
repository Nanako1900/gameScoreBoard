// The share page end to end on Node: real template, real renderer, real poller,
// Discord replaced by an injected fetcher. Ports discord-share's
// test/index.test.ts, asserting on the rendered HTML instead of recorded
// HTMLRewriter calls.

import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Fetcher } from '../../src/share/discord';
import { createShareApp, createSnapshotPoller, readShareConfig } from '../../src/share';
import { REFRESH_INTERVAL_MS, STALE_MS } from '../../src/share/poller';
import application from './fixtures/application.json';
import invite from './fixtures/invite.json';
import widget from './fixtures/widget.json';

const GUILD_ID = '1114391825336250432';
const SITE_URL = 'https://discord.nanako.org';
const FOREIGN_GUILD = '999999999999999999';
const PUBLIC_DIR = path.resolve(__dirname, '../../share-public');

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const widgetDisabled = (): Response => json({ message: 'Widget Disabled', code: 50004 }, 403);
const never = (): Promise<Response> => new Promise<Response>(() => undefined);

type Route = () => Response | Promise<Response>;

function discordFetch(routes: { invite?: Route; widget?: Route; application?: Route }) {
  return vi.fn<Fetcher>(async (url) => {
    const u = String(url);
    if (u.includes('/invites/')) return (routes.invite ?? (() => json({}, 500)))();
    if (u.includes('/widget.json')) return (routes.widget ?? (() => json({}, 500)))();
    if (u.includes('/applications/')) return (routes.application ?? (() => json({}, 404)))();
    throw new Error(`unexpected url ${u}`);
  });
}

function setup(inviteCode: string, fetcher: Fetcher) {
  const config = readShareConfig({
    GUILD_ID,
    INVITE_CODE: inviteCode,
    SITE_URL,
    SITE_NAME: "Nanako's Community",
  });
  const onError = vi.fn();
  const poller = createSnapshotPoller(config, { fetcher, onError });
  const app = createShareApp({ config, poller, publicDir: PUBLIC_DIR });
  const get = (p: string, init?: RequestInit) => app.request(`${SITE_URL}${p}`, init);
  return { poller, get, onError };
}

const joinHref = (html: string): string | null =>
  html.match(/<a[^>]*id="join"[^>]*>/)?.[0].match(/href="([^"]*)"/)?.[1] ?? null;
const initialData = (html: string): unknown =>
  JSON.parse(html.match(/<script id="initial-data" type="application\/json">([\s\S]*?)<\/script>/)?.[1] ?? 'undefined');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-26T12:00:00.000Z'));
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('GET /api/guild', () => {
  it('waits for the first load and answers 200 with the public snapshot', async () => {
    const { poller, get } = setup('', discordFetch({ invite: () => json(invite), widget: () => json(widget), application: () => json(application) }));
    poller.start();
    const res = await get('/api/guild');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=30');
    await expect(res.json()).resolves.toMatchObject({ success: true, data: { id: GUILD_ID, stale: false } });
    poller.stop();
  });

  it('reports a failed first load once and answers 502', async () => {
    const { poller, get, onError } = setup('XmuHsQYX', discordFetch({}));
    poller.start();
    const res = await get('/api/guild');
    expect(res.status).toBe(502);
    expect(onError).toHaveBeenCalledTimes(1);
    poller.stop();
  });

  it('answers 503 + Retry-After while a first load hangs', async () => {
    const { poller, get, onError } = setup('XmuHsQYX', discordFetch({ invite: never, widget: never }));
    poller.start();
    const pending = get('/api/guild');
    await vi.advanceTimersByTimeAsync(4_000);
    const res = await pending;
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('2');
    await expect(res.json()).resolves.toEqual({ success: false, data: null, error: '正在加载 Discord 数据' });
    expect(onError).not.toHaveBeenCalled();
    poller.stop();
  });

  it('calls Discord once per refresh, however many requests arrive', async () => {
    const later = (body: unknown) => () => new Promise<Response>((r) => setTimeout(() => r(json(body)), 20));
    const fetcher = discordFetch({ invite: later(invite), widget: later(widget), application: later(application) });
    const { poller, get } = setup('XmuHsQYX', fetcher);
    poller.start();
    const responses = Promise.all(Array.from({ length: 10 }, () => get('/api/guild')));
    await vi.advanceTimersByTimeAsync(100);
    for (const res of await responses) expect(res.status).toBe(200);
    for (let i = 0; i < 10; i += 1) await get('/api/guild');
    const calls = (part: string) => fetcher.mock.calls.filter(([url]) => String(url).includes(part)).length;
    expect(calls('/widget.json')).toBe(1);
    expect(calls('/invites/')).toBe(1);
    poller.stop();
  });

  it('flags the snapshot stale when refreshes keep failing', async () => {
    let up = true;
    const { poller, get } = setup('XmuHsQYX', discordFetch({
      invite: () => (up ? json(invite) : json({}, 500)),
      widget: () => (up ? json(widget) : json({}, 500)),
      application: () => json(application),
    }));
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    up = false;
    await vi.advanceTimersByTimeAsync(STALE_MS + REFRESH_INTERVAL_MS);
    const body = (await (await get('/api/guild')).json()) as { data: { stale: boolean } };
    expect(body.data.stale).toBe(true);
    poller.stop();
  });
});

describe('foreign invite code', () => {
  it('is never published — neither in the API body nor in the page — and stays withheld', async () => {
    const foreign = { ...invite, guild: { ...invite.guild, id: FOREIGN_GUILD } };
    const { poller, get } = setup('PrivateStaff', discordFetch({ invite: () => json(foreign), widget: widgetDisabled }));
    poller.start();
    for (let i = 0; i < 2; i += 1) {
      const api = await get('/api/guild');
      const body = await api.text();
      expect(api.status).toBe(200);
      expect(body).toContain('"inviteUrl":null');
      expect(body).not.toContain('PrivateStaff');

      const html = await (await get('/')).text();
      expect(html).not.toContain('PrivateStaff');
      expect(joinHref(html)).toBeNull();
      await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS);
    }
    poller.stop();
  });

  it.each([
    ['no join link', null, null],
    ['the widget’s own invite', 'https://discord.com/invite/Widget1', 'https://discord.com/invite/Widget1'],
  ])('keeps withholding it when a later refresh fails for another reason (429) — %s', async (_l, instant, expected) => {
    const foreign = { ...invite, guild: { ...invite.guild, id: FOREIGN_GUILD } };
    let inviteRoute: Route = () => json(foreign);
    const { poller, get } = setup('OTHER', discordFetch({
      invite: () => inviteRoute(),
      widget: () => json({ ...widget, instant_invite: instant }),
    }));
    poller.start();
    const inviteUrl = async () =>
      ((await (await get('/api/guild')).json()) as { data: { inviteUrl: string | null } }).data.inviteUrl;

    expect(await inviteUrl()).toBe(instant);
    inviteRoute = () => json({ message: 'You are being rate limited.' }, 429);
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS);
    expect(await inviteUrl()).toBe(instant);

    const html = await (await get('/')).text();
    expect(joinHref(html)).toBe(expected);
    expect(html).not.toContain('discord.gg/OTHER');
    poller.stop();
  });
});

describe('GET /', () => {
  it('falls back to the configured link when Discord is unavailable', async () => {
    const { poller, get } = setup('XmuHsQYX', discordFetch({}));
    poller.start();
    const res = await get('/');
    const html = await res.text();
    expect(joinHref(html)).toBe('https://discord.gg/XmuHsQYX');
    // An empty page must never be cached at the edge.
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    poller.stop();
  });

  it('does not render the configured link while the first load is still pending', async () => {
    const { poller, get } = setup('XmuHsQYX', discordFetch({ invite: never, widget: never }));
    poller.start();
    const page = get('/');
    await vi.advanceTimersByTimeAsync(2_000);
    const res = await page;
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(joinHref(html)).toBeNull();
    expect(initialData(html)).toBeNull();
    poller.stop();
  });

  it('server-renders the snapshot, its invite and the split layout, with security headers', async () => {
    const { poller, get } = setup('XmuHsQYX', discordFetch({ invite: () => json(invite), widget: () => json(widget), application: () => json(application) }));
    poller.start();
    const res = await get('/');
    const html = await res.text();
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=0, s-maxage=60, stale-if-error=86400');
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(joinHref(html)).toBe('https://discord.gg/XmuHsQYX');
    expect(html).toMatch(/<main class="stage" data-layout="split"/);
    expect(initialData(html)).toMatchObject({ id: GUILD_ID });
    expect(html).toContain('<meta property="og:url" content="https://discord.nanako.org/">');
    expect(html).toContain(`<meta property="og:title" content="${invite.guild.name} | Discord">`);
    poller.stop();
  });

  it('answers HEAD without a body', async () => {
    const { poller, get } = setup('', discordFetch({}));
    poller.start();
    const res = await get('/', { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
    poller.stop();
  });
});

describe('static files and other routes', () => {
  it('serves the three static files with discord-share’s cache rules and an ETag', async () => {
    const { get } = setup('', discordFetch({}));
    const js = await get('/app.js');
    expect(js.headers.get('Content-Type')).toBe('text/javascript; charset=utf-8');
    expect(js.headers.get('Cache-Control')).toBe('no-cache');
    expect(js.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect((await js.text()).length).toBeGreaterThan(100);

    expect((await get('/styles.css')).headers.get('Content-Type')).toBe('text/css; charset=utf-8');
    expect((await get('/favicon.svg')).headers.get('Cache-Control')).toBe('public, max-age=86400');

    const etag = js.headers.get('ETag') ?? '';
    expect(etag).toMatch(/^"[\w-]+"$/);
    const revalidated = await get('/app.js', { headers: { 'If-None-Match': etag } });
    expect(revalidated.status).toBe(304);
  });

  it('redirects /index.html, 404s unknown paths and API routes, 405s writes', async () => {
    const { get } = setup('', discordFetch({}));
    const index = await get('/index.html');
    expect(index.status).toBe(301);
    expect(index.headers.get('Location')).toBe('/');
    expect((await get('/nope')).status).toBe(404);
    const api = await get('/api/nope');
    expect(api.status).toBe(404);
    await expect(api.json()).resolves.toEqual({ success: false, data: null, error: 'Not found' });
    const post = await get('/', { method: 'POST' });
    expect(post.status).toBe(405);
    expect(post.headers.get('Allow')).toBe('GET, HEAD');
    expect((await get('/api/guild', { method: 'POST' })).status).toBe(405);
  });
});
