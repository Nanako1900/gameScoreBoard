// server/src/api.ts — the wrapper that runs the Worker app on Node. Lives in
// tests/worker so it runs on BOTH engines: over real D1 here, and over
// PostgreSQL in the PG run, which is how production uses it.

import { env as testEnv } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { buildEnv, ConfigError, createApi, withForwardedProto } from '../../server/src/api';
import { expireDeadline, seedUser, statusOf } from './helpers';

const BASE_ENV = {
  OAUTH_BASE_URL: 'https://idp.example.com',
  OAUTH_CLIENT_ID: 'client',
  OAUTH_CLIENT_SECRET: 'secret',
  SESSION_SECRET: 'test-session-secret-0123456789abcdef',
  APP_URL: 'https://api.example.com',
  AI_ENABLED: 'false',
};

const api = (extra: Record<string, string> = {}) =>
  createApi(buildEnv({ ...BASE_ENV, ...extra }, testEnv.DB), { onError: () => undefined });

async function heals(): Promise<number> {
  const row = await testEnv.DB.prepare('SELECT COUNT(*) AS n FROM weekly_heals').first<{ n: number }>();
  return row?.n ?? 0;
}

async function overdueCase(): Promise<number> {
  await seedUser({ id: 'judge', judge: true });
  await seedUser({ id: 'subject' });
  const row = await testEnv.DB.prepare(
    `INSERT INTO records (subject_id, reporter_id, type, claim, deadline_at, status)
     VALUES ('subject', 'judge', 'no_show', '说好八点开黑，结果一直没上线也不回消息', datetime('now'), 'awaiting_statement')`,
  ).run();
  const id = Number(row.meta.last_row_id);
  await expireDeadline(id);
  return id;
}

describe('buildEnv', () => {
  it('refuses to start without the secrets and APP_URL, naming what is missing', () => {
    expect(() => buildEnv({ OAUTH_BASE_URL: 'https://idp.example.com' }, testEnv.DB)).toThrow(ConfigError);
    try {
      buildEnv({ ...BASE_ENV, APP_URL: '', SESSION_SECRET: undefined }, testEnv.DB);
    } catch (error) {
      expect((error as Error).message).toContain('SESSION_SECRET');
      expect((error as Error).message).toContain('APP_URL');
    }
  });

  it('passes every string variable through and wires DB and an empty ASSETS', async () => {
    const env = buildEnv({ ...BASE_ENV, FRONTEND_URL: 'https://score.example.com' }, testEnv.DB);
    expect(env.FRONTEND_URL).toBe('https://score.example.com');
    expect(env.DB).toBe(testEnv.DB);
    expect((await env.ASSETS.fetch(new Request('https://x/'))).status).toBe(404);
  });
});

describe('withForwardedProto', () => {
  it('gives the Worker the public https origin the Tunnel saw', async () => {
    const req = new Request('http://api.example.com/api/me?x=1', {
      method: 'POST',
      headers: { 'X-Forwarded-Proto': 'https', 'Content-Type': 'application/json' },
      body: '{"a":1}',
    });
    const out = withForwardedProto(req);
    expect(out.url).toBe('https://api.example.com/api/me?x=1');
    expect(out.method).toBe('POST');
    expect(out.headers.get('content-type')).toBe('application/json');
    expect(await out.text()).toBe('{"a":1}');
  });

  it('leaves other requests alone', () => {
    const plain = new Request('http://localhost:8787/healthz');
    expect(withForwardedProto(plain)).toBe(plain);
  });
});

describe('createApi', () => {
  it('serves the Worker routes', async () => {
    await seedUser({ id: 'a', score: 90 });
    const res = await api().fetch(new Request('https://api.example.com/api/leaderboard'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { participants: Array<{ id: string; score: number }> };
    expect(body.participants.map((p) => [p.id, p.score])).toEqual([['a', 90]]);
  });

  it('treats the forwarded https origin as its own for CSRF', async () => {
    // APP_URL points elsewhere, so only the rewritten request origin can allow this.
    const res = await api({ APP_URL: 'https://elsewhere.example.com' }).fetch(
      new Request('http://api.example.com/auth/logout', {
        method: 'POST',
        headers: { Origin: 'https://api.example.com', 'X-Forwarded-Proto': 'https' },
      }),
    );
    expect(res.status).toBe(200);
  });

  it('404s non-API paths — this host serves no SPA', async () => {
    const res = await api().fetch(new Request('https://api.example.com/players/abc'));
    expect(res.status).toBe(404);
  });

  it('drain() lets waitUntil work (the lazy jobs on /api/config) finish', async () => {
    const runtime = api();
    await runtime.fetch(new Request('https://api.example.com/api/config'));
    await runtime.drain(5_000);
    expect(await heals()).toBe(1);
  });
});

describe('runJobs — the timer that replaces Cloudflare cron', () => {
  it('heals the week and judges overdue cases', async () => {
    const id = await overdueCase();
    await api().runJobs();
    expect(await heals()).toBe(1);
    expect(await statusOf(id)).toBe('decided');
  });

  it('lets overlapping runs join one another', async () => {
    const runtime = api();
    const first = runtime.runJobs();
    expect(runtime.runJobs()).toBe(first);
    await first;
    expect(await heals()).toBe(1);
  });

  it('does nothing in READ_ONLY maintenance mode', async () => {
    const id = await overdueCase();
    await api({ READ_ONLY: '1' }).runJobs();
    expect(await heals()).toBe(0);
    expect(await statusOf(id)).toBe('awaiting_statement');
  });
});
