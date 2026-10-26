// The scoreboard API on Node: the Worker's own app (worker/index.ts), compiled
// in unchanged, given
//   * an Env built from process.env, whose DB is PostgreSQL behind the
//     D1-compatible adapter (server/src/db/d1.ts);
//   * an ExecutionContext whose waitUntil() promises are tracked, so a
//     shutdown can let in-flight background work finish;
//   * a timer that runs the jobs Cloudflare's cron (and the lazy GET
//     /api/config path) ran — so heal, overdue judging and the weekly report
//     no longer depend on somebody opening the page.

import worker from '../../worker/index';
import { isReadOnly } from '../../worker/http';
import { ensureWeeklyReport } from '../../worker/report';
import { resetOffsetHours } from '../../worker/time';
import type { Env } from '../../worker/types';

/** Required in production; checked once at startup instead of failing per request. */
const REQUIRED = ['OAUTH_BASE_URL', 'OAUTH_CLIENT_ID', 'OAUTH_CLIENT_SECRET', 'SESSION_SECRET', 'APP_URL'] as const;

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/**
 * The API host serves no SPA: anything that is not /api or /auth is a 404 here.
 * (Cast: workers-types' Fetcher also has connect(), which Node never offers.)
 */
const NO_ASSETS = {
  fetch: async () =>
    new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    }),
} as unknown as Fetcher;

/**
 * Env for the Worker code. Every string in process.env is passed through, so a
 * variable the Worker learns to read later needs no change here. APP_URL is
 * required: behind the Tunnel the request origin is not the public URL, and
 * the OAuth redirect_uri would otherwise be derived from it.
 */
export function buildEnv(processEnv: NodeJS.ProcessEnv, db: D1Database): Env {
  const missing = REQUIRED.filter((key) => !processEnv[key]);
  if (missing.length > 0) throw new ConfigError(`missing required env: ${missing.join(', ')}`);
  const strings = Object.fromEntries(
    Object.entries(processEnv).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
  return { ...strings, DB: db, ASSETS: NO_ASSETS } as unknown as Env;
}

/**
 * Cloudflare Tunnel reaches this process over plain HTTP but says what the
 * browser used in X-Forwarded-Proto. The Worker code reads the request origin
 * (CSRF allowlist, own-host checks), so give it the public one.
 */
export function withForwardedProto(request: Request): Request {
  const proto = request.headers.get('x-forwarded-proto');
  const url = new URL(request.url);
  if (proto !== 'https' || url.protocol === 'https:') return request;
  url.protocol = 'https:';
  return new Request(url, request);
}

export interface ApiRuntime {
  fetch(request: Request): Promise<Response>;
  /** One run of the background jobs. Overlapping calls join the running one. */
  runJobs(): Promise<void>;
  /** Wait (bounded) for a running job and for waitUntil() work still in flight. */
  drain(timeoutMs: number): Promise<void>;
}

export interface ApiOptions {
  onError?: (context: string, error: unknown) => void;
  /** The clock the weekly report's Monday 10:30 is read from (tests). */
  now?: () => number;
}

export function createApi(env: Env, options: ApiOptions = {}): ApiRuntime {
  const onError = options.onError ?? ((context, error) => console.error(context, error));
  const pending = new Set<Promise<unknown>>();

  // Cast: workers-types' ExecutionContext also declares runtime-only members
  // (tracing, …) the Worker code never touches.
  const ctx = {
    waitUntil(promise: Promise<unknown>) {
      const tracked = promise
        .catch((error: unknown) => onError('background task failed', error))
        .finally(() => pending.delete(tracked));
      pending.add(tracked);
    },
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext;

  let running: Promise<void> | null = null;
  async function jobsOnce(): Promise<void> {
    if (isReadOnly(env)) return;
    const controller: ScheduledController = {
      scheduledTime: Date.now(),
      cron: 'node-timer',
      noRetry() {},
    };
    // Heal + overdue judging: exactly what the Worker's cron handler does.
    await worker.scheduled(controller, env, ctx);
    // The weekly report only ever ran lazily on GET /api/config; run it too.
    await ensureWeeklyReport(env.DB, env, resetOffsetHours(env.RESET_TZ_OFFSET), options.now?.()).catch((error: unknown) =>
      onError('weekly report failed', error),
    );
  }

  return {
    fetch: async (request) => worker.fetch(withForwardedProto(request), env, ctx),
    runJobs() {
      if (running) return running;
      const run = jobsOnce()
        .catch((error: unknown) => onError('background jobs failed', error))
        .finally(() => {
          if (running === run) running = null;
        });
      running = run;
      return run;
    },
    async drain(timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      // Running jobs too: a sweep cut off between its claim and its verdict
      // leaves the case in 'judging' until the stale reclaim. Loop, because
      // work still running can hand more to waitUntil().
      for (;;) {
        const work: Promise<unknown>[] = [...pending, ...(running ? [running] : [])];
        const left = deadline - Date.now();
        if (work.length === 0 || left <= 0) return;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timedOut = await Promise.race([
          Promise.allSettled(work).then(() => false),
          new Promise<boolean>((resolve) => {
            timer = setTimeout(() => resolve(true), left);
          }),
        ]);
        clearTimeout(timer);
        if (timedOut) return;
      }
    },
  };
}
