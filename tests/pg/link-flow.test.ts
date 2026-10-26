// Discord binding, web side (server/src/link-routes.ts), driven through the API
// host exactly as production wires it: createApiHost in front of the binding
// routes and the real Worker app, on PostgreSQL. Only Discord's two OAuth
// endpoints are stubbed.

import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../../worker/index';
import { signSession } from '../../worker/session';
import { buildEnv } from '../../server/src/api';
import { createApiHost } from '../../server/src/api-host';
import { linkAccounts } from '../../server/src/discord/links';
import { createLinkRoutes } from '../../server/src/link-routes';
import { seedUser } from '../worker/helpers';
import { createExecutionContext, env as pgEnv, waitOnExecutionContext } from './cloudflare-test';

const SECRET = 'test-session-secret-0123456789abcdef';
const API = 'https://api.example.com';
const SPA = 'https://score.example.com';
const BASE_ENV: Record<string, string> = {
  OAUTH_BASE_URL: 'https://idp.example.com',
  OAUTH_CLIENT_ID: 'client',
  OAUTH_CLIENT_SECRET: 'secret',
  SESSION_SECRET: SECRET,
  APP_URL: API,
  FRONTEND_URL: SPA,
  FRONTEND_ORIGIN: SPA,
  AI_ENABLED: 'false',
};
const DISCORD = { clientId: 'discord-client', clientSecret: 'discord-secret' };
const CSP = `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${SPA}; frame-ancestors 'none'; base-uri 'none'`;

// Discord accounts, keyed by the authorization code that "logs them in".
const ACCOUNTS: Record<string, Record<string, unknown>> = {
  alice: { id: '111111111111111111', username: 'alice', global_name: 'Alice 小号' },
  bob: { id: '222222222222222222', username: 'bob', global_name: null },
  xss: { id: '333333333333333333', username: 'mallory', global_name: '<script>alert(1)</script>' },
  badid: { id: 'not-a-snowflake', username: 'weird' },
};
const ALICE_ID = '111111111111111111';
const BOB_ID = '222222222222222222';

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

function discordStub(options: { tokenStatus?: number } = {}) {
  const calls: FetchCall[] = [];
  const fake = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === 'https://discord.com/api/oauth2/token') {
      if (options.tokenStatus) return new Response('nope', { status: options.tokenStatus });
      const code = new URLSearchParams(String(init?.body)).get('code') ?? '';
      if (!(code in ACCOUNTS)) return Response.json({ error: 'invalid_grant' }, { status: 400 });
      return Response.json({ access_token: `tok-${code}`, token_type: 'Bearer', scope: 'identify' });
    }
    if (url === 'https://discord.com/api/users/@me') {
      const auth = new Headers(init?.headers).get('Authorization') ?? '';
      const account = ACCOUNTS[auth.replace(/^Bearer tok-/, '')];
      return account ? Response.json(account) : new Response('unauthorized', { status: 401 });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  return { fetch: fake as unknown as typeof fetch, calls };
}

type Host = (req: Request) => Promise<Response>;

function makeHost(extra: Record<string, string> = {}, stub = discordStub()): { host: Host; calls: FetchCall[] } {
  const env = buildEnv({ ...BASE_ENV, ...extra }, pgEnv.DB);
  const linkRoutes = createLinkRoutes({ env, db: pgEnv.DB, discord: DISCORD, fetch: stub.fetch, onError: () => undefined });
  const host = createApiHost({
    linkRoutes,
    workerFetch: async (req) => {
      const ctx = createExecutionContext();
      const res = await worker.fetch(req, env, ctx);
      await waitOnExecutionContext(ctx);
      return res;
    },
  });
  return { host, calls: stub.calls };
}

afterEach(() => {
  vi.useRealTimers();
});

function later(minutes: number): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + minutes * 60_000);
}

// --- cookies ------------------------------------------------------------------

function setCookies(res: Response): string[] {
  // Node's Headers has getSetCookie(); workers-types (this tsconfig) does not declare it.
  return (res.headers as unknown as { getSetCookie(): string[] }).getSetCookie();
}

function setCookie(res: Response, name: string): string | null {
  return setCookies(res).find((c) => c.startsWith(`${name}=`)) ?? null;
}

function cookieValue(res: Response, name: string): string | null {
  const line = setCookie(res, name);
  return line ? line.slice(name.length + 1).split(';')[0] : null;
}

async function session(userId: string, name = 'edg_session'): Promise<string> {
  return `${name}=${await signSession({ sub: userId }, SECRET)}`;
}

// --- flow steps ----------------------------------------------------------------

interface Started {
  state: string;
  linkCookie: string;
  location: URL;
  res: Response;
}

async function start(host: Host, sessionCookie: string, cookieName = 'edg_link'): Promise<Started> {
  const res = await host(new Request(`${API}/link/discord`, { headers: { Cookie: sessionCookie } }));
  expect(res.status).toBe(302);
  const location = new URL(res.headers.get('Location') ?? '');
  const value = cookieValue(res, cookieName);
  expect(value).toBeTruthy();
  return { state: location.searchParams.get('state') ?? '', linkCookie: `${cookieName}=${value}`, location, res };
}

async function callback(
  host: Host,
  opts: { session: string | null; linkCookie: string | null; code?: string; state?: string; extra?: string },
): Promise<Response> {
  const query = new URLSearchParams();
  if (opts.code !== undefined) query.set('code', opts.code);
  if (opts.state !== undefined) query.set('state', opts.state);
  const cookies = [opts.session, opts.linkCookie].filter((c): c is string => c !== null);
  return host(
    new Request(`${API}/link/discord/callback?${query}${opts.extra ?? ''}`, { headers: { Cookie: cookies.join('; ') } }),
  );
}

function payloadOf(html: string): string {
  const match = /name="payload" value="([^"]+)"/.exec(html);
  if (!match) throw new Error('no confirm form on the page');
  return match[1];
}

async function confirm(
  host: Host,
  opts: { session: string | null; payload: string; replace?: boolean; origin?: string | null; secFetchSite?: string },
): Promise<Response> {
  const body = new URLSearchParams({ payload: opts.payload });
  if (opts.replace) body.set('replace', '1');
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (opts.session) headers.Cookie = opts.session;
  const origin = opts.origin === undefined ? API : opts.origin;
  if (origin !== null) headers.Origin = origin;
  if (opts.secFetchSite) headers['Sec-Fetch-Site'] = opts.secFetchSite;
  return host(new Request(`${API}/link/discord/confirm`, { method: 'POST', headers, body: body.toString() }));
}

/**
 * The Origin a browser puts on the confirm form's POST. The Fetch spec turns
 * it into `null` when the page's Referrer-Policy is no-referrer.
 */
function formPostOrigin(page: Response): string {
  return page.headers.get('Referrer-Policy') === 'no-referrer' ? 'null' : API;
}

/** start → Discord → callback; returns the confirm page. */
async function toConfirmPage(host: Host, userId: string, code: string): Promise<{ res: Response; html: string; sess: string }> {
  const sess = await session(userId);
  const started = await start(host, sess);
  const res = await callback(host, { session: sess, linkCookie: started.linkCookie, code, state: started.state });
  return { res, html: await res.text(), sess };
}

// --- DB views --------------------------------------------------------------------

async function linksOf(): Promise<Array<{ discord_user_id: string; user_id: string; discord_username: string }>> {
  const { results } = await pgEnv.DB.prepare(
    'SELECT discord_user_id, user_id, discord_username FROM discord_links ORDER BY user_id',
  ).all<{ discord_user_id: string; user_id: string; discord_username: string }>();
  return results;
}

async function audit(): Promise<Array<{ action: string; via: string; user_id: string; discord_user_id: string }>> {
  const { results } = await pgEnv.DB.prepare(
    'SELECT action, via, user_id, discord_user_id FROM link_audit ORDER BY id',
  ).all<{ action: string; via: string; user_id: string; discord_user_id: string }>();
  return results;
}

// --- tests -------------------------------------------------------------------------

describe('GET /link/discord', () => {
  it('sends a visitor without a session to login, which then comes back here', async () => {
    const { host, calls } = makeHost();
    const res = await host(new Request(`${API}/link/discord`));
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/auth/login?next=/link/discord');

    // The Worker's login (reached through the same host) remembers where to return.
    const login = await host(new Request(`${API}/auth/login?next=/link/discord`));
    expect(login.status).toBe(302);
    expect(login.headers.get('Location')).toMatch(/^https:\/\/idp\.example\.com\/oauth\/authorize\?/);
    expect(setCookie(login, 'edg_login_next')).toContain(`edg_login_next=${encodeURIComponent('/link/discord')}`);
    expect(calls).toHaveLength(0);
  });

  it('asks for a fresh login when the session is older than 10 minutes', async () => {
    await seedUser({ id: 'a' });
    const { host } = makeHost();
    const sess = await session('a');
    later(11);
    const res = await host(new Request(`${API}/link/discord`, { headers: { Cookie: sess } }));
    expect(res.headers.get('Location')).toBe('/auth/login?next=/link/discord');
  });

  it('starts Discord consent with a signed, short-lived state cookie for /link only', async () => {
    await seedUser({ id: 'a' });
    const { host } = makeHost();
    const { location, res, state } = await start(host, await session('a'));
    expect(`${location.origin}${location.pathname}`).toBe('https://discord.com/oauth2/authorize');
    expect(Object.fromEntries(location.searchParams)).toEqual({
      response_type: 'code',
      scope: 'identify',
      prompt: 'consent',
      client_id: 'discord-client',
      redirect_uri: `${API}/link/discord/callback`,
      state,
    });
    expect(state.length).toBeGreaterThanOrEqual(16);
    const cookie = setCookie(res, 'edg_link') ?? '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/link;');
    expect(cookie).toContain('Max-Age=600');
    expect(cookie).not.toContain('Domain');
  });

  it('uses a __Host- cookie on Path=/ when the deployment uses host-only cookies', async () => {
    await seedUser({ id: 'a' });
    const { host } = makeHost({ HOST_ONLY_COOKIES: '1' });
    const sess = await session('a', '__Host-edg_session');
    const started = await start(host, sess, '__Host-edg_link');
    expect(setCookie(started.res, '__Host-edg_link')).toContain('Path=/;');
    const res = await callback(host, { session: sess, linkCookie: started.linkCookie, code: 'alice', state: started.state });
    expect(res.status).toBe(200);
  });
});

describe('the happy path', () => {
  it('start → Discord → confirm page → click → bound, audited, back to the SPA', async () => {
    await seedUser({ id: 'a', username: 'Nanako A' });
    const { host, calls } = makeHost();
    const sess = await session('a');
    const started = await start(host, sess);
    const page = await callback(host, { session: sess, linkCookie: started.linkCookie, code: 'alice', state: started.state });

    expect(page.status).toBe(200);
    expect(page.headers.get('Content-Type')).toContain('text/html');
    expect(page.headers.get('Content-Security-Policy')).toBe(CSP);
    expect(page.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(page.headers.get('Cache-Control')).toBe('no-store');
    // The OAuth code in this URL never reaches a Referer; the form POST keeps its Origin.
    expect(page.headers.get('Referrer-Policy')).toBe('strict-origin');
    // The state is spent: the browser is told to forget it.
    expect(setCookie(page, 'edg_link')).toMatch(/^edg_link=; .*Path=\/link; Max-Age=0$/);
    const html = await page.text();
    expect(html).toContain('把 Discord <strong>@alice</strong> 绑定到 <strong>Nanako A</strong>？');
    expect(html).toContain('Alice 小号');
    expect(html).toContain('action="/link/discord/confirm"');
    expect(html).not.toContain('name="replace"');

    // Discord was asked exactly what it should be, and nothing is written yet.
    expect(calls.map((c) => c.url)).toEqual(['https://discord.com/api/oauth2/token', 'https://discord.com/api/users/@me']);
    const token = calls[0];
    expect(token.init?.method).toBe('POST');
    expect(new Headers(token.init?.headers).get('Content-Type')).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(String(token.init?.body)))).toEqual({
      grant_type: 'authorization_code',
      code: 'alice',
      redirect_uri: `${API}/link/discord/callback`,
      client_id: 'discord-client',
      client_secret: 'discord-secret',
    });
    expect(new Headers(calls[1].init?.headers).get('Authorization')).toBe('Bearer tok-alice');
    expect(await linksOf()).toEqual([]);

    const done = await confirm(host, { session: sess, payload: payloadOf(html) });
    expect(done.status).toBe(302);
    expect(done.headers.get('Location')).toBe(`${SPA}/?linked=discord`);
    expect(await linksOf()).toEqual([{ discord_user_id: ALICE_ID, user_id: 'a', discord_username: 'alice' }]);
    expect(await audit()).toEqual([{ action: 'link', via: 'web', user_id: 'a', discord_user_id: ALICE_ID }]);
  });

  it('escapes every value it puts on the page', async () => {
    await seedUser({ id: 'a', username: `<b onmouseover="x">A&'</b>` });
    const { host } = makeHost();
    const { res, html } = await toConfirmPage(host, 'a', 'xss');
    expect(res.status).toBe(200);
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<b onmouseover');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;b onmouseover=&quot;x&quot;&gt;A&amp;&#39;&lt;/b&gt;');
  });
});

describe('bindings that already exist', () => {
  it('refuses a Discord account bound to someone else — no form, nothing changes', async () => {
    await seedUser({ id: 'a' });
    await seedUser({ id: 'b' });
    await linkAccounts(pgEnv.DB, { userId: 'b', discordUserId: ALICE_ID, discordUsername: 'alice', replace: false, via: 'discord' });
    const { host } = makeHost();
    const { res, html } = await toConfirmPage(host, 'a', 'alice');
    expect(res.status).toBe(409);
    expect(html).toContain('已经绑定了别的账号');
    expect(html).not.toContain('<form');
    expect(await linksOf()).toEqual([{ discord_user_id: ALICE_ID, user_id: 'b', discord_username: 'alice' }]);
  });

  it('a rebind needs the replace box; with it the binding moves', async () => {
    await seedUser({ id: 'a' });
    await linkAccounts(pgEnv.DB, { userId: 'a', discordUserId: BOB_ID, discordUsername: 'bob', replace: false, via: 'discord' });
    const { host } = makeHost();
    const { html, sess } = await toConfirmPage(host, 'a', 'alice');
    expect(html).toMatch(/<input type="checkbox" name="replace" value="1" required>/);
    expect(html).toContain('换绑（解除原来的 <strong>@bob</strong>）');
    const payload = payloadOf(html);

    const refused = await confirm(host, { session: sess, payload });
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain('需要确认换绑');
    expect((await linksOf())[0].discord_user_id).toBe(BOB_ID);

    const moved = await confirm(host, { session: sess, payload, replace: true });
    expect(moved.status).toBe(302);
    expect(await linksOf()).toEqual([{ discord_user_id: ALICE_ID, user_id: 'a', discord_username: 'alice' }]);
    expect((await audit()).map((r) => [r.action, r.via, r.discord_user_id])).toEqual([
      ['link', 'discord', BOB_ID],
      ['unlink', 'web', BOB_ID],
      ['relink', 'web', ALICE_ID],
    ]);
  });

  it('confirming the binding you already have is fine and changes nothing', async () => {
    await seedUser({ id: 'a' });
    await linkAccounts(pgEnv.DB, { userId: 'a', discordUserId: ALICE_ID, discordUsername: 'alice', replace: false, via: 'web' });
    const { host } = makeHost();
    const { html, sess } = await toConfirmPage(host, 'a', 'alice');
    expect(html).not.toContain('name="replace"');
    const res = await confirm(host, { session: sess, payload: payloadOf(html) });
    expect(res.headers.get('Location')).toBe(`${SPA}/?linked=discord`);
    expect(await audit()).toHaveLength(1);
  });
});

describe('the callback refuses a state it cannot trust', () => {
  async function refusedWith(
    mutate: (s: Started, sess: string) => { session: string | null; linkCookie: string | null; state?: string; code?: string },
    expectedStatus = 400,
  ): Promise<void> {
    await seedUser({ id: 'a' });
    await seedUser({ id: 'b' });
    const { host, calls } = makeHost();
    const sess = await session('a');
    const started = await start(host, sess);
    const res = await callback(host, { code: 'alice', state: started.state, ...mutate(started, sess) });
    expect(res.status).toBe(expectedStatus);
    expect(await res.text()).not.toContain('<form');
    expect(setCookie(res, 'edg_link')).toContain('Max-Age=0');
    expect(calls).toHaveLength(0); // the code is never even exchanged
  }

  it('missing state cookie', async () => {
    await refusedWith((_s, sess) => ({ session: sess, linkCookie: null }));
  });

  it('state that does not match the cookie', async () => {
    await refusedWith((s, sess) => ({ session: sess, linkCookie: s.linkCookie, state: `${s.state}x` }));
  });

  it('missing code', async () => {
    await refusedWith((s, sess) => ({ session: sess, linkCookie: s.linkCookie, code: undefined }));
  });

  it('a cookie re-written to name another user (signature no longer matches)', async () => {
    await refusedWith((s, sess) => {
      const [body, sig] = s.linkCookie.slice('edg_link='.length).split('.');
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as Record<string, unknown>;
      const forged = Buffer.from(JSON.stringify({ ...payload, u: 'b' })).toString('base64url');
      return { session: sess, linkCookie: `edg_link=${forged}.${sig}` };
    });
  });

  it('a garbage cookie', async () => {
    await refusedWith((_s, sess) => ({ session: sess, linkCookie: 'edg_link=%%%.not-base64' }));
  });

  it('a state older than 10 minutes', async () => {
    await refusedWith((s, sess) => {
      later(11);
      return { session: sess, linkCookie: s.linkCookie };
    });
  });

  it('started by user A, completed in user B’s session', async () => {
    await seedUser({ id: 'a' });
    await seedUser({ id: 'b' });
    const { host, calls } = makeHost();
    const started = await start(host, await session('a'));
    const res = await callback(host, {
      session: await session('b'),
      linkCookie: started.linkCookie,
      code: 'alice',
      state: started.state,
    });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('账号不一致');
    expect(calls).toHaveLength(0);
    expect(await linksOf()).toEqual([]);
  });

  it('no session at all', async () => {
    await refusedWith((s) => ({ session: null, linkCookie: s.linkCookie }), 401);
  });

  it('the user said no on Discord’s page', async () => {
    await seedUser({ id: 'a' });
    const { host, calls } = makeHost();
    const sess = await session('a');
    const started = await start(host, sess);
    const res = await callback(host, {
      session: sess,
      linkCookie: started.linkCookie,
      state: started.state,
      extra: '&error=access_denied',
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('已取消绑定');
    expect(calls).toHaveLength(0);
  });
});

describe('Discord itself failing', () => {
  it('a failed token exchange is a 502 page, not a crash', async () => {
    await seedUser({ id: 'a' });
    const { host } = makeHost({}, discordStub({ tokenStatus: 500 }));
    const { res, html } = await toConfirmPage(host, 'a', 'alice');
    expect(res.status).toBe(502);
    expect(html).toContain('连接 Discord 失败');
  });

  it('an identity without a valid snowflake id is refused', async () => {
    await seedUser({ id: 'a' });
    const { host } = makeHost();
    const { res } = await toConfirmPage(host, 'a', 'badid');
    expect(res.status).toBe(502);
    expect(await linksOf()).toEqual([]);
  });
});

describe('POST /link/discord/confirm', () => {
  async function confirmPage(): Promise<{ host: Host; payload: string; sess: string }> {
    await seedUser({ id: 'a' });
    await seedUser({ id: 'b' });
    const { host } = makeHost();
    const { html, sess } = await toConfirmPage(host, 'a', 'alice');
    return { host, payload: payloadOf(html), sess };
  }

  it('is refused from a foreign site (403) and without any Origin', async () => {
    const { host, payload, sess } = await confirmPage();
    for (const origin of ['https://evil.example', null]) {
      const res = await confirm(host, { session: sess, payload, origin });
      expect(res.status).toBe(403);
    }
    expect(await linksOf()).toEqual([]);
  });

  it('accepts the SPA origin too (an allowed origin)', async () => {
    const { host, payload, sess } = await confirmPage();
    const res = await confirm(host, { session: sess, payload, origin: SPA });
    expect(res.status).toBe(302);
  });

  it('works from a browser without Sec-Fetch-Site: the page keeps the form’s Origin intact', async () => {
    await seedUser({ id: 'a' });
    const { host } = makeHost();
    const { res, html, sess } = await toConfirmPage(host, 'a', 'alice');
    const done = await confirm(host, { session: sess, payload: payloadOf(html), origin: formPostOrigin(res) });
    expect(done.status).toBe(302);
    expect(await linksOf()).toHaveLength(1);
  });

  it('takes Sec-Fetch-Site: same-origin for a null Origin, but not a null Origin from elsewhere', async () => {
    const { host, payload, sess } = await confirmPage();
    // A sandboxed iframe or data: page on another site also posts with Origin: null.
    for (const secFetchSite of ['cross-site', 'same-site', undefined]) {
      const res = await confirm(host, { session: sess, payload, origin: 'null', secFetchSite });
      expect(res.status).toBe(403);
    }
    expect(await linksOf()).toEqual([]);
    const ok = await confirm(host, { session: sess, payload, origin: 'null', secFetchSite: 'same-origin' });
    expect(ok.status).toBe(302);
  });

  it('refuses when the Discord account was bound to someone else after the page was shown', async () => {
    const { host, payload, sess } = await confirmPage();
    await linkAccounts(pgEnv.DB, { userId: 'b', discordUserId: ALICE_ID, discordUsername: 'alice', replace: false, via: 'discord' });
    const res = await confirm(host, { session: sess, payload });
    expect(res.status).toBe(409);
    const html = await res.text();
    expect(html).toContain('已经绑定了别的账号');
    expect(html).not.toContain('<form');
    expect(await linksOf()).toEqual([{ discord_user_id: ALICE_ID, user_id: 'b', discord_username: 'alice' }]);
  });

  it('refuses a payload re-written to another Discord account', async () => {
    const { host, payload, sess } = await confirmPage();
    const [body, sig] = payload.split('.');
    const fields = JSON.parse(Buffer.from(body, 'base64url').toString()) as Record<string, unknown>;
    const forged = Buffer.from(JSON.stringify({ ...fields, d: BOB_ID, name: 'bob' })).toString('base64url');
    const res = await confirm(host, { session: sess, payload: `${forged}.${sig}` });
    expect(res.status).toBe(400);
    expect(await linksOf()).toEqual([]);
  });

  it('refuses a payload issued to another user', async () => {
    const { host, payload } = await confirmPage();
    const res = await confirm(host, { session: await session('b'), payload });
    expect(res.status).toBe(403);
    expect(await linksOf()).toEqual([]);
  });

  it('refuses a confirm page older than 5 minutes', async () => {
    const { host, payload, sess } = await confirmPage();
    later(6);
    const res = await confirm(host, { session: sess, payload });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('确认页已过期');
    expect(await linksOf()).toEqual([]);
  });

  it('needs a session', async () => {
    const { host, payload } = await confirmPage();
    const res = await confirm(host, { session: null, payload });
    expect(res.status).toBe(401);
    expect(await linksOf()).toEqual([]);
  });
});

describe('/api/me/discord', () => {
  async function getLink(host: Host, cookie: string | null): Promise<Response> {
    return host(new Request(`${API}/api/me/discord`, { headers: cookie ? { Cookie: cookie, Origin: SPA } : { Origin: SPA } }));
  }

  async function unlink(host: Host, cookie: string | null, origin = SPA): Promise<Response> {
    const headers: Record<string, string> = { Origin: origin };
    if (cookie) headers.Cookie = cookie;
    return host(new Request(`${API}/api/me/discord/unlink`, { method: 'POST', headers }));
  }

  it('is 401 without a session', async () => {
    const { host } = makeHost();
    const res = await getLink(host, null);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: '未登录' });
    expect((await unlink(host, null)).status).toBe(401);
  });

  it('shows the binding before and after — never the Discord id', async () => {
    await seedUser({ id: 'a' });
    const { host } = makeHost();
    const sess = await session('a');
    const before = await getLink(host, sess);
    expect(before.status).toBe(200);
    expect(before.headers.get('Access-Control-Allow-Origin')).toBe(SPA);
    expect(before.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(await before.json()).toEqual({ link: null });

    const { html } = await toConfirmPage(host, 'a', 'alice');
    await confirm(host, { session: sess, payload: payloadOf(html) });
    const after = await getLink(host, sess);
    const text = await after.text();
    expect(text).not.toContain(ALICE_ID);
    const body = JSON.parse(text) as { link: Record<string, unknown> };
    expect(Object.keys(body.link).sort()).toEqual(['discord_username', 'linked_at']);
    expect(body.link.discord_username).toBe('alice');
    expect(typeof body.link.linked_at).toBe('string');
  });

  it('unlinks, audits it, and reports whether anything was removed', async () => {
    await seedUser({ id: 'a' });
    await linkAccounts(pgEnv.DB, { userId: 'a', discordUserId: ALICE_ID, discordUsername: 'alice', replace: false, via: 'web' });
    const { host } = makeHost();
    const sess = await session('a');
    const first = await unlink(host, sess);
    expect(first.status).toBe(200);
    expect(first.headers.get('Access-Control-Allow-Origin')).toBe(SPA);
    expect(await first.json()).toEqual({ ok: true, removed: true });
    expect(await (await unlink(host, sess)).json()).toEqual({ ok: true, removed: false });
    expect(await linksOf()).toEqual([]);
    expect((await audit()).map((r) => [r.action, r.via])).toEqual([
      ['link', 'web'],
      ['unlink', 'web'],
    ]);
    expect(await (await getLink(host, sess)).json()).toEqual({ link: null });
  });

  it('refuses an unlink posted from a foreign site', async () => {
    await seedUser({ id: 'a' });
    await linkAccounts(pgEnv.DB, { userId: 'a', discordUserId: ALICE_ID, discordUsername: 'alice', replace: false, via: 'web' });
    const { host } = makeHost();
    const res = await unlink(host, await session('a'), 'https://evil.example');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: '请求来源不被允许' });
    expect(await linksOf()).toHaveLength(1);
  });

  it('answers the CORS preflight for the SPA origin only', async () => {
    const { host } = makeHost();
    const preflight = (origin: string) =>
      host(
        new Request(`${API}/api/me/discord/unlink`, {
          method: 'OPTIONS',
          headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
        }),
      );
    const ok = await preflight(SPA);
    expect(ok.status).toBe(204);
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe(SPA);
    expect(ok.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(ok.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(ok.headers.get('Access-Control-Allow-Headers')?.toLowerCase()).toContain('content-type');
    const evil = await preflight('https://evil.example');
    expect(evil.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('READ_ONLY maintenance mode', () => {
  it('refuses the confirm and the unlink with 503, still answers reads', async () => {
    await seedUser({ id: 'a' });
    await seedUser({ id: 'b' });
    await linkAccounts(pgEnv.DB, { userId: 'b', discordUserId: BOB_ID, discordUsername: 'bob', replace: false, via: 'web' });
    const { host } = makeHost({ READ_ONLY: '1' });
    const { html, sess } = await toConfirmPage(host, 'a', 'alice');
    const res = await confirm(host, { session: sess, payload: payloadOf(html) });
    expect(res.status).toBe(503);
    expect(res.headers.get('Content-Security-Policy')).toBe(CSP);
    expect(await res.text()).toContain('只读');

    const unlinked = await host(
      new Request(`${API}/api/me/discord/unlink`, { method: 'POST', headers: { Cookie: await session('b'), Origin: SPA } }),
    );
    expect(unlinked.status).toBe(503);
    expect(unlinked.headers.get('Access-Control-Allow-Origin')).toBe(SPA);
    expect(await linksOf()).toEqual([{ discord_user_id: BOB_ID, user_id: 'b', discord_username: 'bob' }]);

    const read = await host(new Request(`${API}/api/me/discord`, { headers: { Cookie: await session('b') } }));
    expect(read.status).toBe(200);
  });
});

describe('the API host', () => {
  it('hands every other path to the Worker app', async () => {
    await seedUser({ id: 'a', score: 90 });
    const { host } = makeHost();
    const board = await host(new Request(`${API}/api/leaderboard`));
    expect(board.status).toBe(200);
    const body = (await board.json()) as { participants: Array<{ id: string }> };
    expect(body.participants.map((p) => p.id)).toEqual(['a']);
    const me = await host(new Request(`${API}/api/me`, { headers: { Cookie: await session('a') } }));
    expect(((await me.json()) as { user: { id: string } }).user.id).toBe('a');
    // A path that merely starts with the same letters is not the binding API's.
    expect((await host(new Request(`${API}/api/me/discordx`))).status).toBe(404);
  });

  it('routes a percent-encoded binding path the way the router will read it', async () => {
    const { host } = makeHost();
    const res = await host(new Request(`${API}/api/me/%64iscord`));
    expect(res.status).toBe(401); // the binding route, not the Worker's 404
  });

  it('applies X-Forwarded-Proto first, so the binding routes see the public https origin', async () => {
    await seedUser({ id: 'a' });
    const { host } = makeHost({ APP_URL: 'https://api.example.com', FRONTEND_ORIGIN: '' });
    const sess = await session('a');
    const post = (proto: string | null) => {
      const headers: Record<string, string> = { Cookie: sess, Origin: 'https://edge.example.com' };
      if (proto) headers['X-Forwarded-Proto'] = proto;
      return host(new Request('http://edge.example.com/api/me/discord/unlink', { method: 'POST', headers }));
    };
    expect((await post(null)).status).toBe(403);
    expect((await post('https')).status).toBe(200);
  });
});
