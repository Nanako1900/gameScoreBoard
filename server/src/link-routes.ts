// Discord ↔ Nanako binding, web side (docs/DESIGN-v4-discord-coolify.md §5).
// Served on the API host next to the Worker app (api-host.ts), Node only.
//
//   GET  /link/discord           needs a fresh Nanako session → Discord consent
//   GET  /link/discord/callback  state checked → code exchanged → confirm page
//   POST /link/discord/confirm   the user's explicit click → linkAccounts()
//   GET  /api/me/discord         the SPA's view of the caller's own binding
//   POST /api/me/discord/unlink
//
// Each side proves its own identity: Discord through its OAuth, Nanako through
// the session cookie. Nothing is written until the user presses the button on
// a page of ours, so a site that sends someone here cannot bind silently.

import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { getUserById, toUser } from '../../worker/db';
import { ApiError } from '../../worker/errors';
import { allowedOrigins, cookieConfig, isReadOnly, parseCsvList } from '../../worker/http';
import { cookieNames, getCookie, verifySession } from '../../worker/session';
import type { Env, User } from '../../worker/types';
import { linkAccounts, linkByDiscordId, linkByUserId, unlinkAccounts } from './discord/links';
import { authorizeUrl, exchangeCode, fetchMe, type DiscordIdentity } from './discord/oauth';

export interface LinkRouteDeps {
  env: Env;
  db: D1Database;
  discord: { clientId: string; clientSecret: string };
  /** Reaches Discord's OAuth endpoints; the global fetch when omitted. */
  fetch?: typeof fetch;
  onError?: (context: string, error: unknown) => void;
}

const LOGIN_PATH = '/auth/login?next=/link/discord';
const START_PATH = '/link/discord';
/** Binding must start within this long of logging in (design §5 step 2). */
const REAUTH_SEC = 600;
const STATE_TTL_SEC = 600;
const CONFIRM_TTL_SEC = 300;
// Own HMAC domains: neither token can pass for a session, an OAuth state or the other.
const STATE_PREFIX = 'link.';
const CONFIRM_PREFIX = 'linkconfirm.';
const STATE_COOKIE = 'edg_link';
const READ_ONLY_MESSAGE = '系统维护中（只读），请稍后再试';

// --- signed tokens ------------------------------------------------------------

const encoder = new TextEncoder();

function toB64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

async function seal(prefix: string, payload: Record<string, unknown>, secret: string): Promise<string> {
  const body = toB64url(encoder.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(prefix + body));
  return `${body}.${toB64url(new Uint8Array(sig))}`;
}

/** The payload if the signature is ours and `exp` is still ahead; else null, never a throw. */
async function unseal(prefix: string, token: string, secret: string): Promise<Record<string, unknown> | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [body, sig] = parts;
    const key = await hmacKey(secret);
    const ok = await crypto.subtle.verify('HMAC', key, fromB64url(sig), encoder.encode(prefix + body));
    if (!ok) return null;
    const payload: unknown = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    if (!isRecord(payload) || typeof payload.exp !== 'number' || payload.exp <= nowSec()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** The state cookie: which nonce this browser sent to Discord, and for whom. */
interface LinkState {
  nonce: string;
  userId: string;
}

/** What the confirm page's form carries back: the binding the user is shown. */
interface PendingLink {
  discordId: string;
  discordUsername: string;
  userId: string;
}

// --- HTML ---------------------------------------------------------------------

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);
}

const STYLE = `
:root{color-scheme:light dark;--bg:#f3efe6;--card:#fffdf8;--ink:#1f1c16;--muted:#6d675b;--line:#e3ddcf;--accent:#5865f2;--warn:#b0451d}
@media (prefers-color-scheme:dark){:root{--bg:#14130f;--card:#1e1c17;--ink:#f2ede1;--muted:#a69f91;--line:#36322a;--warn:#f0905f}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--ink);font:16px/1.65 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
main{width:100%;max-width:460px;background:var(--card);border:1px solid var(--line);border-radius:20px;padding:28px;box-shadow:0 24px 48px -32px rgba(0,0,0,.45)}
.tag{margin:0 0 4px;font-size:12px;letter-spacing:.14em;color:var(--muted)}
h1{margin:0 0 14px;font-size:22px;line-height:1.4;font-weight:700}
p{margin:0 0 12px;color:var(--muted)}
strong{color:var(--ink);word-break:break-all}
label{display:flex;gap:10px;align-items:flex-start;margin:6px 0 4px;padding:12px 14px;border:1.5px solid var(--warn);border-radius:12px;color:var(--ink)}
input[type=checkbox]{margin-top:5px;accent-color:var(--warn)}
.actions{display:flex;gap:16px;align-items:center;margin-top:20px}
button{font:inherit;font-weight:600;border:0;border-radius:999px;padding:10px 24px;background:var(--accent);color:#fff;cursor:pointer;transition:transform .15s ease}
button:hover{transform:translateY(-1px)}button:active{transform:translateY(0)}
a{color:var(--accent);font-weight:600}
button:focus-visible,a:focus-visible,input:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
`;

function htmlPage(heading: string, body: string): string {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Discord 绑定 · EDG 信誉分</title><style>${STYLE}</style></head>
<body><main><p class="tag">EDG 信誉分 · DISCORD 绑定</p><h1>${heading}</h1>${body}</main></body></html>`;
}

// --- routes -------------------------------------------------------------------

export function createLinkRoutes(deps: LinkRouteDeps): Hono {
  const { env, db, discord } = deps;
  const onError = deps.onError ?? ((context, error) => console.error(context, error));
  const appUrl = (env.APP_URL ?? '').replace(/\/$/, '');
  if (!appUrl) throw new Error('APP_URL is required for the Discord binding routes');
  if (!discord.clientId || !discord.clientSecret) throw new Error('Discord OAuth client id / secret missing');
  const redirectUri = `${appUrl}/link/discord/callback`;
  const frontend = (env.FRONTEND_URL ?? '').replace(/\/$/, '');
  const homeHref = frontend || '/';
  const successUrl = `${frontend}/?linked=discord`;

  // form-action also governs where the confirm POST may redirect to, so the
  // SPA's origin must be allowed or the browser blocks the final hop home.
  let frontendOrigin = '';
  try {
    if (frontend) frontendOrigin = ` ${new URL(frontend).origin}`;
  } catch {
    // A malformed FRONTEND_URL fails elsewhere; here it just is not allowed.
  }
  const csp = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `form-action 'self'${frontendOrigin}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join('; ');

  // __Host- (when this deployment uses it) demands Path=/; otherwise the cookie
  // only ever travels to the /link pages. SameSite=Lax, whatever the session
  // cookie uses: Discord sends the browser back with a top-level cross-site
  // GET, which Lax cookies ride and Strict ones do not.
  function stateCookie(): { name: string; attrs: string } {
    const hostOnly = cookieConfig(env).hostOnly === true;
    return {
      name: `${hostOnly ? '__Host-' : ''}${STATE_COOKIE}`,
      attrs: `HttpOnly; Secure; SameSite=Lax; Path=${hostOnly ? '/' : '/link'}`,
    };
  }

  /** The Nanako user behind the session cookie, read exactly as worker/routes.ts does. */
  async function readSession(req: Request): Promise<{ user: User; issuedAt: number } | null> {
    const token = getCookie(req, cookieNames(cookieConfig(env)).session);
    if (!token) return null;
    const payload = await verifySession(token, env.SESSION_SECRET);
    if (!payload) return null;
    const row = await getUserById(db, payload.sub);
    return row ? { user: toUser(row), issuedAt: payload.iat } : null;
  }

  async function readState(req: Request): Promise<LinkState | null> {
    const raw = getCookie(req, stateCookie().name);
    const payload = raw ? await unseal(STATE_PREFIX, raw, env.SESSION_SECRET) : null;
    if (!payload || typeof payload.n !== 'string' || typeof payload.u !== 'string') return null;
    return { nonce: payload.n, userId: payload.u };
  }

  async function readPending(raw: string): Promise<PendingLink | null> {
    const payload = raw ? await unseal(CONFIRM_PREFIX, raw, env.SESSION_SECRET) : null;
    if (!payload) return null;
    const { d, name, u } = payload;
    if (typeof d !== 'string' || typeof name !== 'string' || typeof u !== 'string') return null;
    return { discordId: d, discordUsername: name, userId: u };
  }

  function page(c: Context, status: number, heading: string, body: string): Response {
    c.header('Content-Security-Policy', csp);
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Cache-Control', 'no-store');
    // The callback URL carries the OAuth code: no Referer ever gets its path or
    // query. Not no-referrer — that makes the browser send `Origin: null` on the
    // confirm form's POST, which the CSRF check then refuses wherever
    // Sec-Fetch-Site is missing (older Safari / Firefox).
    c.header('Referrer-Policy', 'strict-origin');
    return c.html(htmlPage(heading, body), status as ContentfulStatusCode);
  }

  const restart = `<div class="actions"><a href="${START_PATH}">重新开始绑定</a><a href="${esc(homeHref)}">回到信誉分</a></div>`;
  const home = `<div class="actions"><a href="${esc(homeHref)}">回到信誉分</a></div>`;

  function takenPage(c: Context, discordUsername: string): Response {
    return page(
      c,
      409,
      '这个 Discord 已经绑定了别的账号',
      `<p>Discord <strong>@${esc(discordUsername)}</strong> 已经绑定在另一个信誉分账号上。请先用那个账号在网页设置里解绑（或在 Discord 里用 /unlink），再回来绑定。</p>${home}`,
    );
  }

  const app = new Hono();

  // --- JSON API for the SPA: credentialed CORS + CSRF, as worker/routes.ts ----
  app.use('/api/*', async (c, next) => {
    const allowed = parseCsvList(env.FRONTEND_ORIGIN);
    if (allowed.length === 0) return next();
    return cors({
      origin: (origin) => (allowed.includes(origin) ? origin : null),
      credentials: true,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Accept'],
      maxAge: 7200,
    })(c, next);
  });
  const csrfGuard = csrf({ origin: (origin, c) => allowedOrigins(env, c.req.url).includes(origin) });
  app.use('/api/*', csrfGuard);
  app.use('/link/discord/confirm', csrfGuard);

  app.get('/api/me/discord', async (c) => {
    const session = await readSession(c.req.raw);
    if (!session) throw new ApiError(401, '未登录');
    const link = await linkByUserId(db, session.user.id);
    c.header('Cache-Control', 'no-store');
    // Never the Discord id: the SPA has no use for it (design §4.6).
    return c.json({ link: link ? { discord_username: link.discord_username, linked_at: link.linked_at } : null });
  });

  app.post('/api/me/discord/unlink', async (c) => {
    if (isReadOnly(env)) throw new ApiError(503, READ_ONLY_MESSAGE);
    const session = await readSession(c.req.raw);
    if (!session) throw new ApiError(401, '未登录');
    const removed = await unlinkAccounts(db, { userId: session.user.id }, 'web');
    return c.json({ ok: true, removed: removed !== null });
  });

  // --- binding pages ----------------------------------------------------------
  app.get(START_PATH, async (c) => {
    const session = await readSession(c.req.raw);
    // A stolen or forgotten-open session must not be able to bind a new Discord
    // account: ask for a login made just now.
    if (!session || nowSec() - session.issuedAt > REAUTH_SEC) return c.redirect(LOGIN_PATH, 302);
    const nonce = toB64url(crypto.getRandomValues(new Uint8Array(16)));
    const state = { n: nonce, u: session.user.id, exp: nowSec() + STATE_TTL_SEC };
    const value = await seal(STATE_PREFIX, state, env.SESSION_SECRET);
    const cookie = stateCookie();
    c.header('Set-Cookie', `${cookie.name}=${value}; ${cookie.attrs}; Max-Age=${STATE_TTL_SEC}`);
    c.header('Cache-Control', 'no-store');
    return c.redirect(authorizeUrl({ clientId: discord.clientId, redirectUri, state: nonce }), 302);
  });

  app.get('/link/discord/callback', async (c) => {
    // One attempt per state: whatever happens below, the browser forgets it.
    const cookie = stateCookie();
    c.header('Set-Cookie', `${cookie.name}=; ${cookie.attrs}; Max-Age=0`, { append: true });

    if (c.req.query('error') !== undefined) {
      return page(c, 400, '已取消绑定', `<p>你在 Discord 的授权页取消了授权，什么都没有改变。</p>${restart}`);
    }
    const session = await readSession(c.req.raw);
    if (!session) {
      return page(c, 401, '登录已失效', `<p>请重新开始绑定，会先带你登录信誉分。</p>${restart}`);
    }
    const state = await readState(c.req.raw);
    const code = c.req.query('code');
    if (!state || !code || state.nonce !== c.req.query('state')) {
      return page(
        c,
        400,
        '绑定请求已失效',
        `<p>可能已经超过 10 分钟，或者不是在发起绑定的那个浏览器里打开的。请重新开始。</p>${restart}`,
      );
    }
    if (state.userId !== session.user.id) {
      return page(c, 403, '账号不一致', `<p>这次绑定是用另一个信誉分账号发起的。请用现在登录的账号重新开始。</p>${restart}`);
    }

    let identity: DiscordIdentity;
    try {
      const token = await exchangeCode({ ...discord, code, redirectUri }, deps.fetch);
      identity = await fetchMe(token, deps.fetch);
    } catch (error) {
      onError('Discord binding: OAuth with Discord failed', error instanceof Error ? error.message : String(error));
      return page(c, 502, '连接 Discord 失败', `<p>暂时没能从 Discord 确认你的账号，请稍后再试。</p>${restart}`);
    }

    const [byDiscord, mine] = await Promise.all([linkByDiscordId(db, identity.id), linkByUserId(db, session.user.id)]);
    if (byDiscord && byDiscord.user_id !== session.user.id) return takenPage(c, identity.username);

    const pending = await seal(
      CONFIRM_PREFIX,
      { d: identity.id, name: identity.username, u: session.user.id, exp: nowSec() + CONFIRM_TTL_SEC },
      env.SESSION_SECRET,
    );
    const lines: string[] = [];
    if (identity.displayName !== identity.username) {
      lines.push(`<p>Discord 显示名：<strong>${esc(identity.displayName)}</strong></p>`);
    }
    if (mine && mine.discord_user_id === identity.id) {
      lines.push('<p>这个 Discord 已经绑定在你的账号上，确认后只会更新记下的用户名。</p>');
    } else {
      lines.push('<p>绑定后可以在 Discord 里查信誉分、待办和战报；随时可以在网页设置里解绑。</p>');
    }
    // `required`: the form cannot even be sent without agreeing to drop the old one.
    const replace =
      mine && mine.discord_user_id !== identity.id
        ? '<label><input type="checkbox" name="replace" value="1" required>' +
          `<span>换绑（解除原来的 <strong>@${esc(mine.discord_username)}</strong>）</span></label>`
        : '';
    return page(
      c,
      200,
      `把 Discord <strong>@${esc(identity.username)}</strong> 绑定到 <strong>${esc(session.user.username)}</strong>？`,
      `${lines.join('')}<form method="post" action="/link/discord/confirm">` +
        `<input type="hidden" name="payload" value="${esc(pending)}">${replace}` +
        `<div class="actions"><button type="submit">确认绑定</button><a href="${esc(homeHref)}">取消</a></div></form>`,
    );
  });

  app.post('/link/discord/confirm', async (c) => {
    if (isReadOnly(env)) throw new ApiError(503, READ_ONLY_MESSAGE);
    const session = await readSession(c.req.raw);
    if (!session) {
      return page(c, 401, '登录已失效', `<p>请重新开始绑定，会先带你登录信誉分。</p>${restart}`);
    }
    const form = await c.req.parseBody();
    const pending = await readPending(typeof form.payload === 'string' ? form.payload : '');
    if (!pending) {
      return page(c, 400, '确认页已过期', `<p>确认页只在 5 分钟内有效。请重新开始绑定。</p>${restart}`);
    }
    if (pending.userId !== session.user.id) {
      return page(c, 403, '账号不一致', `<p>这个确认页属于另一个信誉分账号。请用现在登录的账号重新开始。</p>${restart}`);
    }
    const outcome = await linkAccounts(db, {
      userId: session.user.id,
      discordUserId: pending.discordId,
      discordUsername: pending.discordUsername,
      replace: typeof form.replace === 'string',
      via: 'web',
    });
    switch (outcome.kind) {
      case 'linked':
      case 'relinked':
      case 'unchanged':
        c.header('Cache-Control', 'no-store');
        return c.redirect(successUrl, 302);
      case 'taken':
        return takenPage(c, pending.discordUsername);
      case 'needs_replace':
        return page(
          c,
          409,
          '需要确认换绑',
          `<p>你的账号已经绑定了 Discord <strong>@${esc(outcome.current.discord_username)}</strong>。要换成新的账号，请重新开始，并在确认页勾选「换绑」。</p>${restart}`,
        );
    }
  });

  app.notFound((c) => {
    if (c.req.path.startsWith('/api/')) return c.json({ error: 'Not found' }, 404);
    return page(c, 404, '页面不存在', home);
  });

  // Same `{ error }` shape for the SPA as the Worker app; a page for browsers.
  app.onError((err, c) => {
    let status = 500;
    let message = '服务器内部错误';
    if (err instanceof ApiError) {
      status = err.status;
      message = err.message;
    } else if (err instanceof HTTPException) {
      // Thrown by hono/csrf.
      status = err.status;
      message = err.status === 403 ? '请求来源不被允许' : '请求被拒绝';
    } else {
      onError('Discord binding route failed', err);
    }
    if (c.req.path.startsWith('/api/')) return c.json({ error: message }, status as ContentfulStatusCode);
    return page(c, status, esc(message), home);
  });

  return app;
}
