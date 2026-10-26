// Request-level guards in worker/routes.ts: CSRF origin checks and the
// READ_ONLY maintenance switch used for the database cutover. Exercised through
// the real app so middleware order and error mapping are covered too.

import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../../worker/index';
import type { Env } from '../../worker/types';
import { noAiEnv } from './helpers';

const BASE = 'https://score.example.com';

function appEnv(overrides: Partial<Env> = {}): Env {
  return noAiEnv({
    SESSION_SECRET: 'test-session-secret-0123456789abcdef',
    OAUTH_BASE_URL: 'https://idp.example.com',
    OAUTH_CLIENT_ID: 'client',
    OAUTH_CLIENT_SECRET: 'secret',
    ...overrides,
  });
}

async function call(
  path: string,
  init: RequestInit = {},
  overrides: Partial<Env> = {},
): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`${BASE}${path}`, init), appEnv(overrides), ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

async function errorOf(res: Response): Promise<string> {
  const body = (await res.json()) as { error?: string };
  return body.error ?? '';
}

async function healedWeeks(): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM weekly_heals').first<{ n: number }>();
  return row?.n ?? 0;
}

describe('CSRF', () => {
  it('refuses a cross-origin form-style POST before it reaches the handler', async () => {
    const res = await call('/auth/logout', {
      method: 'POST',
      headers: { Origin: 'https://evil.example.com', 'Content-Type': 'text/plain' },
      body: '{}',
    });
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toBe('请求来源不被允许');
    // A refused logout must not clear the session either.
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  it('refuses a cross-origin body-less POST (what fetch(no-cors) sends)', async () => {
    const res = await call('/api/records/1/withdraw', {
      method: 'POST',
      headers: { Origin: 'https://evil.example.com' },
    });
    expect(res.status).toBe(403);
  });

  it('refuses a sibling subdomain — same-site is not same-origin', async () => {
    const res = await call(
      '/auth/logout',
      { method: 'POST', headers: { Origin: 'https://evil.example.com' } },
      { FRONTEND_ORIGIN: 'https://app.example.com' },
    );
    expect(res.status).toBe(403);
  });

  it('allows our own origin, FRONTEND_ORIGIN, APP_URL and same-origin fetches', async () => {
    const own = await call('/auth/logout', { method: 'POST', headers: { Origin: BASE } });
    expect(own.status).toBe(200);

    const frontend = await call(
      '/auth/logout',
      { method: 'POST', headers: { Origin: 'https://app.example.com' } },
      { FRONTEND_ORIGIN: 'https://app.example.com,https://other.example.com' },
    );
    expect(frontend.status).toBe(200);

    const appUrl = await call(
      '/auth/logout',
      { method: 'POST', headers: { Origin: 'https://edge.example.com' } },
      { APP_URL: 'https://edge.example.com/' },
    );
    expect(appUrl.status).toBe(200);

    // A reverse proxy in front of the Worker forwards the browser's headers:
    // the Origin is the proxy's, but Sec-Fetch-Site still says same-origin.
    const proxied = await call('/auth/logout', {
      method: 'POST',
      headers: { Origin: 'https://proxy.example.com', 'Sec-Fetch-Site': 'same-origin' },
    });
    expect(proxied.status).toBe(200);
  });

  it('skips a malformed FRONTEND_ORIGIN entry instead of failing every request', async () => {
    const broken = { FRONTEND_ORIGIN: 'not a url,https://app.example.com' };
    const res = await call(
      '/auth/logout',
      { method: 'POST', headers: { Origin: 'https://app.example.com' } },
      broken,
    );
    expect(res.status).toBe(200);
    // The avatar proxy derives its own-host list from the same origins.
    const avatar = await call('/api/avatar', {}, broken);
    expect(avatar.status).toBe(400);
  });

  it('leaves JSON requests to CORS: they always preflight', async () => {
    // Reaches the route (401 not logged in) instead of being stopped as CSRF.
    const res = await call('/api/me/roles', {
      method: 'POST',
      headers: { Origin: 'https://evil.example.com', 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_judge: true }),
    });
    expect(res.status).toBe(401);
  });

  it('does not touch GETs', async () => {
    const res = await call('/api/leaderboard', { headers: { Origin: 'https://evil.example.com' } });
    expect(res.status).toBe(200);
  });
});

describe('READ_ONLY maintenance mode', () => {
  const RO = { READ_ONLY: '1' };

  it('refuses every write with 503', async () => {
    const res = await call(
      '/api/me/roles',
      { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: '{}' },
      RO,
    );
    expect(res.status).toBe(503);
    expect(await errorOf(res)).toMatch(/只读/);

    const patch = await call(
      '/api/sessions/1',
      { method: 'PATCH', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: '{}' },
      RO,
    );
    expect(patch.status).toBe(503);
  });

  it('refuses the OAuth callback — it is a GET that writes the user row', async () => {
    const res = await call('/auth/callback?code=x&state=y', {}, RO);
    expect(res.status).toBe(503);
  });

  it('keeps reads and logout working', async () => {
    expect((await call('/api/leaderboard', {}, RO)).status).toBe(200);
    expect((await call('/api/records', {}, RO)).status).toBe(200);
    const logout = await call('/auth/logout', { method: 'POST', headers: { Origin: BASE } }, RO);
    expect(logout.status).toBe(200);
  });

  it('skips the lazy background jobs on /api/config', async () => {
    const res = await call('/api/config', {}, RO);
    expect(res.status).toBe(200);
    expect(await healedWeeks()).toBe(0);
  });

  it('skips the cron jobs', async () => {
    await worker.scheduled({} as ScheduledController, appEnv(RO), createExecutionContext());
    expect(await healedWeeks()).toBe(0);
  });

  it('accepts true / yes / 1 and treats anything else as off', async () => {
    for (const value of ['true', 'YES', ' 1 ']) {
      const res = await call('/auth/callback?code=x&state=y', {}, { READ_ONLY: value });
      expect(res.status).toBe(503);
    }
    // Off: the lazy heal runs as usual — the baseline the switch is measured against.
    await call('/api/config', {}, { READ_ONLY: 'false' });
    expect(await healedWeeks()).toBe(1);
  });
});
