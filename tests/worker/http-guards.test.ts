// Request-level guards in worker/routes.ts: CSRF origin checks and the
// READ_ONLY maintenance switch used for the database cutover. Exercised through
// the real app so middleware order and error mapping are covered too.

import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../../worker/index';
import { SESSION_COOKIE, STATE_COOKIE, makeSignedState, signSession } from '../../worker/session';
import type { Env } from '../../worker/types';
import { expireDeadline, noAiEnv, seedUser, statusOf } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
});

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

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

/** Stub the network: only the given URLs answer, with a tiny PNG. */
function stubImages(...urls: string[]): ReturnType<typeof vi.fn> {
  const fake = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!urls.includes(url)) throw new Error(`unexpected fetch ${url}`);
    return new Response(PNG, { headers: { 'Content-Type': 'image/png' } });
  });
  vi.stubGlobal('fetch', fake);
  return fake;
}

const avatar = (url: string, overrides: Partial<Env> = {}) =>
  call(`/api/avatar?u=${encodeURIComponent(url)}`, {}, overrides);

describe('/api/avatar policy, as the route builds it', () => {
  it('never fetches this app’s own hosts, even when one is a stored avatar URL', async () => {
    const fetchSpy = stubImages();
    const own = [
      `${BASE}/x.png`,
      'https://edge.example.com/x.png',
      'https://app.example.com/x.png',
    ];
    for (const [i, url] of own.entries()) {
      await seedUser({ id: `own${i}` });
      await env.DB.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').bind(url, `own${i}`).run();
    }
    for (const url of own) {
      const res = await avatar(url, { APP_URL: 'https://edge.example.com', FRONTEND_ORIGIN: 'https://app.example.com' });
      expect(res.status).toBe(403);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('allows the OAuth host by exact name only, not its sibling subdomains', async () => {
    stubImages('https://idp.example.com/a.png');
    expect((await avatar('https://idp.example.com/a.png')).status).toBe(200);
    expect((await avatar('https://cdn.idp.example.com/a.png')).status).toBe(403);
  });

  it('matches AVATAR_ALLOWED_HOSTS case-insensitively', async () => {
    stubImages('https://cdn.example.net/a.png');
    const res = await avatar('https://cdn.example.net/a.png', { AVATAR_ALLOWED_HOSTS: 'CDN.Example.NET' });
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});

describe('admin grant through the real OAuth callback', () => {
  async function loginAs(profile: Record<string, string>, overrides: Partial<Env>): Promise<number> {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.endsWith('/oauth/token')) return Response.json({ access_token: 'tok' });
        if (url.endsWith('/oauth/userinfo')) return Response.json(profile);
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
    const { state, cookieValue } = await makeSignedState('test-session-secret-0123456789abcdef');
    const res = await call(
      `/auth/callback?code=abc&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: `${STATE_COOKIE}=${cookieValue}` } },
      overrides,
    );
    expect(res.status).toBe(302);
    const row = await env.DB.prepare('SELECT is_admin FROM users WHERE id = ?')
      .bind(profile.sub)
      .first<{ is_admin: number }>();
    return row?.is_admin ?? -1;
  }

  it('grants by ADMIN_SUBJECT_IDS and then ignores ADMIN_USERNAMES entirely', async () => {
    const both = { ADMIN_SUBJECT_IDS: 'sub-admin', ADMIN_USERNAMES: 'Hongyu Qi' };
    expect(await loginAs({ sub: 'sub-admin', username: 'whoever' }, both)).toBe(1);
    // Same listed username, different subject: no longer enough.
    expect(await loginAs({ sub: 'sub-impostor', username: 'Hongyu Qi' }, both)).toBe(0);
  });

  it('still honours ADMIN_USERNAMES while ADMIN_SUBJECT_IDS is unset', async () => {
    expect(await loginAs({ sub: 'sub-legacy', username: 'Hongyu Qi' }, { ADMIN_USERNAMES: 'Hongyu Qi' })).toBe(1);
  });
});

describe('login ?next= (back to a binding page after login)', () => {
  function stubIdp(): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.endsWith('/oauth/token')) return Response.json({ access_token: 'tok' });
        if (url.endsWith('/oauth/userinfo')) return Response.json({ sub: 'sub-next', username: 'n' });
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
  }

  async function callbackWith(nextCookie: string | null): Promise<Response> {
    stubIdp();
    const { state, cookieValue } = await makeSignedState('test-session-secret-0123456789abcdef');
    const cookies = [`${STATE_COOKIE}=${cookieValue}`];
    if (nextCookie !== null) cookies.push(`edg_login_next=${nextCookie}`);
    return call(`/auth/callback?code=abc&state=${encodeURIComponent(state)}`, {
      headers: { Cookie: cookies.join('; ') },
    });
  }

  it('remembers a /link/ path and returns there after the callback', async () => {
    const login = await call('/auth/login?next=/link/discord');
    const setCookie = login.headers.get('Set-Cookie') ?? '';
    expect(setCookie).toContain(`edg_login_next=${encodeURIComponent('/link/discord')}`);
    const res = await callbackWith(encodeURIComponent('/link/discord'));
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/link/discord');
  });

  it('ignores anything that is not one of this host’s /link/ pages', async () => {
    for (const next of ['https://evil.example/link/x', '//evil.example/link/x', '/api/me', '/link/../api', '/link\\x']) {
      const login = await call(`/auth/login?next=${encodeURIComponent(next)}`);
      expect(login.headers.get('Set-Cookie') ?? '').not.toContain('edg_login_next');
    }
  });

  it('re-checks the cookie at the callback — a planted value cannot redirect off-site', async () => {
    const res = await callbackWith(encodeURIComponent('//evil.example/link/x'));
    // The normal destination (a first login lands on onboarding), not off-site.
    expect(res.headers.get('Location')).toBe('/?onboarding=1');
  });
});

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
    // What a browser really sends from a page on another subdomain.
    const sibling = await call(
      '/auth/logout',
      { method: 'POST', headers: { Origin: 'https://evil.example.com', 'Sec-Fetch-Site': 'same-site' } },
      { FRONTEND_ORIGIN: 'https://app.example.com' },
    );
    expect(sibling.status).toBe(403);
    const noOrigin = await call('/auth/logout', {
      method: 'POST',
      headers: { 'Sec-Fetch-Site': 'same-site' },
    });
    expect(noOrigin.status).toBe(403);
  });

  it('refuses Origin: null even when a config entry has an opaque origin', async () => {
    // 'app.example.com:8443' parses as a URL whose origin is 'null' — the very
    // value a sandboxed iframe or a data: URL sends.
    for (const FRONTEND_ORIGIN of ['app.example.com:8443', 'capacitor://localhost']) {
      const res = await call(
        '/auth/logout',
        { method: 'POST', headers: { Origin: 'null' } },
        { FRONTEND_ORIGIN, APP_URL: 'localhost:5173' },
      );
      expect(res.status).toBe(403);
    }
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

  it('cannot be dodged with a percent-encoded path — the router decodes it', async () => {
    const encoded = await call(
      '/%61pi/me/roles',
      { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: '{}' },
      RO,
    );
    expect(encoded.status).toBe(503);
    expect((await call('/auth/%63allback?code=x&state=y', {}, RO)).status).toBe(503);
    expect((await call('/%61uth/callback?code=x&state=y', {}, RO)).status).toBe(503);
  });

  it('accepts a non-string value (an unquoted TOML boolean or number)', async () => {
    for (const value of [true, 1] as unknown as string[]) {
      const res = await call('/auth/callback?code=x&state=y', {}, { READ_ONLY: value });
      expect(res.status).toBe(503);
    }
  });

  it('does not judge overdue cases — and does, once switched off', async () => {
    await seedUser({ id: 'judge', judge: true });
    await seedUser({ id: 'subject' });
    const row = await env.DB.prepare(
      `INSERT INTO records (subject_id, reporter_id, type, claim, deadline_at, status)
       VALUES ('subject', 'judge', 'no_show', '说好八点开黑，结果一直没上线也不回消息', datetime('now'), 'awaiting_statement')`,
    ).run();
    const id = Number(row.meta.last_row_id);
    await expireDeadline(id);

    await call('/api/config', {}, RO);
    expect(await statusOf(id)).toBe('awaiting_statement');
    const reports = await env.DB.prepare('SELECT COUNT(*) AS n FROM weekly_reports').first<{ n: number }>();
    expect(reports?.n).toBe(0);

    await call('/api/config');
    expect(await statusOf(id)).toBe('decided');
  });

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

describe('U+0000 and out-of-range ids are refused at the edge', () => {
  const SECRET = 'test-session-secret-0123456789abcdef';

  async function postAs(sub: string, path: string, body: string): Promise<Response> {
    const token = await signSession({ sub }, SECRET);
    return call(path, {
      method: 'POST',
      headers: { Cookie: `${SESSION_COOKIE}=${token}`, Origin: BASE, 'Content-Type': 'application/json' },
      body,
    });
  }

  it('refuses a JSON body with NUL — "mallory\\u0000" must not resolve to mallory', async () => {
    // PostgreSQL strips NUL on the way in, so this once filed a bonus for oneself.
    await seedUser({ id: 'mallory', judge: true, score: 50 });
    const res = await postAs('mallory', '/api/records', JSON.stringify({ subject_id: 'mallory\u0000', type: 'on_time_bonus' }));
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe('请求包含非法字符');
    const row = await env.DB.prepare("SELECT score FROM users WHERE id = 'mallory'").first<{ score: number }>();
    expect(row?.score).toBe(50);
  });

  it('refuses NUL nested anywhere in the body, keys included', async () => {
    await seedUser({ id: 'judge', judge: true });
    await seedUser({ id: 'p', score: 50 });
    // Otherwise valid filings: only the NUL can make them fail.
    const valid = { subject_id: 'p', type: 'on_time_bonus' };
    for (const extra of [{ tags: ['ok', { deep: 'a\u0000' }] }, { 'k\u0000': 1 }]) {
      const res = await postAs('judge', '/api/records', JSON.stringify({ ...valid, ...extra }));
      expect(res.status).toBe(400);
      expect(await errorOf(res)).toBe('请求包含非法字符');
    }
    const ok = await postAs('judge', '/api/records', JSON.stringify(valid));
    expect(ok.status).toBe(200);
  });

  it('survives a body nested far deeper than any real one', async () => {
    await seedUser({ id: 'judge', judge: true });
    const deep = `${'['.repeat(20_000)}${']'.repeat(20_000)}`;
    const res = await postAs('judge', '/api/records', deep);
    expect(res.status).toBe(400);
  });

  it('refuses a percent-encoded NUL in the path or the query', async () => {
    await seedUser({ id: 'alice' });
    expect((await call('/api/users/alice%00')).status).toBe(400);
    expect((await call('/api/records?subject=alice%00')).status).toBe(400);
    expect((await call('/api/users/alice')).status).toBe(200);
  });

  it('answers 400 for an id beyond 2^53 instead of failing the query', async () => {
    for (const path of ['/api/records/100000000000000000000', '/api/sessions/1e21', '/api/records?session=9007199254740993']) {
      const res = await call(path);
      expect(res.status, path).toBe(400);
    }
    expect((await call('/api/records/9007199254740991')).status).toBe(404);
  });
});
