// Hono routes implementing every endpoint in docs/CONTRACT.md. Auth middleware
// loads the current user; per-route guards enforce judge/subject/admin rules.
// All external input arrives as `unknown` and is narrowed before use.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  STATEMENT_WINDOW_HOURS,
  TIERS,
  VIOLATIONS,
  VIOLATION_MAP,
  WEEKLY_BONUS_CAP,
  WEEKLY_HEAL,
  isCaseStatus,
} from '../shared/scoring';
import type { AppEnv, Env, User } from './types';
import {
  adminUpdateUser,
  avatarUrlExists,
  getLeaderboard,
  getUserById,
  getUserProfile,
  toUser,
  updateDisplayName,
  updateRoles,
  upsertUser,
  weeklyHeal,
} from './db';
import { ApiError } from './errors';
import {
  appealCase,
  fileCase,
  getRecordItemById,
  listRecords,
  overrideCase,
  pendingCounts,
  revokeCase,
  submitStatement,
  sweepDueCases,
  withdrawCase,
} from './cases';
import {
  cancelSession,
  createSession,
  getSessionDetail,
  listSessions,
  rollCall,
  setRsvp,
  settleSession,
  updateSession,
  type SessionScope,
} from './sessions';
import {
  AI_SETTING_KEYS,
  aiDisabledReason,
  loadAiConfig,
  normalizeBaseUrl,
  readSettings,
  resolveAiConfig,
  writeSetting,
} from './ai/config';
import { judgeCase } from './ai/provider';
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

function optString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function requireString(v: unknown, label: string): string {
  if (typeof v !== 'string' || v.trim().length === 0) {
    throw new ApiError(400, `缺少 ${label}`);
  }
  return v;
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

/** Fail fast with a clear message when required config (the OAuth secrets) is
 *  missing, instead of surfacing an opaque 500 from a downstream undefined. */
function requireEnv(env: Env, keys: readonly (keyof Env)[]): void {
  const missing = keys.filter((k) => {
    const v = env[k];
    return typeof v !== 'string' || v.length === 0;
  });
  if (missing.length > 0) {
    throw new ApiError(
      500,
      `服务器缺少配置：${missing.join('、')} —— 请在 Worker 的 Variables and Secrets 里以「机密(Secret)」设置`,
    );
  }
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

function requireAdmin(caller: User | null): User {
  const user = requireUser(caller);
  if (!user.is_admin) throw new ApiError(403, '需要管理员权限');
  return user;
}

function parseId(raw: string, label: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, `无效的${label} ID`);
  return id;
}

function statementWindowHours(env: Env): number {
  const n = Number(env.STATEMENT_WINDOW_HOURS);
  if (!Number.isFinite(n) || n <= 0 || n > 24 * 14) return STATEMENT_WINDOW_HOURS;
  return n;
}

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
  app.get('/api/config', async (c) => {
    const offset = resetOffsetHours(c.env.RESET_TZ_OFFSET);
    // Two lazy, idempotent background jobs ride on the first page load: the
    // weekly credit heal (guarded by the weekly_heals primary key) and judging
    // of cases whose statement window lapsed (guarded by a conditional status
    // update). Both are non-blocking, so neither delays this response, and
    // neither needs a Cron Trigger.
    c.executionCtx.waitUntil(
      weeklyHeal(c.env.DB, offset).catch((err) => console.error('lazy weekly heal failed', err)),
    );
    c.executionCtx.waitUntil(
      sweepDueCases(c.env.DB, c.env).catch((err) => console.error('case sweep failed', err)),
    );
    const cfg = await loadAiConfig(c.env.DB, c.env);
    return c.json({
      violations: VIOLATIONS,
      tiers: TIERS,
      weeklyHeal: WEEKLY_HEAL,
      weeklyBonusCap: WEEKLY_BONUS_CAP,
      statementWindowHours: statementWindowHours(c.env),
      aiEnabled: cfg.enabled,
      nextResetAt: nextResetAt(offset),
    });
  });

  app.get('/api/leaderboard', async (c) => {
    const participants = await getLeaderboard(c.env.DB);
    return c.json({ participants });
  });

  app.get('/api/records', async (c) => {
    const caller = c.get('user');
    const limitRaw = c.req.query('limit');
    const limit = limitRaw !== undefined ? Number(limitRaw) : undefined;
    const status = c.req.query('status');
    if (status !== undefined && !isCaseStatus(status)) {
      throw new ApiError(400, '无效的状态筛选');
    }
    const sessionRaw = c.req.query('session');
    const mine = c.req.query('mine');
    if (mine === 'pending' && !caller) throw new ApiError(401, '未登录');
    const records = await listRecords(c.env.DB, {
      limit: limit !== undefined && Number.isFinite(limit) ? limit : undefined,
      subject: c.req.query('subject') || undefined,
      status: status || undefined,
      session: sessionRaw ? parseId(sessionRaw, '约局') : undefined,
      pendingFor: mine === 'pending' && caller ? caller.id : undefined,
    });
    return c.json({ records });
  });

  app.get('/api/records/:id', async (c) => {
    const record = await getRecordItemById(c.env.DB, parseId(c.req.param('id'), '记录'));
    if (!record) throw new ApiError(404, '记录不存在');
    return c.json({ record });
  });

  app.get('/api/users/:id', async (c) => {
    const profile = await getUserProfile(c.env.DB, c.req.param('id'));
    return c.json(profile);
  });

  app.get('/api/sessions', async (c) => {
    const caller = c.get('user');
    const raw = c.req.query('scope');
    const scope: SessionScope =
      raw === 'past' || raw === 'mine' || raw === 'upcoming' ? raw : 'upcoming';
    if (scope === 'mine' && !caller) throw new ApiError(401, '未登录');
    const sessions = await listSessions(c.env.DB, scope, caller?.id ?? null);
    return c.json({ sessions });
  });

  app.get('/api/sessions/:id', async (c) => {
    const caller = c.get('user');
    const session = await getSessionDetail(
      c.env.DB,
      parseId(c.req.param('id'), '约局'),
      caller?.id ?? null,
    );
    const records = await listRecords(c.env.DB, { session: session.id, limit: 100 });
    return c.json({ session, records });
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
  app.get('/api/me', async (c) => {
    const user = c.get('user');
    if (!user) return c.json({ user: null, pending: { statements: 0, appeals: 0 } });
    const pending = await pendingCounts(c.env.DB, user);
    return c.json({ user, pending });
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

  app.post('/api/me/display-name', async (c) => {
    const caller = requireUser(c.get('user'));
    const body = await readJsonBody(c.req.raw);
    // display_name: a string sets a custom name; null clears it (use the OAuth name).
    let displayName: string | null;
    if (body.display_name === null) {
      displayName = null;
    } else if (typeof body.display_name === 'string') {
      displayName = body.display_name;
    } else {
      throw new ApiError(400, '缺少 display_name');
    }
    const user = await updateDisplayName(c.env.DB, caller.id, displayName);
    return c.json({ user });
  });

  // --- Cases ---------------------------------------------------------------
  app.post('/api/records', async (c) => {
    const caller = requireUser(c.get('user'));
    const body = await readJsonBody(c.req.raw);
    const record = await fileCase(
      c.env.DB,
      caller,
      {
        subject_id: requireString(body.subject_id, 'subject_id'),
        type: requireString(body.type, 'type'),
        claim: optString(body.claim),
        note: optString(body.note),
      },
      { offsetHours: resetOffsetHours(c.env.RESET_TZ_OFFSET) },
      c.env,
    );
    return c.json({ record });
  });

  app.post('/api/records/:id/statement', async (c) => {
    const caller = requireUser(c.get('user'));
    const body = await readJsonBody(c.req.raw);
    const record = await submitStatement(
      c.env.DB,
      caller,
      parseId(c.req.param('id'), '记录'),
      requireString(body.statement, 'statement'),
      c.env,
    );
    return c.json({ record });
  });

  app.post('/api/records/:id/withdraw', async (c) => {
    const caller = requireUser(c.get('user'));
    const record = await withdrawCase(c.env.DB, caller, parseId(c.req.param('id'), '记录'));
    return c.json({ record });
  });

  app.post('/api/records/:id/appeal', async (c) => {
    const caller = requireUser(c.get('user'));
    const body = await readJsonBody(c.req.raw);
    const record = await appealCase(
      c.env.DB,
      caller,
      parseId(c.req.param('id'), '记录'),
      optString(body.reason),
    );
    return c.json({ record });
  });

  // Legacy alias kept so an older cached SPA bundle keeps working after deploy.
  app.post('/api/records/:id/dispute', async (c) => {
    const caller = requireUser(c.get('user'));
    const record = await appealCase(
      c.env.DB,
      caller,
      parseId(c.req.param('id'), '记录'),
      undefined,
    );
    return c.json({ record });
  });

  app.post('/api/records/:id/revoke', async (c) => {
    const caller = requireUser(c.get('user'));
    const record = await revokeCase(c.env.DB, caller, parseId(c.req.param('id'), '记录'));
    return c.json({ record });
  });

  // --- Sessions ------------------------------------------------------------
  app.post('/api/sessions', async (c) => {
    const caller = requireUser(c.get('user'));
    const body = await readJsonBody(c.req.raw);
    const session = await createSession(c.env.DB, caller, {
      title: body.title,
      game: body.game,
      starts_at: body.starts_at,
      duration_min: body.duration_min,
      capacity: body.capacity,
      note: body.note,
    });
    return c.json({ session });
  });

  app.patch('/api/sessions/:id', async (c) => {
    const caller = requireUser(c.get('user'));
    const body = await readJsonBody(c.req.raw);
    const session = await updateSession(
      c.env.DB,
      caller,
      parseId(c.req.param('id'), '约局'),
      body,
    );
    return c.json({ session });
  });

  app.post('/api/sessions/:id/cancel', async (c) => {
    const caller = requireUser(c.get('user'));
    const session = await cancelSession(c.env.DB, caller, parseId(c.req.param('id'), '约局'));
    return c.json({ session });
  });

  app.post('/api/sessions/:id/rsvp', async (c) => {
    const caller = requireUser(c.get('user'));
    const body = await readJsonBody(c.req.raw);
    const session = await setRsvp(
      c.env.DB,
      caller,
      parseId(c.req.param('id'), '约局'),
      body.rsvp,
    );
    return c.json({ session });
  });

  app.post('/api/sessions/:id/rollcall', async (c) => {
    const caller = requireUser(c.get('user'));
    const body = await readJsonBody(c.req.raw);
    const result = await rollCall(
      c.env.DB,
      caller,
      parseId(c.req.param('id'), '约局'),
      body.entries,
      resetOffsetHours(c.env.RESET_TZ_OFFSET),
    );
    return c.json(result);
  });

  app.post('/api/sessions/:id/settle', async (c) => {
    const caller = requireUser(c.get('user'));
    const body = await readJsonBody(c.req.raw);
    const result = await settleSession(
      c.env.DB,
      caller,
      parseId(c.req.param('id'), '约局'),
      body.file,
      optBool(body.skip_all) === true,
      c.env,
      resetOffsetHours(c.env.RESET_TZ_OFFSET),
    );
    return c.json(result);
  });

  // --- Admin ---------------------------------------------------------------
  app.post('/api/admin/users/:id', async (c) => {
    requireAdmin(c.get('user'));
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

  app.post('/api/admin/records/:id/override', async (c) => {
    const caller = requireAdmin(c.get('user'));
    const body = await readJsonBody(c.req.raw);
    const delta = optNumber(body.delta);
    if (delta === undefined) throw new ApiError(400, '缺少 delta');
    const record = await overrideCase(
      c.env.DB,
      caller,
      parseId(c.req.param('id'), '记录'),
      delta,
      requireString(body.reason, 'reason'),
    );
    return c.json({ record });
  });

  app.get('/api/admin/ai-config', async (c) => {
    requireAdmin(c.get('user'));
    const settings = await readSettings(c.env.DB);
    const cfg = resolveAiConfig(settings, c.env);
    const stats = await c.env.DB
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) AS fallbacks,
                SUM(clamped) AS clamps,
                AVG(latency_ms) AS avg_latency
           FROM ai_verdicts WHERE created_at >= datetime('now', '-7 days')`,
      )
      .first<{ total: number; fallbacks: number; clamps: number; avg_latency: number | null }>();
    const total = stats?.total ?? 0;
    return c.json({
      enabled: cfg.enabled,
      base_url: cfg.baseUrl,
      model: cfg.model,
      temperature: cfg.temperature,
      prompt: cfg.prompt,
      prompt_version: cfg.promptVersion,
      has_api_key: (c.env.AI_API_KEY ?? '').length > 0,
      disabled_reason: aiDisabledReason(cfg, c.env),
      recent: {
        total,
        fallbackRate: total > 0 ? (stats?.fallbacks ?? 0) / total : 0,
        clampRate: total > 0 ? (stats?.clamps ?? 0) / total : 0,
        avgLatencyMs: Math.round(stats?.avg_latency ?? 0),
      },
    });
  });

  app.post('/api/admin/ai-config', async (c) => {
    const caller = requireAdmin(c.get('user'));
    const body = await readJsonBody(c.req.raw);
    if (body.api_key !== undefined) {
      throw new ApiError(
        400,
        'API Key 不存数据库，请用 `wrangler secret put AI_API_KEY` 设置',
      );
    }
    const writes: Promise<void>[] = [];
    if (body.enabled !== undefined) {
      const enabled = optBool(body.enabled);
      if (enabled === undefined) throw new ApiError(400, 'enabled 必须是布尔值');
      writes.push(writeSetting(c.env.DB, AI_SETTING_KEYS.enabled, String(enabled), caller.id));
    }
    if (body.base_url !== undefined) {
      const url = normalizeBaseUrl(requireString(body.base_url, 'base_url'));
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new ApiError(400, 'base_url 不是合法的 URL');
      }
      if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
        throw new ApiError(400, 'base_url 必须是 https（本地调试可用 localhost）');
      }
      writes.push(writeSetting(c.env.DB, AI_SETTING_KEYS.baseUrl, url, caller.id));
    }
    if (body.model !== undefined) {
      writes.push(
        writeSetting(c.env.DB, AI_SETTING_KEYS.model, requireString(body.model, 'model').trim(), caller.id),
      );
    }
    if (body.temperature !== undefined) {
      const t = optNumber(body.temperature);
      if (t === undefined || t < 0 || t > 2) throw new ApiError(400, 'temperature 需在 0–2 之间');
      writes.push(writeSetting(c.env.DB, AI_SETTING_KEYS.temperature, String(t), caller.id));
    }
    if (body.prompt !== undefined) {
      const prompt = requireString(body.prompt, 'prompt');
      if (prompt.length > 8000) throw new ApiError(400, '提示词最多 8000 字');
      writes.push(writeSetting(c.env.DB, AI_SETTING_KEYS.prompt, prompt, caller.id));
    }
    await Promise.all(writes);
    const cfg = await loadAiConfig(c.env.DB, c.env);
    return c.json({ ok: true, enabled: cfg.enabled, prompt_version: cfg.promptVersion });
  });

  // Dry run against a sample case: writes nothing, touches nobody's score.
  app.post('/api/admin/ai-config/test', async (c) => {
    requireAdmin(c.get('user'));
    const body = await readJsonBody(c.req.raw);
    const cfg = await loadAiConfig(c.env.DB, c.env);
    const def = VIOLATION_MAP.no_show;
    const started = Date.now();
    const outcome = await judgeCase(cfg, {
      def,
      subject: { name: '测试选手', score: 72, tier: '基本靠谱' },
      priors: { sameType30d: 1, penalties30d: 2 },
      claim:
        optString(body.claim) ??
        '说好八点五排，等到八点四十还没上线，微信也不回，最后四缺一散了。',
      statement:
        optString(body.statement) ??
        '公司临时通宵发版，手机落在会议室了，第二天才看到消息，已经给大家发了红包。',
      sessionContext: null,
    });
    return c.json({
      ok: outcome.source === 'ai',
      source: outcome.source,
      verdict: {
        delta: outcome.delta,
        headline: outcome.headline,
        reasoning: outcome.reasoning,
        factors: outcome.factors,
      },
      error: outcome.audit.error,
      clamped: outcome.audit.clamped,
      parsed_delta: outcome.audit.parsedDelta,
      latency_ms: outcome.audit.latencyMs || Date.now() - started,
      raw: outcome.audit.rawResponse,
    });
  });

  // --- OAuth ---------------------------------------------------------------
  app.get('/auth/login', async (c) => {
    const env: Env = c.env;
    requireEnv(env, ['OAUTH_BASE_URL', 'OAUTH_CLIENT_ID', 'SESSION_SECRET']);
    const redirectUri = resolveRedirectUri(env, c.req.raw);
    const { state, cookieValue } = await makeSignedState(env.SESSION_SECRET);
    c.header('Set-Cookie', buildStateCookie(cookieValue, cookieConfig(env)), { append: true });
    return c.redirect(buildAuthorizeUrl(env, redirectUri, state), 302);
  });

  app.get('/auth/callback', async (c) => {
    const env: Env = c.env;
    requireEnv(env, ['OAUTH_BASE_URL', 'OAUTH_CLIENT_ID', 'OAUTH_CLIENT_SECRET', 'SESSION_SECRET']);
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
