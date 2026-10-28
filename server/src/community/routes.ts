import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ApiError } from '../../../worker/errors';
import { allowedOrigins, cookieConfig, hasNulInUrl, isReadOnly, parseCsvList } from '../../../worker/http';
import { cookieNames, getCookie, verifySession } from '../../../worker/session';
import type { Env } from '../../../worker/types';
import type { CommunityFunView, CommunityResourceKind, CommunityResourceView } from '../../../shared/community';
import { CommunityService } from './service';
import { CommunityStoreError, type CommunityStore } from './store';

export interface CommunityRoleReadView { choices: CommunityResourceView[]; selectedRefs: string[]; maxChoices: number; enabled: boolean }
export interface CommunityRouteDeps {
  store: CommunityStore; db: D1Database; env: Env;
  membership?: { readRoles(memberRef: string): Promise<CommunityRoleReadView> };
  fun?: { list(memberRef: string | null, isAdmin: boolean): Promise<CommunityFunView[]> };
  onError?: (context: string, error: unknown) => void;
}
type RouteEnv = { Variables: { communityUserId: string } };
function fail(status: number, code: string, message: string): never { throw new CommunityStoreError(status, code, message); }
function exact(body: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(body).some(key => !keys.includes(key))) fail(400, 'invalid_input', '请求字段无效');
}
function key(body: Record<string, unknown>): string {
  const value = body.requestKey;
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || value.includes('\u0000')) return fail(400, 'invalid_input', '缺少有效的请求标识');
  return value;
}
function version(body: Record<string, unknown>): number {
  if (typeof body.expectedVersion !== 'number' || !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0) return fail(400, 'invalid_input', '缺少有效的内容版本');
  return body.expectedVersion;
}
async function body(c: Context): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:;|$)/i.test(c.req.header('Content-Type') ?? '')) return fail(415, 'invalid_input', '请使用 JSON 请求');
  const raw = await c.req.text(); if (Buffer.byteLength(raw) > 65_536) return fail(413, 'invalid_input', '请求内容过长');
  let value: unknown; try { value = JSON.parse(raw); } catch { return fail(400, 'invalid_input', 'JSON 格式无效'); }
  if (value === null || typeof value !== 'object' || Array.isArray(value) || raw.includes('\\u0000') || raw.includes('\u0000')) return fail(400, 'invalid_input', '请求内容无效');
  return value as Record<string, unknown>;
}
function withoutMeta(input: Record<string, unknown>): Record<string, unknown> {
  const payload = { ...input }; delete payload.requestKey; delete payload.expectedVersion; return payload;
}

/** Node-only HTTP boundary. The app process has no Discord token and only queues operations. */
export function createCommunityRoutes(deps: CommunityRouteDeps): Hono<RouteEnv> {
  const { store, db, env } = deps; const service = new CommunityService(store, db); const app = new Hono<RouteEnv>();
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store'); c.header('X-Content-Type-Options', 'nosniff');
    if (hasNulInUrl(c.req.url)) fail(400, 'invalid_input', '请求包含非法字符');
    await next();
  });
  app.use('/api/*', async (c, next) => {
    const allowed = parseCsvList(env.FRONTEND_ORIGIN);
    return cors({ origin: origin => allowed.includes(origin) ? origin : null, credentials: true,
      allowMethods: ['GET', 'POST', 'OPTIONS'], allowHeaders: ['Content-Type', 'Accept'], maxAge: 7200 })(c, next);
  });
  app.use('/api/*', async (c, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      const origin = c.req.header('Origin');
      if (!origin || !allowedOrigins(env, c.req.url).includes(origin)) fail(403, 'forbidden', '请求来源不被允许');
      if (isReadOnly(env)) fail(503, 'read_only', '系统维护中（只读），请稍后再试');
    }
    const token = getCookie(c.req.raw, cookieNames(cookieConfig(env)).session);
    const session = token ? await verifySession(token, env.SESSION_SECRET) : null;
    if (!session) fail(401, 'unauthorized', '未登录');
    await service.actorFromWeb(session.sub); c.set('communityUserId', session.sub); await next();
  });
  const user = (c: Context<RouteEnv>) => c.get('communityUserId');
  const accepted = (c: Context<RouteEnv>, operation: unknown) => c.json({ operation }, 202);
  app.get('/api/community', async c => c.json(await service.overview(user(c))));
  app.get('/api/community/rooms', async c => c.json({ rooms: await service.rooms(user(c)) }));
  app.get('/api/community/rooms/:ref', async c => c.json(await service.room(c.req.param('ref'), user(c))));
  app.get('/api/community/resources', async c => {
    const requested = c.req.query('kind');
    if (requested !== undefined && !['category', 'voice', 'text', 'role', 'member'].includes(requested)) fail(400, 'invalid_input', '资源类型无效');
    return c.json({ resources: await service.resources(user(c), requested as CommunityResourceKind | undefined) });
  });
  app.get('/api/community/roles', async c => {
    const actor = await service.actorFromWeb(user(c)); if (!actor.memberAvailable || !actor.memberRef) fail(403, 'membership_required', '需要当前服务器成员身份');
    if (deps.membership) return c.json(await deps.membership.readRoles(actor.memberRef));
    const settings = (await store.settings()).settings;
    const selectedRefs = (await store.pool.query('SELECT role_ref FROM community_role_choices WHERE guild_id=$1 AND member_ref=$2', [store.guildId, actor.memberRef])).rows.map(row => String(row.role_ref));
    const resources = await service.resources(user(c), 'role');
    return c.json({ choices: resources, selectedRefs, maxChoices: settings.roles.maxChoices, enabled: settings.enabled && settings.roles.enabled });
  });
  app.get('/api/community/fun', async c => {
    const actor = await service.actorFromWeb(user(c)); if (!actor.isAdmin && !actor.memberAvailable) fail(403, 'membership_required', '需要当前服务器成员身份');
    return c.json({ items: deps.fun ? await deps.fun.list(actor.memberRef, actor.isAdmin) : [] });
  });
  app.get('/api/community/operations/:ref', async c => c.json({ operation: await service.operation(c.req.param('ref'), user(c)) }));
  app.post('/api/community/rooms', async c => {
    const input = await body(c); exact(input, ['name', 'requestKey']);
    return accepted(c, await service.enqueue(user(c), 'room.create', null, withoutMeta(input), key(input)));
  });
  app.post('/api/community/rooms/:ref/actions', async c => {
    const input = await body(c); if (typeof input.action !== 'string') fail(400, 'invalid_input', '缺少房间操作');
    return accepted(c, await service.enqueue(user(c), 'room.' + input.action, c.req.param('ref'), withoutMeta(input), key(input), version(input)));
  });
  app.post('/api/community/roles', async c => {
    const input = await body(c); exact(input, ['roleRefs', 'requestKey']);
    return accepted(c, await service.enqueue(user(c), 'roles.set', null, withoutMeta(input), key(input)));
  });
  app.post('/api/community/fun', async c => {
    const input = await body(c); exact(input, ['kind', 'input', 'roomRef', 'requestKey']);
    return accepted(c, await service.enqueue(user(c), 'fun.create', null, withoutMeta(input), key(input)));
  });
  app.post('/api/community/fun/:ref/actions', async c => {
    const input = await body(c); exact(input, ['action', 'choice', 'requestKey']);
    if (!['vote', 'close', 'redraw'].includes(String(input.action))) fail(400, 'invalid_input', '不支持此互动操作');
    const payload = { ref: c.req.param('ref'), ...(input.choice === undefined ? {} : { choice: input.choice }) };
    return accepted(c, await service.enqueue(user(c), 'fun.' + input.action, null, payload, key(input)));
  });
  app.get('/api/admin/community', async c => c.json(await service.settings(user(c))));
  app.post('/api/admin/community', async c => {
    const input = await body(c); exact(input, ['settings', 'expectedVersion', 'requestKey']);
    return c.json(await service.saveSettings(user(c), input.settings, version(input), key(input)), 202);
  });
  app.get('/api/admin/community/resources', async c => {
    if (!(await service.actorFromWeb(user(c))).isAdmin) fail(403, 'forbidden', '需要管理员权限');
    const requested = c.req.query('kind');
    if (requested !== undefined && !['category', 'voice', 'text', 'role', 'member'].includes(requested)) fail(400, 'invalid_input', '资源类型无效');
    return c.json({ resources: await service.resources(user(c), requested as CommunityResourceKind | undefined) });
  });
  app.get('/api/admin/community/operations', async c => c.json({ operations: await service.operations(user(c)) }));
  app.get('/api/admin/community/audit', async c => c.json({ audit: await service.audit(user(c)) }));
  app.post('/api/admin/community/sync', async c => {
    const input = await body(c); exact(input, ['requestKey', 'kind']);
    const kind = input.kind ?? 'resources.sync'; if (!['resources.sync', 'panel.refresh'].includes(String(kind))) fail(400, 'invalid_input', '不支持此同步操作');
    return accepted(c, await service.enqueue(user(c), String(kind), null, {}, key(input)));
  });
  app.notFound(c => c.json({ error: '内容不存在' }, 404));
  app.onError((error, c) => {
    let status = 500; let message = '社区服务暂不可用'; let code = 'internal_error';
    if (error instanceof CommunityStoreError) { status = error.status; message = error.message; code = error.code; }
    else if (error instanceof ApiError) { status = error.status; message = error.message; code = 'invalid_input'; }
    else if (error instanceof HTTPException) { status = error.status; message = '请求被拒绝'; code = 'forbidden'; }
    else deps.onError?.('community route failed', error);
    return c.json({ error: message, code }, status as ContentfulStatusCode);
  });
  return app;
}
