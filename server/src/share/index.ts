// The Discord share page (discord.nanako.org) as a Hono sub-app.
//
// api, async, config, discord, html, page and snapshot are ported unchanged
// from discord-share@f3a0e1c (which is why they keep that repo's formatting).
// What changed is only what was tied to the Workers runtime: the Cache API
// layer became poller.ts, HTMLRewriter became render.ts, and the static files
// that ASSETS served are read once at startup here.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Hono, type Context } from 'hono';
import { apiError, apiFailure, apiSuccess } from './api';
import { raceTimeout } from './async';
import { readConfig, type AppConfig } from './config';
import { fetchDiscordData, inviteCodeFrom, type Fetcher } from './discord';
import { buildMeta, SECURITY_HEADERS } from './html';
import { joinUrlFor, pageDataFrom, pagePatches, snapshotOf } from './page';
import { createPoller, UpstreamLoadingError, type SnapshotPoller } from './poller';
import { renderPage } from './render';
import { buildSnapshot, type StoredSnapshot } from './snapshot';

export { readConfig as readShareConfig, type AppConfig as ShareConfig } from './config';
export type { SnapshotPoller } from './poller';
export { readSnapshotFile, writeSnapshotFile } from './snapshot-file';

/** Don't hold the HTML (and link-preview crawlers) hostage to a slow first load. */
const PAGE_DATA_TIMEOUT_MS = 2_000;
/** How long /api/guild waits for the first load before answering 503 + Retry-After. */
const API_WAIT_MS = 4_000;
/**
 * With data: browsers revalidate, the CDN may keep it for a minute, and keeps
 * serving it for a day if this origin is down. Without data (first load still
 * running, Discord unreachable) nothing may cache the empty page.
 */
const PAGE_CACHE_WITH_DATA = 'public, max-age=0, s-maxage=60, stale-if-error=86400';
const PAGE_CACHE_WITHOUT_DATA = 'no-store';

interface StaticFile {
  body: Buffer;
  type: string;
  cacheControl: string;
  etag: string;
}

/** Same Cache-Control rules as discord-share's public/_headers. */
const STATIC_FILES: Readonly<Record<string, { type: string; cacheControl: string }>> = {
  '/app.js': { type: 'text/javascript; charset=utf-8', cacheControl: 'no-cache' },
  '/styles.css': { type: 'text/css; charset=utf-8', cacheControl: 'no-cache' },
  '/favicon.svg': { type: 'image/svg+xml', cacheControl: 'public, max-age=86400' },
};

function loadStatic(publicDir: string): Map<string, StaticFile> {
  const files = new Map<string, StaticFile>();
  for (const [route, meta] of Object.entries(STATIC_FILES)) {
    const body = readFileSync(path.join(publicDir, route.slice(1)));
    const etag = `"${createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`;
    files.set(route, { body, etag, ...meta });
  }
  return files;
}

/**
 * RFC 9110 §13.1.2 weak comparison for If-None-Match: `*`, a comma-separated
 * list, and W/ prefixes — Cloudflare weakens strong ETags when it compresses.
 */
export function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  const opaque = (tag: string) => tag.trim().replace(/^W\//, '');
  const want = opaque(etag);
  return header.split(',').some((tag) => tag.trim() === '*' || opaque(tag) === want);
}

export interface PollerDeps {
  fetcher?: Fetcher;
  intervalMs?: number;
  onError?: (error: unknown) => void;
  initial?: StoredSnapshot | null;
  onSnapshot?: (snapshot: StoredSnapshot) => void;
}

export function createSnapshotPoller(config: AppConfig, deps: PollerDeps = {}): SnapshotPoller {
  const fetcher: Fetcher = deps.fetcher ?? ((url, init) => fetch(url, init));
  return createPoller({
    intervalMs: deps.intervalMs,
    onError: deps.onError,
    initial: deps.initial,
    onSnapshot: deps.onSnapshot,
    load: async (previous) => {
      const data = await fetchDiscordData(config, fetcher, {
        fallbackInviteCode: inviteCodeFrom(previous?.inviteUrl),
        onWarn: (message, error) => console.warn(message, error),
      });
      return buildSnapshot(data, config, new Date(), previous);
    },
  });
}

export interface ShareDeps {
  config: AppConfig;
  poller: SnapshotPoller;
  publicDir: string;
}

function withSecurityHeaders(headers: Headers): Headers {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  return headers;
}

export function createShareApp(deps: ShareDeps): Hono {
  const { config, poller } = deps;
  const template = readFileSync(path.join(deps.publicDir, 'index.html'), 'utf8');
  const statics = loadStatic(deps.publicDir);
  const app = new Hono();

  const page = async (c: Context): Promise<Response> => {
    const data = pageDataFrom(await raceTimeout(poller.get(), PAGE_DATA_TIMEOUT_MS));
    const snapshot = snapshotOf(data);
    const meta = buildMeta(snapshot, config.siteUrl, config.siteName);
    const name = snapshot?.name ?? config.siteName;
    const html = renderPage(template, pagePatches(meta, snapshot, name, joinUrlFor(data, config.inviteCode)));
    const headers = withSecurityHeaders(new Headers());
    headers.set('Content-Type', 'text/html; charset=utf-8');
    headers.set('Cache-Control', snapshot ? PAGE_CACHE_WITH_DATA : PAGE_CACHE_WITHOUT_DATA);
    return new Response(c.req.method === 'HEAD' ? null : html, { status: 200, headers });
  };

  const guild = async (): Promise<Response> => {
    const result = await raceTimeout(poller.get(), API_WAIT_MS);
    if (result.kind === 'value') return apiSuccess(result.value);
    return apiFailure(result.kind === 'timeout' ? new UpstreamLoadingError('first load running') : result.error);
  };

  app.on(['GET', 'HEAD'], '/', page);
  app.on(['GET', 'HEAD'], '/api/guild', guild);
  app.on(['GET', 'HEAD'], '/api/*', () => apiError('Not found', 404));
  app.get('/index.html', (c) => c.redirect('/', 301));

  app.on(['GET', 'HEAD'], '*', (c) => {
    const file = statics.get(new URL(c.req.url).pathname);
    if (!file) return c.text('Not found', 404, { ...SECURITY_HEADERS });
    const headers = withSecurityHeaders(new Headers());
    headers.set('Content-Type', file.type);
    headers.set('Cache-Control', file.cacheControl);
    headers.set('ETag', file.etag);
    if (etagMatches(c.req.header('If-None-Match'), file.etag)) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(c.req.method === 'HEAD' ? null : new Uint8Array(file.body), { status: 200, headers });
  });

  app.all('*', () =>
    new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } }),
  );

  return app;
}
