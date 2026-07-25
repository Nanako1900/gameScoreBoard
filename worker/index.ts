// Cloudflare Worker entrypoint. Hono handles /api/* and /auth/*; everything else
// falls through to the static SPA via the ASSETS binding. The optional Cron
// Trigger runs the weekly credit heal plus a sweep of overdue cases — both are
// idempotent and also run lazily from GET /api/config, so the cron is optional.

import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppEnv, Env } from './types';
import { ApiError } from './errors';
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
  console.error('unhandled worker error', err);
  return c.json({ error: '服务器内部错误' }, 500);
});

// SPA fallback: delegate non-API requests to the static assets.
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
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
