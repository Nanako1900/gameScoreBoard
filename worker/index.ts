// Cloudflare Worker entrypoint. Hono handles /api/* and /auth/*; everything else
// falls through to the static SPA via the ASSETS binding. The Cron Trigger runs
// the idempotent weekly credit heal.

import { Hono } from 'hono';
import type { AppEnv, Env } from './types';
import { ApiError, weeklyHeal } from './db';
import { registerRoutes } from './routes';
import { resetOffsetHours } from './time';

const app = new Hono<AppEnv>();

registerRoutes(app);

// Map thrown errors to `{ error }` with an appropriate status.
app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json({ error: err.message }, err.status as 400 | 401 | 403 | 404 | 500);
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
  },
};
