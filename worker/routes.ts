// Hono routes implementing every endpoint in docs/CONTRACT.md. Auth middleware
// loads the current user; per-route guards enforce judge/subject/admin rules.
// All external input arrives as `unknown` and is narrowed before use.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  VIOLATIONS,
  TIERS,
  WEEKLY_HEAL,
  WEEKLY_BONUS_CAP,
} from '../shared/scoring';
import type { AppEnv, Env, User } from './types';
import {
  ApiError,
  adminUpdateUser,
  avatarUrlExists,
  createRecord,
  disputeRecord,
  getLeaderboard,
  getUserById,
  getUserProfile,
  listRecords,
  revokeRecord,
  toUser,
  updateRoles,
  upsertUser,
  weeklyHeal,
} from './db';
import { nextResetAt, resetOffsetHours } from './time';
import {
  type CookieConfig,
  SESSION_COOKIE,
  STATE_COOKIE,
  buildClearSessionCookie,
  buildClearStateCookie,
  buildSessionCookie,
  buildStateCookie,
  getCookie,
  makeSignedState,
  readSignedState,
  signSession,
  verifySession,
} from './session';
import {
  buildAuthorizeUrl,
  exchangeCode,
  fetchUserInfo,
  resolveRedirectUri,
} from './oauth';

// --- input narrowing helpers -------------------------------------------------

function isRecordObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await req.json();
    return isRecordObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function optBool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

function optNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function parseCsvList(csv: string | undefined): string[] {
  if (!csv) return [];
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function cookieConfig(env: Env): CookieConfig {
  return { sameSite: env.COOKIE_SAMESITE, domain: env.COOKIE_DOMAIN };
}

/** Naive eTLD+1 (fine for simple domains like `nanako.org`). */
function registrableSuffix(host: string): string {
  const parts = host.split('.');
  return parts.length <= 2 ? host : parts.slice(-2).join('.');
}

/** Allow the avatar proxy to fetch only from the OAuth provider's domain family
 *  (or an explicit AVATAR_ALLOWED_HOSTS list) — prevents the proxy being an open
 *  relay / SSRF vector. */
function isAllowedAvatarHost(env: Env, host: string): boolean {
  if (parseCsvList(env.AVATAR_ALLOWED_HOSTS).includes(host)) return true;
  try {
    const oauthHost = new URL(env.OAUTH_BASE_URL).hostname;
    return host === oauthHost || registrableSuffix(host) === registrableSuffix(oauthHost);
  } catch {
    return false;
  }
}

function requireUser(caller: User | null): User {
  if (!caller) throw new ApiError(401, '未登录');
  return caller;
}

function parseRecordId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, '无效的记录 ID');
  return id;
}

const VALID_STATUS = new Set(['active', 'disputed', 'revoked']);

export function registerRoutes(app: Hono<AppEnv>): void {
  // --- CORS: active only when FRONTEND_ORIGIN is set (split-origin deploys).
  // For single-origin (unified Worker or EdgeOne edge-function proxy) this is a
  // no-op, so same-origin behavior is unchanged. -----------------------------
  app.use('*', async (c, next) => {
    const allowed = parseCsvList(c.env.FRONTEND_ORIGIN);
    if (allowed.length === 0) return next();
    return cors({
      origin: (origin) => (allowed.includes(origin) ? origin : null),
      credentials: true,
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Accept'],
      maxAge: 7200,
    })(c, next);
  });

  // --- Auth middleware: resolve current user from the session cookie ---------
  app.use('*', async (c, next) => {
    let user: User | null = null;
    const token = getCookie(c.req.raw, SESSION_COOKIE);
    if (token) {
      const payload = await verifySession(token, c.env.SESSION_SECRET);
      if (payload) {
        const row = await getUserById(c.env.DB, payload.sub);
        if (row) user = toUser(row);
      }
    }
    c.set('user', user);
    await next();
  });

  // --- Public --------------------------------------------------------------
  app.get('/api/config', (c) => {
    const offset = resetOffsetHours(c.env.RESET_TZ_OFFSET);
    // Lazy weekly heal: idempotent (guarded by the weekly_heals primary key), so
    // credit recovery works WITHOUT a Cron Trigger. Fired non-blocking so it never
    // delays the response; the first visit each week performs that week's heal.
    c.executionCtx.waitUntil(
      weeklyHeal(c.env.DB, offset).catch((err) => console.error('lazy weekly heal failed', err)),
    );
    return c.json({
      violations: VIOLATIONS,
      tiers: TIERS,
      weeklyHeal: WEEKLY_HEAL,
      weeklyBonusCap: WEEKLY_BONUS_CAP,
      nextResetAt: nextResetAt(offset),
    });
  });

  app.get('/api/leaderboard', async (c) => {
    const participants = await getLeaderboard(c.env.DB);
    return c.json({ participants });
  });

  app.get('/api/records', async (c) => {
    const limitRaw = c.req.query('limit');
    const limit = limitRaw !== undefined ? Number(limitRaw) : undefined;
    const subject = c.req.query('subject');
    const status = c.req.query('status');
    if (status !== undefined && !VALID_STATUS.has(status)) {
      throw new ApiError(400, '无效的状态筛选');
    }
    const records = await listRecords(c.env.DB, {
      limit: limit !== undefined && Number.isFinite(limit) ? limit : undefined,
      subject: subject || undefined,
      status: status || undefined,
    });
    return c.json({ records });
  });

  app.get('/api/users/:id', async (c) => {
    const profile = await getUserProfile(c.env.DB, c.req.param('id'));
    return c.json(profile);
  });

  // Same-origin avatar proxy: upstream avatars (e.g. nanako.org) may carry
  // `Cross-Origin-Resource-Policy: same-site`, which blocks embedding them from
  // another origin. Fetch them server-side and re-serve with permissive CORP.
  app.get('/api/avatar', async (c) => {
    const raw = c.req.query('u');
    if (!raw) throw new ApiError(400, '缺少头像地址');
    let target: URL;
    try {
      target = new URL(raw);
    } catch {
      throw new ApiError(400, '无效的头像地址');
    }
    if (target.protocol !== 'https:') throw new ApiError(400, '仅支持 https 头像');
    // Allow if the host is trusted (OAuth domain family / AVATAR_ALLOWED_HOSTS) OR
    // if this exact URL is a stored user avatar — zero-config for any avatar host.
    const allowed =
      isAllowedAvatarHost(c.env, target.hostname) || (await avatarUrlExists(c.env.DB, raw));
    if (!allowed) throw new ApiError(403, '不允许的头像来源');
    const upstream = await fetch(target.toString(), { headers: { Accept: 'image/*' } });
    if (!upstream.ok || !upstream.body) throw new ApiError(502, '头像获取失败');
    const headers = new Headers();
    headers.set('Content-Type', upstream.headers.get('Content-Type') ?? 'image/jpeg');
    headers.set('Cache-Control', 'public, max-age=86400');
    headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
    return new Response(upstream.body, { status: 200, headers });
  });

  // --- Authenticated -------------------------------------------------------
  app.get('/api/me', (c) => {
    return c.json({ user: c.get('user') });
  });

  app.post('/api/me/roles', async (c) => {
    const caller = requireUser(c.get('user'));
    const body = await readJsonBody(c.req.raw);
    const user = await updateRoles(c.env.DB, caller.id, {
      is_participant: optBool(body.is_participant),
      is_judge: optBool(body.is_judge),
    });
    return c.json({ user });
  });

  app.post('/api/records', async (c) => {
    const caller = requireUser(c.get('user'));
    if (!caller.is_judge) throw new ApiError(403, '需要裁判权限');
    const body = await readJsonBody(c.req.raw);
    const subjectId = body.subject_id;
    const type = body.type;
    if (typeof subjectId !== 'string' || subjectId.length === 0) {
      throw new ApiError(400, '缺少 subject_id');
    }
    if (typeof type !== 'string') {
      throw new ApiError(400, '缺少 type');
    }
    const note = typeof body.note === 'string' ? body.note : undefined;
    if (note !== undefined && note.length > 500) {
      throw new ApiError(400, '备注过长（最多 500 字）');
    }
    const offset = resetOffsetHours(c.env.RESET_TZ_OFFSET);
    const record = await createRecord(
      c.env.DB,
      caller,
      { subject_id: subjectId, type, note },
      offset,
    );
    return c.json({ record });
  });

  app.post('/api/records/:id/dispute', async (c) => {
    const caller = requireUser(c.get('user'));
    const id = parseRecordId(c.req.param('id'));
    const record = await disputeRecord(c.env.DB, caller, id);
    return c.json({ record });
  });

  app.post('/api/records/:id/revoke', async (c) => {
    const caller = requireUser(c.get('user'));
    const id = parseRecordId(c.req.param('id'));
    const record = await revokeRecord(c.env.DB, caller, id);
    return c.json({ record });
  });

  // --- Admin ---------------------------------------------------------------
  app.post('/api/admin/users/:id', async (c) => {
    const caller = requireUser(c.get('user'));
    if (!caller.is_admin) throw new ApiError(403, '需要管理员权限');
    const body = await readJsonBody(c.req.raw);
    await adminUpdateUser(c.env.DB, c.req.param('id'), {
      is_participant: optBool(body.is_participant),
      is_judge: optBool(body.is_judge),
      is_admin: optBool(body.is_admin),
      score: optNumber(body.score),
      delete: optBool(body.delete),
    });
    return c.json({ ok: true });
  });

  // --- OAuth ---------------------------------------------------------------
  app.get('/auth/login', async (c) => {
    const env: Env = c.env;
    const redirectUri = resolveRedirectUri(env, c.req.raw);
    const { state, cookieValue } = await makeSignedState(env.SESSION_SECRET);
    c.header('Set-Cookie', buildStateCookie(cookieValue, cookieConfig(env)), { append: true });
    return c.redirect(buildAuthorizeUrl(env, redirectUri, state), 302);
  });

  app.get('/auth/callback', async (c) => {
    const env: Env = c.env;
    const code = c.req.query('code');
    const stateParam = c.req.query('state');
    if (!code || !stateParam) throw new ApiError(400, '缺少授权参数');

    const cookie = getCookie(c.req.raw, STATE_COOKIE);
    const embedded = cookie ? await readSignedState(cookie, env.SESSION_SECRET) : null;
    if (!embedded || embedded !== stateParam) {
      throw new ApiError(400, 'state 校验失败');
    }

    const redirectUri = resolveRedirectUri(env, c.req.raw);
    const accessToken = await exchangeCode(env, code, redirectUri);
    const profile = await fetchUserInfo(env, accessToken);
    const admins = parseCsvList(env.ADMIN_USERNAMES);
    const { user, isNew } = await upsertUser(env.DB, profile, admins);

    const session = await signSession({ sub: user.id }, env.SESSION_SECRET);
    const cfg = cookieConfig(env);
    c.header('Set-Cookie', buildSessionCookie(session, cfg), { append: true });
    c.header('Set-Cookie', buildClearStateCookie(cfg), { append: true });
    // For a split deploy, FRONTEND_URL sends the browser back to the SPA origin;
    // unset → relative path (single-origin: unified Worker or EdgeOne proxy).
    const frontend = env.FRONTEND_URL ? env.FRONTEND_URL.replace(/\/$/, '') : '';
    return c.redirect(`${frontend}/${isNew ? '?onboarding=1' : ''}`, 302);
  });

  app.post('/auth/logout', (c) => {
    c.header('Set-Cookie', buildClearSessionCookie(cookieConfig(c.env)), { append: true });
    return c.json({ ok: true });
  });

  // --- Unmatched API/auth paths → JSON 404 (before SPA fallback) ------------
  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));
  app.all('/auth/*', (c) => c.json({ error: 'Not found' }, 404));
}
