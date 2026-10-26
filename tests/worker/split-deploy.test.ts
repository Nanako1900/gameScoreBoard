// The P2 topology: SPA on Cloudflare Pages (FRONTEND_URL / FRONTEND_ORIGIN),
// this Worker on its own api.* host. Host-only (__Host-) cookie names, the redirect
// for links still pointing at the old SPA host, and credentialed CORS.

import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../../worker/index';
import { signSession } from '../../worker/session';
import type { Env } from '../../worker/types';
import { noAiEnv, seedUser } from './helpers';

const API = 'https://api.example.com';
const SPA = 'https://score.example.com';
const SECRET = 'test-session-secret-0123456789abcdef';

function appEnv(overrides: Partial<Env> = {}): Env {
  return noAiEnv({
    SESSION_SECRET: SECRET,
    OAUTH_BASE_URL: 'https://idp.example.com',
    OAUTH_CLIENT_ID: 'client',
    OAUTH_CLIENT_SECRET: 'secret',
    APP_URL: API,
    ASSETS: { fetch: async () => new Response('spa shell') } as unknown as Fetcher,
    ...overrides,
  });
}

const SPLIT = { HOST_ONLY_COOKIES: '1', FRONTEND_URL: SPA, FRONTEND_ORIGIN: SPA };

async function call(url: string, init: RequestInit = {}, overrides: Partial<Env> = {}): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(url, init), appEnv(overrides), ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function meAs(cookieName: string, sub: string, overrides: Partial<Env>): Promise<string | null> {
  const token = await signSession({ sub }, SECRET);
  const res = await call(`${API}/api/me`, { headers: { Cookie: `${cookieName}=${token}` } }, overrides);
  const body = (await res.json()) as { user: { id: string } | null };
  return body.user?.id ?? null;
}

describe('HOST_ONLY_COOKIES', () => {
  it('names the OAuth state cookie __Host- and gives it no Domain', async () => {
    const res = await call(`${API}/auth/login`, {}, SPLIT);
    expect(res.status).toBe(302);
    const cookie = res.headers.get('Set-Cookie') ?? '';
    expect(cookie.startsWith('__Host-edg_oauth_state=')).toBe(true);
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toMatch(/Domain=/i);
  });

  it('reads the session only from the __Host- cookie', async () => {
    await seedUser({ id: 'u1' });
    expect(await meAs('__Host-edg_session', 'u1', SPLIT)).toBe('u1');
    // A plain-named copy — something a sibling subdomain could plant — is ignored.
    expect(await meAs('edg_session', 'u1', SPLIT)).toBeNull();
  });

  it('clears the __Host- session cookie on logout', async () => {
    const res = await call(`${API}/auth/logout`, { method: 'POST', headers: { Origin: SPA } }, SPLIT);
    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toMatch(/^__Host-edg_session=; .*Max-Age=0/);
  });

  it('keeps the old cookie names when off, so existing sessions survive', async () => {
    await seedUser({ id: 'u1' });
    expect(await meAs('edg_session', 'u1', {})).toBe('u1');
    expect(await meAs('__Host-edg_session', 'u1', {})).toBeNull();
    const login = await call(`${API}/auth/login`);
    expect(login.headers.get('Set-Cookie')?.startsWith('edg_oauth_state=')).toBe(true);
  });

  it('accepts an unquoted TOML value (a number) for the flag', async () => {
    const res = await call(`${API}/auth/login`, {}, { ...SPLIT, HOST_ONLY_COOKIES: 1 as unknown as string });
    expect(res.headers.get('Set-Cookie')?.startsWith('__Host-edg_oauth_state=')).toBe(true);
  });

  it('refuses to run with COOKIE_DOMAIN too — the browser would drop every cookie', async () => {
    const res = await call(`${API}/auth/login`, {}, { ...SPLIT, COOKIE_DOMAIN: '.example.com' });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('HOST_ONLY_COOKIES');
  });
});

describe('links to the old SPA host', () => {
  it('redirect to the same path and query on FRONTEND_URL — temporary and uncacheable', async () => {
    const res = await call(`${API}/players/abc?tab=history`, {}, SPLIT);
    // Not 301: a browser would cache that forever and break a rollback for them.
    expect(res.status).toBe(302);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Location')).toBe(`${SPA}/players/abc?tab=history`);
    const root = await call(`${API}/`, {}, SPLIT);
    expect(root.headers.get('Location')).toBe(`${SPA}/`);
  });

  it('leaves the API and OAuth routes alone', async () => {
    expect((await call(`${API}/api/leaderboard`, {}, SPLIT)).status).toBe(200);
    expect((await call(`${API}/auth/login`, {}, SPLIT)).status).toBe(302);
  });

  it('keeps serving the SPA when FRONTEND_URL is unset, is this host, or is malformed', async () => {
    for (const overrides of [{}, { FRONTEND_URL: API }, { FRONTEND_URL: 'not a url' }]) {
      const res = await call(`${API}/players/abc`, {}, overrides);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('spa shell');
    }
  });
});

describe('credentialed CORS for the SPA origin', () => {
  it('answers the preflight for FRONTEND_ORIGIN only', async () => {
    const preflight = (origin: string) =>
      call(
        `${API}/api/me/roles`,
        {
          method: 'OPTIONS',
          headers: {
            Origin: origin,
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'content-type',
          },
        },
        SPLIT,
      );
    const ok = await preflight(SPA);
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe(SPA);
    expect(ok.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    const evil = await preflight('https://evil.example.com');
    expect(evil.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('keeps the CORS headers on error responses, so the SPA can read the message', async () => {
    const res = await call(
      `${API}/api/me/roles`,
      { method: 'POST', headers: { Origin: SPA, 'Content-Type': 'application/json' }, body: '{}' },
      SPLIT,
    );
    expect(res.status).toBe(401);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(SPA);
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });
});
