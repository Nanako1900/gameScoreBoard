// Cloudflare Worker entrypoint. Hono handles /api/* and /auth/*; everything else
// falls through to the static SPA via the ASSETS binding. The optional Cron
// Trigger runs the weekly credit heal plus a sweep of overdue cases — both are
// idempotent and also run lazily from GET /api/config, so the cron is optional.

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppEnv, Env } from './types';
import { ApiError } from './errors';
import { isReadOnly, legacySpaRedirect } from './http';
import { weeklyHeal } from './db';
import { sweepDueCases } from './cases';
import { registerRoutes } from './routes';
import { resetOffsetHours } from './time';

const app = new Hono<AppEnv>();

registerRoutes(app);

// Map thrown errors to `{ error }` with an appropriate status.
app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json({ error: err.message }, err.status as ContentfulStatusCode);
  }
  // Thrown by Hono middleware (csrf). Keep the `{ error }` shape the SPA reads.
  if (err instanceof HTTPException) {
    const message = err.status === 403 ? '请求来源不被允许' : '请求被拒绝';
    return c.json({ error: message }, err.status as ContentfulStatusCode);
  }
  console.error('unhandled worker error', err);
  return c.json({ error: '服务器内部错误' }, 500);
});

// SPA fallback: delegate non-API requests to the static assets — or, once the
// SPA has moved to FRONTEND_URL (Cloudflare Pages), send old links there.
// Temporary and uncacheable on purpose: browsers keep a 301 forever, so after a
// rollback anyone who had seen it would keep landing on the new host.
app.all('*', (c) => {
  const target = legacySpaRedirect(c.env, c.req.url);
  if (target) {
    c.header('Cache-Control', 'no-store');
    return c.redirect(target, 302);
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    if (isReadOnly(env)) return; // maintenance mode: no writes, not even from cron
    try {
      await weeklyHeal(env.DB, resetOffsetHours(env.RESET_TZ_OFFSET));
    } catch (err) {
      console.error('weekly heal failed', err);
    }
    try {
      // No per-run cap here: a cron firing is not a user waiting on a response.
      await sweepDueCases(env.DB, env, 50);
    } catch (err) {
      console.error('case sweep failed', err);
    }
  },
};
