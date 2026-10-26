// Hono routes implementing every endpoint in docs/CONTRACT.md. Auth middleware
// loads the current user; per-route guards enforce judge/subject/admin rules.
// All external input arrives as `unknown` and is narrowed before use.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { csrf } from 'hono/csrf';
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
  adminGrantVia,
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
  MAX_BATCH_SUBJECTS,
  appealCase,
  confirmEscalation,
  dismissEscalation,
  fileCase,
  fileCases,
  getRecordItemById,
  listRecords,
  overrideCase,
  pendingCounts,
  reclassifyCase,
  revokeCase,
  submitStatement,
  sweepDueCases,
  withdrawCase,
  type BatchAccusation,
} from './cases';
import {
  cancelSession,
  createSession,
  getSessionDetail,
  listMyInvites,
  listSessions,
  rollCall,
  setRsvp,
  settleSession,
  updateSession,
  type SessionScope,
} from './sessions';
import {
  ensureWeeklyReport,
  getLatestReport,
  regenerateReport,
} from './report';
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
  cookieNames,
  buildClearNextCookie,
  buildClearSessionCookie,
  buildClearStateCookie,
  buildNextCookie,
  buildSessionCookie,
  buildStateCookie,
  getCookie,
  makeSignedState,
  readSignedState,
  safeNextPath,
  signSession,
  verifySession,
} from './session';
import {
  buildAuthorizeUrl,
  exchangeCode,
  fetchUserInfo,
  resolveRedirectUri,
} from './oauth';

import { registerAdminRoutes } from './routes-admin';
import { proxyAvatar } from './avatar';
import {
  allowedOrigins,
  cookieConfig,
  avatarAllowedHosts,
  hasNulInUrl,
  isReadOnly,
  isRecordObject,
  NUL_MESSAGE,
  optBool,
  optNumber,
  optString,
  parseCsvList,
  parseId,
  readJsonBody,
  requireAdmin,
  requireEnv,
  requireString,
  requireUser,
  statementWindowHours,
} from './http';

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

  // --- U+0000 ---------------------------------------------------------------
  // Refused in the URL here and in JSON bodies by readJsonBody (see there).
  app.use('*', async (c, next) => {
    if (hasNulInUrl(c.req.url)) throw new ApiError(400, NUL_MESSAGE);
    return next();
  });

  // --- CSRF ----------------------------------------------------------------
  // Form posts and body-less POSTs go cross-origin without a CORS preflight, and
  // once the SPA and the API sit on sibling subdomains every page on the parent
  // domain counts as same-site, so the SameSite=Lax session cookie rides along.
  // hono/csrf refuses those unless Sec-Fetch-Site is same-origin or the Origin
  // is one of ours. JSON requests always preflight, and the CORS middleware
  // above only answers FRONTEND_ORIGIN.
  const csrfGuard = csrf({
    origin: (origin, c) => allowedOrigins(c.env, c.req.url).includes(origin),
  });
  app.use('/api/*', csrfGuard);
  app.use('/auth/*', csrfGuard);

  // --- Maintenance mode ----------------------------------------------------
  // READ_ONLY=1 during the database cutover: every write is refused, so nothing
  // lands in D1 after the export. /auth/callback is a GET but upserts the user.
  // Logout only clears a cookie, so it stays available.
  app.use('*', async (c, next) => {
    if (!isReadOnly(c.env)) return next();
    // c.req.path is the percent-decoded path the router matches on. The raw
    // URL pathname would let /%61pi/... slip past this check yet still be
    // routed to /api/....
    const path = c.req.path;
    const scoped = path.startsWith('/api/') || path.startsWith('/auth/');
    const writes = !/^(GET|HEAD|OPTIONS)$/.test(c.req.method) || path === '/auth/callback';
    if (scoped && writes && path !== '/auth/logout') {
      throw new ApiError(503, '系统维护中（只读），请稍后再试');
    }
    return next();
  });

  // --- Auth middleware: resolve current user from the session cookie ---------
  app.use('*', async (c, next) => {
    let user: User | null = null;
    const token = getCookie(c.req.raw, cookieNames(cookieConfig(c.env)).session);
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
    // neither needs a Cron Trigger. All three write, so maintenance mode skips them.
    if (!isReadOnly(c.env)) {
      c.executionCtx.waitUntil(
        weeklyHeal(c.env.DB, offset).catch((err) => console.error('lazy weekly heal failed', err)),
      );
      c.executionCtx.waitUntil(
        sweepDueCases(c.env.DB, c.env).catch((err) => console.error('case sweep failed', err)),
      );
      // Third lazy job, same idempotency contract: weekly_reports' primary key is
      // the week, so a Monday-morning rush produces one narrative, not one each.
      c.executionCtx.waitUntil(
        ensureWeeklyReport(c.env.DB, c.env, offset).catch((err) =>
          console.error('weekly report failed', err),
        ),
      );
    }
    const cfg = await loadAiConfig(c.env.DB, c.env);
    return c.json({
      violations: VIOLATIONS,
      tiers: TIERS,
      weeklyHeal: WEEKLY_HEAL,
      weeklyBonusCap: WEEKLY_BONUS_CAP,
      statementWindowHours: statementWindowHours(c.env),
      aiEnabled: cfg.enabled,
      maxBatchSubjects: MAX_BATCH_SUBJECTS,
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
  // Allowed: the OAuth host, AVATAR_ALLOWED_HOSTS, or this exact URL being some
  // user's stored avatar. Hardening (types, redirects, size) lives in avatar.ts.
  app.get('/api/avatar', async (c) =>
    proxyAvatar(c.req.query('u'), {
      allowedHosts: avatarAllowedHosts(c.env),
      selfHosts: allowedOrigins(c.env, c.req.url).map((o) => new URL(o).hostname),
      isStoredAvatar: (url) => avatarUrlExists(c.env.DB, url),
    }),
  );

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
  // Two shapes: `subject_ids` (v3 default, AI classifies each) or `subject_id`
  // + `type` (deterministic — roll-call settlement, bonuses, corrections).
  app.post('/api/records', async (c) => {
    const caller = requireUser(c.get('user'));
    const body = await readJsonBody(c.req.raw);
    const offsetHours = resetOffsetHours(c.env.RESET_TZ_OFFSET);

    if (body.subject_ids !== undefined) {
      if (!Array.isArray(body.subject_ids)) throw new ApiError(400, 'subject_ids 必须是数组');
      const extras = isRecordObject(body.extras) ? body.extras : {};
      const accusations: BatchAccusation[] = body.subject_ids.map((raw) => {
        if (typeof raw !== 'string' || raw.length === 0) {
          throw new ApiError(400, 'subject_ids 里有无效的用户 ID');
        }
        return { subject_id: raw, extra: optString(extras[raw]) };
      });
      const result = await fileCases(
        c.env.DB,
        caller,
        accusations,
        requireString(body.claim, 'claim').trim(),
        optString(body.note),
        { offsetHours },
        c.env,
      );
      return c.json(result);
    }

    const record = await fileCase(
      c.env.DB,
      caller,
      {
        subject_id: requireString(body.subject_id, 'subject_id'),
        type: optString(body.type),
        claim: optString(body.claim),
        note: optString(body.note),
      },
      { offsetHours },
      c.env,
    );
    return c.json({ record, records: [record], failed: [] });
  });

  app.post('/api/records/:id/escalate', async (c) => {
    const caller = requireUser(c.get('user'));
    const record = await confirmEscalation(c.env.DB, caller, parseId(c.req.param('id'), '记录'));
    return c.json({ record });
  });

  app.post('/api/records/:id/escalate/dismiss', async (c) => {
    const caller = requireUser(c.get('user'));
    const record = await dismissEscalation(c.env.DB, caller, parseId(c.req.param('id'), '记录'));
    return c.json({ record });
  });

  app.post('/api/records/:id/reclassify', async (c) => {
    const caller = requireUser(c.get('user'));
    const body = await readJsonBody(c.req.raw);
    const record = await reclassifyCase(
      c.env.DB,
      caller,
      parseId(c.req.param('id'), '记录'),
      requireString(body.type, 'type'),
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
    const session = await createSession(
      c.env.DB,
      caller,
      {
        title: body.title,
        game: body.game,
        starts_at: body.starts_at,
        duration_min: body.duration_min,
        capacity: body.capacity,
        note: body.note,
        invite: body.invite,
      },
      resetOffsetHours(c.env.RESET_TZ_OFFSET),
    );
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

  // --- Invites -------------------------------------------------------------
  app.get('/api/me/invites', async (c) => {
    const caller = requireUser(c.get('user'));
    const sessions = await listMyInvites(c.env.DB, caller.id);
    return c.json({ sessions });
  });

  // --- Weekly report -------------------------------------------------------
  app.get('/api/report/latest', async (c) => {
    const report = await getLatestReport(c.env.DB);
    return c.json({ report });
  });

  registerAdminRoutes(app);

  // --- OAuth ---------------------------------------------------------------
  app.get('/auth/login', async (c) => {
    const env: Env = c.env;
    requireEnv(env, ['OAUTH_BASE_URL', 'OAUTH_CLIENT_ID', 'SESSION_SECRET']);
    const redirectUri = resolveRedirectUri(env, c.req.raw);
    const { state, cookieValue } = await makeSignedState(env.SESSION_SECRET);
    c.header('Set-Cookie', buildStateCookie(cookieValue, cookieConfig(env)), { append: true });
    // ?next=/link/... — come back to a binding page (the Discord bot's link)
    // instead of the SPA. Only this host's /link/ paths are accepted.
    const next = safeNextPath(c.req.query('next'));
    if (next) c.header('Set-Cookie', buildNextCookie(next, cookieConfig(env)), { append: true });
    return c.redirect(buildAuthorizeUrl(env, redirectUri, state), 302);
  });

  app.get('/auth/callback', async (c) => {
    const env: Env = c.env;
    requireEnv(env, ['OAUTH_BASE_URL', 'OAUTH_CLIENT_ID', 'OAUTH_CLIENT_SECRET', 'SESSION_SECRET']);
    const code = c.req.query('code');
    const stateParam = c.req.query('state');
    if (!code || !stateParam) throw new ApiError(400, '缺少授权参数');

    const cookie = getCookie(c.req.raw, cookieNames(cookieConfig(env)).state);
    const embedded = cookie ? await readSignedState(cookie, env.SESSION_SECRET) : null;
    if (!embedded || embedded !== stateParam) {
      throw new ApiError(400, 'state 校验失败');
    }

    const redirectUri = resolveRedirectUri(env, c.req.raw);
    const accessToken = await exchangeCode(env, code, redirectUri);
    const profile = await fetchUserInfo(env, accessToken);
    const grants = {
      subjectIds: parseCsvList(env.ADMIN_SUBJECT_IDS),
      usernames: parseCsvList(env.ADMIN_USERNAMES),
    };
    if (adminGrantVia(grants, profile) === 'username') {
      console.warn(
        `admin granted by ADMIN_USERNAMES to sub=${profile.id}; set ADMIN_SUBJECT_IDS instead`,
      );
    }
    const { user, isNew } = await upsertUser(env.DB, profile, grants);

    const session = await signSession({ sub: user.id }, env.SESSION_SECRET);
    const cfg = cookieConfig(env);
    c.header('Set-Cookie', buildSessionCookie(session, cfg), { append: true });
    c.header('Set-Cookie', buildClearStateCookie(cfg), { append: true });
    const nextRaw = getCookie(c.req.raw, cookieNames(cfg).next);
    const next = safeNextPath(nextRaw ? decodeURIComponent(nextRaw) : null);
    if (nextRaw) c.header('Set-Cookie', buildClearNextCookie(cfg), { append: true });
    if (next) return c.redirect(next, 302);
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
