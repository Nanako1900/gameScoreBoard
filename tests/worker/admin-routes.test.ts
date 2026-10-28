// HTTP-level tests for every /api/admin/* route (worker/routes-admin.ts), driven
// through the real Hono app so the auth middleware, CSRF guard, maintenance mode
// and the onError → `{ error }` mapping are all in the loop.
//
// These pin the CURRENT observable behaviour on D1 ahead of the PostgreSQL port:
// numeric aggregates must stay numbers (not COUNT-as-string), rates must stay
// 0 on an empty table (not NaN / null), settings must upsert, and an override
// must leave exactly one score_events row per call.

import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VIOLATION_MAP } from '../../shared/scoring';
import worker from '../../worker/index';
import { loadAiConfig, readSettings, shortHash } from '../../worker/ai/config';
import { DEFAULT_SYSTEM_PROMPT } from '../../worker/ai/prompt';
import { DEFAULT_CLASSIFY_PROMPT } from '../../worker/ai/classify';
import { DEFAULT_REPORT_PROMPT } from '../../worker/ai/report';
import { openAiApiKey, sealAiApiKey } from '../../worker/ai/secrets';
import { SESSION_COOKIE, signSession } from '../../worker/session';
import type { Env } from '../../worker/types';
import { noAiEnv, scoreEventCount, scoreOf, seedUser, statusOf } from './helpers';

// The test bindings only carry DB, so the session secret is supplied here.
const SECRET = 'admin-routes-test-session-secret';
const ORIGIN = 'https://edg.test';
const MASTER_KEY = btoa('m'.repeat(32));
const FAKE_KEY = 'sk-test-DO-NOT-LEAK-7f3a9c';
const SQLITE_DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const DEFAULT_PROMPT_VERSION = shortHash(
  `${DEFAULT_SYSTEM_PROMPT}\u0000${DEFAULT_CLASSIFY_PROMPT}\u0000${DEFAULT_REPORT_PROMPT}`,
);

function appEnv(overrides: Partial<Env> = {}): Env {
  return noAiEnv({ SESSION_SECRET: SECRET, ...overrides });
}

/** Env with a complete AI config whose master switch is still off — never calls out. */
function configuredEnv(overrides: Partial<Env> = {}): Env {
  return appEnv({
    AI_BASE_URL: 'https://llm.example.com/v1',
    AI_MODEL: 'env-model',
    AI_API_KEY: FAKE_KEY,
    ...overrides,
  });
}

interface CallOptions {
  as?: string;
  body?: unknown;
  rawBody?: string;
  env?: Env;
  headers?: Record<string, string>;
  cookie?: string;
}

interface CallResult {
  status: number;
  text: string;
  json: Record<string, unknown>;
  cacheControl: string | null;
}

async function call(method: string, path: string, opts: CallOptions = {}): Promise<CallResult> {
  const headers = new Headers(opts.headers ?? {});
  if (opts.cookie !== undefined) {
    headers.set('Cookie', `${SESSION_COOKIE}=${opts.cookie}`);
  } else if (opts.as !== undefined) {
    headers.set('Cookie', `${SESSION_COOKIE}=${await signSession({ sub: opts.as }, SECRET)}`);
  }
  let body: string | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    body = opts.rawBody ?? JSON.stringify(opts.body ?? {});
  }
  const request = new Request(`${ORIGIN}${path}`, { method, headers, body });
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, opts.env ?? appEnv(), ctx);
  await waitOnExecutionContext(ctx);
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Non-JSON body (should not happen for /api/*); leave json empty.
  }
  return { status: response.status, text, json, cacheControl: response.headers.get('Cache-Control') };
}

async function seedAdmin(id = 'admin') {
  return seedUser({ id, admin: true, participant: false });
}

async function countRows(table: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? 0;
}

async function settingsObject(): Promise<Record<string, string>> {
  return Object.fromEntries(await readSettings(env.DB));
}

interface SeedRecord {
  subject: string;
  reporter: string;
  type?: string;
  status?: string;
  delta?: number;
  verdictSource?: string | null;
  appealReason?: string | null;
}

/** Insert a case row directly in the given state; returns its id. */
async function seedRecord(seed: SeedRecord): Promise<number> {
  const result = await env.DB.prepare(
    `INSERT INTO records
       (subject_id, reporter_id, type, delta, claim, status,
        verdict_source, verdict_headline, verdict_reason, verdict_factors, appeal_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      seed.subject,
      seed.reporter,
      seed.type ?? 'no_show',
      seed.delta ?? -15,
      '说好八点五排，等到八点四十还没上线，微信也不回。',
      seed.status ?? 'decided',
      seed.verdictSource === undefined ? 'fallback' : seed.verdictSource,
      'AI 裁判暂时不可用',
      '本次按基准分量刑。',
      '[{"kind":"aggravating","text":"未提前告知"}]',
      seed.appealReason ?? null,
    )
    .run();
  return Number(result.meta.last_row_id);
}

interface SeedVerdict {
  kind?: 'sentence' | 'classify';
  error?: string | null;
  clamped?: number;
  latency?: number | null;
  /** How long ago the row was written; default now. */
  agoMs?: number;
}

function sqliteAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString().replace('T', ' ').slice(0, 19);
}

async function seedVerdict(recordId: number, v: SeedVerdict = {}): Promise<void> {
  const createdAt = sqliteAgo(v.agoMs ?? 0);
  if (v.kind === undefined) {
    // Omit `kind` so the column default ('sentence') applies.
    await env.DB.prepare(
      `INSERT INTO ai_verdicts
         (record_id, provider, model, prompt_version, applied_delta, clamped, latency_ms, error, created_at)
       VALUES (?, 'llm.example.com', 'm', 'v1', -15, ?, ?, ?, ?)`,
    )
      .bind(recordId, v.clamped ?? 0, v.latency ?? null, v.error ?? null, createdAt)
      .run();
    return;
  }
  await env.DB.prepare(
    `INSERT INTO ai_verdicts
       (record_id, kind, provider, model, prompt_version, applied_delta, clamped, latency_ms, error, created_at)
     VALUES (?, ?, 'llm.example.com', 'm', 'v1', -15, ?, ?, ?, ?)`,
  )
    .bind(recordId, v.kind, v.clamped ?? 0, v.latency ?? null, v.error ?? null, createdAt)
    .run();
}

async function verdictFixture(): Promise<number> {
  await seedUser({ id: 'vjudge', judge: true });
  await seedUser({ id: 'vsubject' });
  return seedRecord({ subject: 'vsubject', reporter: 'vjudge' });
}

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

// weekly_reports is not in setup.ts's truncate list; clear it for every test in
// this file so no assertion depends on which tests happened to run before it.
beforeEach(async () => {
  await env.DB.prepare('DELETE FROM weekly_reports').run();
});

// ---------------------------------------------------------------------------

interface RouteCase {
  name: string;
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
}

const ADMIN_ROUTES: RouteCase[] = [
  { name: 'regenerate report', method: 'POST', path: '/api/admin/report/2026-10-19/regenerate' },
  { name: 'update user', method: 'POST', path: '/api/admin/users/target', body: { score: 0 } },
  {
    name: 'override record',
    method: 'POST',
    path: '/api/admin/records/1/override',
    body: { delta: -8, reason: '改判' },
  },
  { name: 'read AI config', method: 'GET', path: '/api/admin/ai-config' },
  {
    name: 'write AI config',
    method: 'POST',
    path: '/api/admin/ai-config',
    body: { model: 'evil-model', enabled: true },
  },
  { name: 'dry-run AI config', method: 'POST', path: '/api/admin/ai-config/test' },
];

describe('admin route guards', () => {
  it.each(ADMIN_ROUTES)('$name: anonymous → 401 未登录', async (route) => {
    await seedUser({ id: 'target', score: 77 });
    const res = await call(route.method, route.path, { body: route.body });
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ error: '未登录' });
  });

  it.each(ADMIN_ROUTES)('$name: logged-in non-admin (even a judge) → 403', async (route) => {
    await seedUser({ id: 'target', score: 77 });
    await seedUser({ id: 'judge', judge: true });
    const res = await call(route.method, route.path, { as: 'judge', body: route.body });
    expect(res.status).toBe(403);
    expect(res.json).toEqual({ error: '需要管理员权限' });
  });

  it('a rejected caller changes nothing', async () => {
    await seedUser({ id: 'target', score: 77 });
    await seedUser({ id: 'judge', judge: true });
    for (const route of ADMIN_ROUTES) {
      await call(route.method, route.path, { as: 'judge', body: route.body });
      await call(route.method, route.path, { body: route.body });
    }
    expect(await countRows('app_settings')).toBe(0);
    expect(await countRows('weekly_reports')).toBe(0);
    expect(await countRows('score_events')).toBe(0);
    expect(await countRows('ai_verdicts')).toBe(0);
    expect(await scoreOf('target')).toBe(77);
  });

  it('a rejected caller cannot override a real, overridable case', async () => {
    // ADMIN_ROUTES points at record 1, which may not exist; aim at a real one too.
    await seedUser({ id: 'judge', judge: true });
    await seedUser({ id: 'subject', score: 85 });
    const id = await seedRecord({ subject: 'subject', reporter: 'judge', status: 'appealed' });
    const path = `/api/admin/records/${id}/override`;
    const body = { delta: -8, reason: '想偷偷改判' };
    expect((await call('POST', path, { body })).status).toBe(401);
    expect((await call('POST', path, { as: 'judge', body })).status).toBe(403);
    expect((await call('POST', path, { as: 'subject', body })).status).toBe(403);
    const row = await env.DB.prepare(
      'SELECT delta, status, verdict_source FROM records WHERE id = ?',
    )
      .bind(id)
      .first();
    expect(row).toEqual({ delta: -15, status: 'appealed', verdict_source: 'fallback' });
    expect(await scoreOf('subject')).toBe(85);
    expect(await scoreEventCount('subject')).toBe(0);
  });

  it('checks auth before validating the body', async () => {
    await seedUser({ id: 'judge', judge: true });
    // Body would be a 400 for an admin — anonymous / non-admin still see 401 / 403.
    const anon = await call('POST', '/api/admin/ai-config', { body: { api_key: 'x' } });
    expect(anon.status).toBe(401);
    const judge = await call('POST', '/api/admin/records/abc/override', { as: 'judge', body: {} });
    expect(judge.status).toBe(403);
    const week = await call('POST', '/api/admin/report/not-a-week/regenerate', { as: 'judge' });
    expect(week.status).toBe(403);
  });

  it('treats a forged, foreign-secret or garbage cookie as anonymous', async () => {
    await seedAdmin();
    const forged = await signSession({ sub: 'admin' }, 'some-other-secret');
    expect((await call('GET', '/api/admin/ai-config', { cookie: forged })).status).toBe(401);
    expect((await call('GET', '/api/admin/ai-config', { cookie: 'not.a.jwt' })).status).toBe(401);
    expect((await call('GET', '/api/admin/ai-config', { cookie: '' })).status).toBe(401);
  });

  it('treats a valid session for a user that no longer exists as anonymous', async () => {
    const res = await call('GET', '/api/admin/ai-config', { as: 'ghost-admin' });
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ error: '未登录' });
  });

  it('re-reads is_admin from the database on every request', async () => {
    await seedAdmin();
    expect((await call('GET', '/api/admin/ai-config', { as: 'admin' })).status).toBe(200);
    await env.DB.prepare('UPDATE users SET is_admin = 0 WHERE id = ?').bind('admin').run();
    const res = await call('GET', '/api/admin/ai-config', { as: 'admin' });
    expect(res.status).toBe(403);
    expect(res.json).toEqual({ error: '需要管理员权限' });
  });

  it('answers an unknown admin path with a JSON 404, even anonymously', async () => {
    const res = await call('GET', '/api/admin/nope');
    expect(res.status).toBe(404);
    expect(res.json).toEqual({ error: 'Not found' });
  });

  it('refuses a cross-origin form post to an admin route (CSRF) and writes nothing', async () => {
    await seedAdmin();
    const res = await call('POST', '/api/admin/ai-config', {
      as: 'admin',
      rawBody: 'model=evil',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'https://evil.example',
      },
    });
    expect(res.status).toBe(403);
    expect(res.json).toEqual({ error: '请求来源不被允许' });
    expect(await countRows('app_settings')).toBe(0);
  });

  it('refuses admin writes in maintenance mode (before auth) but still serves reads', async () => {
    await seedAdmin();
    const ro = appEnv({ READ_ONLY: '1' });
    const write = await call('POST', '/api/admin/ai-config', {
      as: 'admin',
      body: { model: 'x' },
      env: ro,
    });
    expect(write.status).toBe(503);
    expect(write.json).toEqual({ error: '系统维护中（只读），请稍后再试' });
    // The maintenance gate sits in front of the auth check.
    const anon = await call('POST', '/api/admin/ai-config', { body: { model: 'x' }, env: ro });
    expect(anon.status).toBe(503);
    expect(await countRows('app_settings')).toBe(0);

    const read = await call('GET', '/api/admin/ai-config', { as: 'admin', env: ro });
    expect(read.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------

describe('GET /api/admin/ai-config — configuration', () => {
  it('returns the exact default shape on a fresh install with AI off', async () => {
    await seedAdmin();
    const res = await call('GET', '/api/admin/ai-config', { as: 'admin' });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      enabled: false,
      configured_enabled: false,
      api_key_source: 'none',
      can_update_api_key: false,
      base_url: '',
      model: '',
      temperature: 0.2,
      prompt: DEFAULT_SYSTEM_PROMPT,
      classify_prompt: DEFAULT_CLASSIFY_PROMPT,
      report_prompt: DEFAULT_REPORT_PROMPT,
      prompt_version: DEFAULT_PROMPT_VERSION,
      has_api_key: false,
      disabled_reason: '未配置 AI 端点，请在管理页设置',
      recent: { total: 0, fallbackRate: 0, clampRate: 0, avgLatencyMs: 0 },
    });
  });

  it('reports whether a key exists but never echoes the key itself', async () => {
    await seedAdmin();
    const res = await call('GET', '/api/admin/ai-config', { as: 'admin', env: configuredEnv() });
    expect(res.status).toBe(200);
    expect(res.json.has_api_key).toBe(true);
    expect(res.text).not.toContain(FAKE_KEY);
    expect(res.text).not.toContain('DO-NOT-LEAK');
    expect(Object.keys(res.json)).not.toContain('api_key');
    expect(Object.keys(res.json)).not.toContain('apiKey');
    expect(Object.keys(res.json).sort()).toEqual(
      [
        'configured_enabled',
        'api_key_source',
        'can_update_api_key',
        'base_url',
        'classify_prompt',
        'disabled_reason',
        'enabled',
        'has_api_key',
        'model',
        'prompt',
        'prompt_version',
        'recent',
        'report_prompt',
        'temperature',
      ].sort(),
    );
  });

  it('an empty AI_API_KEY counts as no key', async () => {
    await seedAdmin();
    const res = await call('GET', '/api/admin/ai-config', {
      as: 'admin',
      env: configuredEnv({ AI_API_KEY: '' }),
    });
    expect(res.json.has_api_key).toBe(false);
    expect(res.json.enabled).toBe(false);
  });

  it.each([
    [{ AI_BASE_URL: undefined }, '未配置 AI 端点，请在管理页设置'],
    [{ AI_MODEL: undefined }, '未配置 AI 模型，请在管理页设置'],
    [
      { AI_API_KEY: undefined },
      '未配置 AI API Key，请在管理页设置',
    ],
    [{}, 'AI 裁决已被手动关闭'],
    [{ AI_ENABLED: 'true' }, null],
  ] as Array<[Partial<Env>, string | null]>)(
    'disabled_reason for env %j is %j',
    async (overrides, reason) => {
      await seedAdmin();
      const res = await call('GET', '/api/admin/ai-config', {
        as: 'admin',
        env: configuredEnv(overrides),
      });
      expect(res.status).toBe(200);
      expect(res.json.disabled_reason).toBe(reason);
      expect(res.json.enabled).toBe(reason === null);
    },
  );

  it('surfaces env defaults and lets app_settings rows override them', async () => {
    await seedAdmin();
    const envWithDefaults = configuredEnv({
      AI_TEMPERATURE: '0.9',
      AI_SYSTEM_PROMPT: 'env sentencing prompt',
    });
    let res = await call('GET', '/api/admin/ai-config', { as: 'admin', env: envWithDefaults });
    expect(res.json).toMatchObject({
      base_url: 'https://llm.example.com/v1',
      model: 'env-model',
      temperature: 0.9,
      prompt: 'env sentencing prompt',
      // The classify/report prompts have no env override.
      classify_prompt: DEFAULT_CLASSIFY_PROMPT,
      report_prompt: DEFAULT_REPORT_PROMPT,
    });

    const write = await call('POST', '/api/admin/ai-config', {
      as: 'admin',
      env: envWithDefaults,
      body: { model: 'db-model', temperature: 1.5, prompt: 'db sentencing prompt' },
    });
    expect(write.status).toBe(200);

    res = await call('GET', '/api/admin/ai-config', { as: 'admin', env: envWithDefaults });
    expect(res.json).toMatchObject({
      base_url: 'https://llm.example.com/v1',
      model: 'db-model',
      temperature: 1.5,
      prompt: 'db sentencing prompt',
      prompt_version: shortHash(
        `db sentencing prompt\u0000${DEFAULT_CLASSIFY_PROMPT}\u0000${DEFAULT_REPORT_PROMPT}`,
      ),
    });
  });

  it('clamps an out-of-range env temperature and ignores a non-numeric one', async () => {
    await seedAdmin();
    let res = await call('GET', '/api/admin/ai-config', {
      as: 'admin',
      env: appEnv({ AI_TEMPERATURE: '5' }),
    });
    expect(res.json.temperature).toBe(2);
    res = await call('GET', '/api/admin/ai-config', {
      as: 'admin',
      env: appEnv({ AI_TEMPERATURE: 'warm' }),
    });
    expect(res.json.temperature).toBe(0.2);
  });

  it('a stored ai.enabled=false beats AI_ENABLED=true in env', async () => {
    await seedAdmin();
    const on = configuredEnv({ AI_ENABLED: 'true' });
    await call('POST', '/api/admin/ai-config', { as: 'admin', env: on, body: { enabled: false } });
    const res = await call('GET', '/api/admin/ai-config', { as: 'admin', env: on });
    expect(res.json.enabled).toBe(false);
    expect(res.json.disabled_reason).toBe('AI 裁决已被手动关闭');
  });
});

describe('GET /api/admin/ai-config — recent statistics', () => {
  it('computes counts, rates and mean latency over the last 7 days of sentence calls', async () => {
    await seedAdmin();
    const rid = await verdictFixture();
    // In the window, kind = sentence:
    await seedVerdict(rid, { kind: 'sentence', latency: 100 });
    await seedVerdict(rid, { kind: 'sentence', error: 'timeout', latency: 300 });
    await seedVerdict(rid, { kind: 'sentence', clamped: 1, latency: 200 });
    await seedVerdict(rid, { kind: 'sentence', clamped: 1, latency: null }); // AVG skips NULL
    await seedVerdict(rid, { error: 'bad json', latency: 403, agoMs: 6 * DAY_MS }); // default kind
    // Out of scope:
    await seedVerdict(rid, { kind: 'classify', error: 'x', clamped: 1, latency: 9000 });
    await seedVerdict(rid, { kind: 'sentence', error: 'old', clamped: 1, latency: 9000, agoMs: 8 * DAY_MS });

    const res = await call('GET', '/api/admin/ai-config', { as: 'admin' });
    expect(res.status).toBe(200);
    // 5 rows; fallbacks: timeout + bad json; clamps: 2; latency (100+300+200+403)/4 = 250.75.
    expect(res.json.recent).toEqual({
      total: 5,
      fallbackRate: 2 / 5,
      clampRate: 2 / 5,
      avgLatencyMs: 251,
    });
  });

  it('returns plain numbers, not strings (COUNT/SUM/AVG types)', async () => {
    await seedAdmin();
    const rid = await verdictFixture();
    await seedVerdict(rid, { kind: 'sentence', error: 'e', clamped: 1, latency: 10 });
    const res = await call('GET', '/api/admin/ai-config', { as: 'admin' });
    const recent = res.json.recent as Record<string, unknown>;
    expect(recent).toEqual({ total: 1, fallbackRate: 1, clampRate: 1, avgLatencyMs: 10 });
    for (const value of Object.values(recent)) expect(typeof value).toBe('number');
  });

  it('treats the 7-day window boundary by created_at, minute-accurate', async () => {
    await seedAdmin();
    const rid = await verdictFixture();
    await seedVerdict(rid, { kind: 'sentence', latency: 50, agoMs: 7 * DAY_MS - 2 * MINUTE_MS });
    await seedVerdict(rid, { kind: 'sentence', latency: 999, agoMs: 7 * DAY_MS + 2 * MINUTE_MS });
    const res = await call('GET', '/api/admin/ai-config', { as: 'admin' });
    expect(res.json.recent).toEqual({ total: 1, fallbackRate: 0, clampRate: 0, avgLatencyMs: 50 });
  });

  it('is all zeros when only classify calls (or only old calls) exist', async () => {
    await seedAdmin();
    const rid = await verdictFixture();
    await seedVerdict(rid, { kind: 'classify', error: 'x', clamped: 1, latency: 700 });
    await seedVerdict(rid, { kind: 'sentence', error: 'x', clamped: 1, latency: 700, agoMs: 30 * DAY_MS });
    const res = await call('GET', '/api/admin/ai-config', { as: 'admin' });
    expect(res.json.recent).toEqual({ total: 0, fallbackRate: 0, clampRate: 0, avgLatencyMs: 0 });
  });

  it('reports 0 ms when every row in the window lacks a latency', async () => {
    await seedAdmin();
    const rid = await verdictFixture();
    await seedVerdict(rid, { kind: 'sentence', latency: null });
    await seedVerdict(rid, { kind: 'sentence', latency: null, error: 'e' });
    const res = await call('GET', '/api/admin/ai-config', { as: 'admin' });
    expect(res.json.recent).toEqual({ total: 2, fallbackRate: 0.5, clampRate: 0, avgLatencyMs: 0 });
  });

  it('rounds the mean latency half-up', async () => {
    await seedAdmin();
    const rid = await verdictFixture();
    await seedVerdict(rid, { kind: 'sentence', latency: 1 });
    await seedVerdict(rid, { kind: 'sentence', latency: 2 }); // mean 1.5 → 2
    const res = await call('GET', '/api/admin/ai-config', { as: 'admin' });
    expect((res.json.recent as Record<string, number>).avgLatencyMs).toBe(2);
  });

  it('counts the audit row a real (AI-off) verdict writes as a fallback', async () => {
    await seedAdmin();
    const { fileCase, submitStatement } = await import('../../worker/cases');
    const judge = await seedUser({ id: 'judge', judge: true });
    const subject = await seedUser({ id: 'subject' });
    const filed = await fileCase(
      env.DB,
      judge,
      {
        subject_id: subject.id,
        type: 'no_show',
        claim: '说好八点五排，等到八点四十还没上线，微信也不回，最后四缺一散了。',
      },
      { offsetHours: 8 },
      noAiEnv(),
    );
    await submitStatement(env.DB, subject, filed.id, '公司临时加班', noAiEnv());

    const res = await call('GET', '/api/admin/ai-config', { as: 'admin' });
    expect(res.json.recent).toEqual({ total: 1, fallbackRate: 1, clampRate: 0, avgLatencyMs: 0 });
  });
});

// ---------------------------------------------------------------------------

describe('POST /api/admin/ai-config — persistence', () => {
  it('normalises and stores every field, then reads them back', async () => {
    await seedAdmin();
    const res = await call('POST', '/api/admin/ai-config', {
      as: 'admin',
      body: {
        enabled: true,
        base_url: '  https://api.example.com/v1///  ',
        model: '  gpt-x  ',
        temperature: 0.7,
        prompt: 'P1',
        classify_prompt: 'C1',
        report_prompt: 'R1',
      },
    });
    expect(res.status).toBe(200);
    // No AI_API_KEY in this env → still disabled even though the switch is on.
    expect(res.json).toEqual({
      ok: true,
      enabled: false,
      prompt_version: shortHash('P1\u0000C1\u0000R1'),
    });

    expect(await settingsObject()).toEqual({
      'ai.enabled': 'true',
      'ai.base_url': 'https://api.example.com/v1',
      'ai.model': 'gpt-x',
      'ai.temperature': '0.7',
      'ai.prompt': 'P1',
      'ai.classify_prompt': 'C1',
      'ai.report_prompt': 'R1',
    });

    const rows = await env.DB.prepare(
      'SELECT key, updated_by, updated_at FROM app_settings ORDER BY key',
    ).all<{ key: string; updated_by: string; updated_at: string }>();
    expect(rows.results).toHaveLength(7);
    for (const row of rows.results) {
      expect(row.updated_by).toBe('admin');
      expect(row.updated_at).toMatch(SQLITE_DATETIME);
    }

    const read = await call('GET', '/api/admin/ai-config', { as: 'admin' });
    expect(read.json).toMatchObject({
      enabled: false,
      base_url: 'https://api.example.com/v1',
      model: 'gpt-x',
      temperature: 0.7,
      prompt: 'P1',
      classify_prompt: 'C1',
      report_prompt: 'R1',
      prompt_version: shortHash('P1\u0000C1\u0000R1'),
      disabled_reason: '未配置 AI API Key，请在管理页设置',
    });
  });

  it('reports enabled=true once the stored config is complete and a key exists', async () => {
    await seedAdmin();
    const res = await call('POST', '/api/admin/ai-config', {
      as: 'admin',
      env: appEnv({ AI_API_KEY: FAKE_KEY }),
      body: { enabled: true, base_url: 'https://api.example.com/v1', model: 'm' },
    });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, enabled: true, prompt_version: DEFAULT_PROMPT_VERSION });
    expect(res.text).not.toContain(FAKE_KEY);
  });

  it('stores enabled=false as the string "false"', async () => {
    await seedAdmin();
    await call('POST', '/api/admin/ai-config', { as: 'admin', body: { enabled: false } });
    expect(await settingsObject()).toEqual({ 'ai.enabled': 'false' });
  });

  it('upserts: a second write replaces the value and the author, one row per key', async () => {
    await seedAdmin('admin');
    await seedAdmin('admin2');
    await call('POST', '/api/admin/ai-config', {
      as: 'admin',
      body: { model: 'first', prompt: 'keep me' },
    });
    await call('POST', '/api/admin/ai-config', { as: 'admin2', body: { model: 'second' } });

    const rows = await env.DB.prepare(
      'SELECT key, value, updated_by FROM app_settings ORDER BY key',
    ).all<{ key: string; value: string; updated_by: string }>();
    expect(rows.results).toEqual([
      { key: 'ai.model', value: 'second', updated_by: 'admin2' },
      { key: 'ai.prompt', value: 'keep me', updated_by: 'admin' },
    ]);
  });

  it('an empty body is a no-op that still reports the effective config', async () => {
    await seedAdmin();
    const res = await call('POST', '/api/admin/ai-config', { as: 'admin', body: {} });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, enabled: false, prompt_version: DEFAULT_PROMPT_VERSION });
    expect(await countRows('app_settings')).toBe(0);
  });

  it('a body that is not JSON is treated as empty (no-op, 200)', async () => {
    await seedAdmin();
    const res = await call('POST', '/api/admin/ai-config', { as: 'admin', rawBody: '{not json' });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, enabled: false, prompt_version: DEFAULT_PROMPT_VERSION });
    expect(await countRows('app_settings')).toBe(0);
  });

  it('accepts the temperature bounds 0 and 2 inclusive', async () => {
    await seedAdmin();
    expect(
      (await call('POST', '/api/admin/ai-config', { as: 'admin', body: { temperature: 0 } })).status,
    ).toBe(200);
    expect((await settingsObject())['ai.temperature']).toBe('0');
    // A stored '0' is a real value, not "unset" — it must not fall back to 0.2.
    const zero = await call('GET', '/api/admin/ai-config', {
      as: 'admin',
      env: appEnv({ AI_TEMPERATURE: '1.1' }),
    });
    expect(zero.json.temperature).toBe(0);
    expect(
      (await call('POST', '/api/admin/ai-config', { as: 'admin', body: { temperature: 2 } })).status,
    ).toBe(200);
    expect((await settingsObject())['ai.temperature']).toBe('2');
    const read = await call('GET', '/api/admin/ai-config', { as: 'admin' });
    expect(read.json.temperature).toBe(2);
  });

  it('allows plain http only for localhost, and strips trailing slashes', async () => {
    await seedAdmin();
    const res = await call('POST', '/api/admin/ai-config', {
      as: 'admin',
      body: { base_url: 'http://localhost:11434/v1/' },
    });
    expect(res.status).toBe(200);
    expect((await settingsObject())['ai.base_url']).toBe('http://localhost:11434/v1');
  });

  it('stores prompts verbatim (untrimmed) up to exactly 8000 characters', async () => {
    await seedAdmin();
    const padded = '  判得狠一点  ';
    const longest = '字'.repeat(8000);
    const res = await call('POST', '/api/admin/ai-config', {
      as: 'admin',
      body: { prompt: padded, report_prompt: longest },
    });
    expect(res.status).toBe(200);
    const settings = await settingsObject();
    expect(settings['ai.prompt']).toBe(padded);
    expect(settings['ai.report_prompt']).toHaveLength(8000);
  });

  it('changes prompt_version whenever any one of the three prompts changes', async () => {
    await seedAdmin();
    const versions = new Set<string>();
    versions.add(
      String((await call('POST', '/api/admin/ai-config', { as: 'admin', body: {} })).json.prompt_version),
    );
    for (const field of ['prompt', 'classify_prompt', 'report_prompt']) {
      const res = await call('POST', '/api/admin/ai-config', {
        as: 'admin',
        body: { [field]: `new ${field}` },
      });
      versions.add(String(res.json.prompt_version));
    }
    expect(versions.size).toBe(4);
  });
});

describe('POST /api/admin/ai-config — validation', () => {
  const KEY_MSG = 'api_key 必须是 1–4096 字符且不含 NUL、回车或换行';
  const HTTPS_MSG = 'base_url 必须是 https（本地调试可用 localhost）';
  const TEMP_MSG = 'temperature 需在 0–2 之间';

  it.each([
    ['api_key empty', { api_key: '' }, KEY_MSG],
    ['enabled as string', { enabled: 'true' }, 'enabled 必须是布尔值'],
    ['enabled as 1', { enabled: 1 }, 'enabled 必须是布尔值'],
    ['enabled null', { enabled: null }, 'enabled 必须是布尔值'],
    ['base_url number', { base_url: 123 }, '缺少 base_url'],
    ['base_url blank', { base_url: '   ' }, '缺少 base_url'],
    ['base_url garbage', { base_url: 'not a url' }, 'base_url 不是合法的 URL'],
    ['base_url plain http', { base_url: 'http://api.example.com/v1' }, HTTPS_MSG],
    ['base_url http loopback IP', { base_url: 'http://127.0.0.1:8080/v1' }, HTTPS_MSG],
    ['model empty', { model: '' }, '缺少 model'],
    ['model blank', { model: '   ' }, '缺少 model'],
    ['model number', { model: 42 }, '缺少 model'],
    ['model null', { model: null }, '缺少 model'],
    ['temperature string', { temperature: '0.5' }, TEMP_MSG],
    ['temperature below 0', { temperature: -0.01 }, TEMP_MSG],
    ['temperature above 2', { temperature: 2.01 }, TEMP_MSG],
    ['temperature null', { temperature: null }, TEMP_MSG],
    ['prompt blank', { prompt: '   ' }, '缺少 prompt'],
    ['classify_prompt number', { classify_prompt: 5 }, '缺少 classify_prompt'],
    ['report_prompt null', { report_prompt: null }, '缺少 report_prompt'],
    ['prompt over 8000', { prompt: 'x'.repeat(8001) }, '提示词最多 8000 字'],
    ['classify_prompt over 8000', { classify_prompt: 'x'.repeat(8001) }, '提示词最多 8000 字'],
    ['report_prompt over 8000', { report_prompt: 'x'.repeat(8001) }, '提示词最多 8000 字'],
  ] as Array<[string, Record<string, unknown>, string]>)(
    'rejects %s with 400 and writes nothing',
    async (_label, body, message) => {
      await seedAdmin();
      const res = await call('POST', '/api/admin/ai-config', { as: 'admin', body });
      expect(res.status).toBe(400);
      expect(res.json).toEqual({ error: message });
      expect(await countRows('app_settings')).toBe(0);
    },
  );

  it('a rejected write leaves previously stored settings untouched', async () => {
    await seedAdmin();
    await call('POST', '/api/admin/ai-config', { as: 'admin', body: { model: 'good' } });
    const bad = await call('POST', '/api/admin/ai-config', {
      as: 'admin',
      body: { model: 'bad', api_key: '' },
    });
    expect(bad.status).toBe(400);
    expect(await settingsObject()).toEqual({ 'ai.model': 'good' });
  });



  it.todo(
    'BUG (minor): the https rule is skipped for any scheme on localhost, so ftp://localhost/x ' +
      'is accepted and stored as ai.base_url (worker/routes-admin.ts:133)',
  );
});

// ---------------------------------------------------------------------------

describe('POST /api/admin/records/:id/override', () => {
  async function decidedCase(opts: { score?: number; delta?: number; status?: string } = {}) {
    await seedAdmin();
    await seedUser({ id: 'judge', judge: true });
    await seedUser({ id: 'subject', score: opts.score ?? 85 });
    const id = await seedRecord({
      subject: 'subject',
      reporter: 'judge',
      type: 'no_show',
      delta: opts.delta ?? -15,
      status: opts.status ?? 'decided',
    });
    return id;
  }

  async function eventsFor(userId: string) {
    const rows = await env.DB.prepare(
      'SELECT delta, reason, resulting_score, created_at FROM score_events WHERE user_id = ? ORDER BY id',
    )
      .bind(userId)
      .all<{ delta: number; reason: string; resulting_score: number; created_at: string }>();
    return rows.results;
  }

  it('re-sentences a decided case, moves the score by the difference and logs it', async () => {
    const id = await decidedCase();
    const res = await call('POST', `/api/admin/records/${id}/override`, {
      as: 'admin',
      body: { delta: -9, reason: '  申诉属实，情有可原  ' },
    });
    expect(res.status).toBe(200);
    const record = res.json.record as Record<string, unknown>;
    // Exact shape: a port must keep escalation_suggested a boolean (not 0/1),
    // classified_by defaulting to 'human', nulls as null and created_at's format.
    expect(record).toEqual({
      id,
      type: 'no_show',
      status: 'decided',
      delta: -9,
      subject: { id: 'subject', username: 'subject', avatar_url: null },
      reporter: { id: 'judge', username: 'judge', avatar_url: null },
      note: null,
      claim: '说好八点五排，等到八点四十还没上线，微信也不回。',
      claim_summary: null,
      classified_by: 'human',
      escalation_suggested: false,
      session_id: null,
      statement: null,
      statement_at: null,
      appeal_reason: null,
      deadline_at: null,
      verdict: {
        source: 'admin_override',
        headline: '管理员改判',
        reasoning: '申诉属实，情有可原',
        factors: [],
      },
      range: {
        min: VIOLATION_MAP.no_show.min,
        max: VIOLATION_MAP.no_show.max,
        base: VIOLATION_MAP.no_show.base,
      },
      created_at: expect.stringMatching(SQLITE_DATETIME),
      redacted: false,
    });

    expect(await scoreOf('subject')).toBe(91);
    const events = await eventsFor('subject');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ delta: 6, reason: `override:${id}`, resulting_score: 91 });
    expect(events[0].created_at).toMatch(SQLITE_DATETIME);

    const raw = await env.DB.prepare(
      'SELECT delta, status, verdict_source, verdict_headline, verdict_reason, verdict_factors FROM records WHERE id = ?',
    )
      .bind(id)
      .first();
    expect(raw).toEqual({
      delta: -9,
      status: 'decided',
      verdict_source: 'admin_override',
      verdict_headline: '管理员改判',
      verdict_reason: '申诉属实，情有可原',
      verdict_factors: '[]',
    });
  });

  it('closes an appeal (appealed → decided) and keeps the appeal reason on record', async () => {
    await seedAdmin();
    await seedUser({ id: 'judge', judge: true });
    await seedUser({ id: 'subject', score: 85 });
    const id = await seedRecord({
      subject: 'subject',
      reporter: 'judge',
      status: 'appealed',
      appealReason: '那天在医院',
    });
    const res = await call('POST', `/api/admin/records/${id}/override`, {
      as: 'admin',
      body: { delta: -8, reason: '有病历' },
    });
    expect(res.status).toBe(200);
    expect(res.json.record).toMatchObject({
      status: 'decided',
      delta: -8,
      appeal_reason: '那天在医院',
    });
    expect(await statusOf(id)).toBe('decided');
    expect(await scoreOf('subject')).toBe(92);
  });

  it.each([
    [999, VIOLATION_MAP.no_show.max, 92],
    [-999, VIOLATION_MAP.no_show.min, 80],
    [0, VIOLATION_MAP.no_show.max, 92],
    [-9.6, -10, 90],
    [-9.5, -9, 91], // Math.round: halves go toward +∞
  ])('clamps / rounds a requested delta of %d to %d', async (requested, applied, score) => {
    const id = await decidedCase();
    const res = await call('POST', `/api/admin/records/${id}/override`, {
      as: 'admin',
      body: { delta: requested, reason: '复核' },
    });
    expect(res.status).toBe(200);
    expect((res.json.record as Record<string, unknown>).delta).toBe(applied);
    expect(await scoreOf('subject')).toBe(score);
  });

  it('records the points actually applied when the 100 ceiling eats part of a reduction', async () => {
    // Subject has healed back to 98 since the -15 verdict; asking for -8 would need +7.
    const id = await decidedCase({ score: 98 });
    const res = await call('POST', `/api/admin/records/${id}/override`, {
      as: 'admin',
      body: { delta: -8, reason: '从轻' },
    });
    expect(res.status).toBe(200);
    expect((res.json.record as Record<string, unknown>).delta).toBe(-13);
    expect(await scoreOf('subject')).toBe(100);
    const events = await eventsFor('subject');
    expect(events).toEqual([
      expect.objectContaining({ delta: 2, reason: `override:${id}`, resulting_score: 100 }),
    ]);
  });

  it('respects the 0 floor when making a sentence harsher', async () => {
    const id = await decidedCase({ score: 3 });
    const res = await call('POST', `/api/admin/records/${id}/override`, {
      as: 'admin',
      body: { delta: -20, reason: '从重' },
    });
    expect(res.status).toBe(200);
    expect((res.json.record as Record<string, unknown>).delta).toBe(-18);
    expect(await scoreOf('subject')).toBe(0);
    expect(await eventsFor('subject')).toEqual([
      expect.objectContaining({ delta: -3, reason: `override:${id}`, resulting_score: 0 }),
    ]);
  });

  it('reports a stored escalation_suggested=1 as boolean true', async () => {
    const id = await decidedCase();
    await env.DB.prepare('UPDATE records SET escalation_suggested = 1 WHERE id = ?').bind(id).run();
    const res = await call('POST', `/api/admin/records/${id}/override`, {
      as: 'admin',
      body: { delta: -9, reason: '复核' },
    });
    expect(res.status).toBe(200);
    expect((res.json.record as Record<string, unknown>).escalation_suggested).toBe(true);
  });

  it('an override to the same delta still logs a zero-point event', async () => {
    const id = await decidedCase();
    const res = await call('POST', `/api/admin/records/${id}/override`, {
      as: 'admin',
      body: { delta: -15, reason: '维持原判' },
    });
    expect(res.status).toBe(200);
    expect(await scoreOf('subject')).toBe(85);
    expect(await eventsFor('subject')).toEqual([
      expect.objectContaining({ delta: 0, reason: `override:${id}`, resulting_score: 85 }),
    ]);
  });

  it('can be applied again; each call moves relative to the current delta', async () => {
    const id = await decidedCase();
    await call('POST', `/api/admin/records/${id}/override`, {
      as: 'admin',
      body: { delta: -9, reason: '一改' },
    });
    const res = await call('POST', `/api/admin/records/${id}/override`, {
      as: 'admin',
      body: { delta: -12, reason: '二改' },
    });
    expect(res.status).toBe(200);
    expect(res.json.record).toMatchObject({ delta: -12, verdict: { reasoning: '二改' } });
    expect(await scoreOf('subject')).toBe(88);
    const events = await eventsFor('subject');
    expect(events.map((e) => [e.delta, e.reason, e.resulting_score])).toEqual([
      [6, `override:${id}`, 91],
      [-3, `override:${id}`, 88],
    ]);
  });

  it('cannot turn a bonus into a penalty', async () => {
    await seedAdmin();
    await seedUser({ id: 'judge', judge: true });
    await seedUser({ id: 'subject', score: 90 });
    const id = await seedRecord({
      subject: 'subject',
      reporter: 'judge',
      type: 'on_time_bonus',
      delta: 2,
      verdictSource: 'manual',
    });
    const res = await call('POST', `/api/admin/records/${id}/override`, {
      as: 'admin',
      body: { delta: -10, reason: '想扣分' },
    });
    expect(res.status).toBe(200);
    expect(res.json.record).toMatchObject({
      delta: 2,
      status: 'decided',
      verdict: { source: 'admin_override', reasoning: '想扣分' },
    });
    expect(await scoreOf('subject')).toBe(90);
    expect(await eventsFor('subject')).toEqual([
      expect.objectContaining({ delta: 0, reason: `override:${id}`, resulting_score: 90 }),
    ]);
  });

  it('truncates a very long reason to 1000 characters', async () => {
    const id = await decidedCase();
    const res = await call('POST', `/api/admin/records/${id}/override`, {
      as: 'admin',
      body: { delta: -9, reason: '理'.repeat(1500) },
    });
    expect(res.status).toBe(200);
    const verdict = (res.json.record as { verdict: { reasoning: string } }).verdict;
    expect(verdict.reasoning).toHaveLength(1000);
  });

  it.each([
    ['delta missing', { reason: '复核' }, '缺少 delta'],
    ['delta as a string', { delta: '-9', reason: '复核' }, '缺少 delta'],
    ['delta null', { delta: null, reason: '复核' }, '缺少 delta'],
    ['reason missing', { delta: -9 }, '缺少 reason'],
    ['reason blank', { delta: -9, reason: '   ' }, '缺少 reason'],
    ['reason a number', { delta: -9, reason: 5 }, '缺少 reason'],
  ] as Array<[string, Record<string, unknown>, string]>)(
    'rejects %s with 400 and moves nothing',
    async (_label, body, message) => {
      const id = await decidedCase();
      const res = await call('POST', `/api/admin/records/${id}/override`, { as: 'admin', body });
      expect(res.status).toBe(400);
      expect(res.json).toEqual({ error: message });
      expect(await scoreOf('subject')).toBe(85);
      expect(await scoreEventCount('subject')).toBe(0);
    },
  );

  it.each(['abc', '0', '-3', '1.5'])('rejects record id %j with 400', async (raw) => {
    await seedAdmin();
    const res = await call('POST', `/api/admin/records/${raw}/override`, {
      as: 'admin',
      body: { delta: -9, reason: '复核' },
    });
    expect(res.status).toBe(400);
    expect(res.json).toEqual({ error: '无效的记录 ID' });
  });

  it('validates delta before the record id', async () => {
    await seedAdmin();
    const res = await call('POST', '/api/admin/records/abc/override', {
      as: 'admin',
      body: { reason: '复核' },
    });
    expect(res.status).toBe(400);
    expect(res.json).toEqual({ error: '缺少 delta' });
  });

  it('answers 404 for a record that does not exist', async () => {
    await seedAdmin();
    const res = await call('POST', '/api/admin/records/999999/override', {
      as: 'admin',
      body: { delta: -9, reason: '复核' },
    });
    expect(res.status).toBe(404);
    expect(res.json).toEqual({ error: '记录不存在' });
  });

  it.each(['awaiting_statement', 'judging', 'revoked', 'withdrawn'])(
    'refuses to override a %s case and leaves it untouched',
    async (status) => {
      const id = await decidedCase({ status, delta: status === 'revoked' ? 0 : -15 });
      const res = await call('POST', `/api/admin/records/${id}/override`, {
        as: 'admin',
        body: { delta: -9, reason: '复核' },
      });
      expect(res.status).toBe(400);
      expect(res.json).toEqual({ error: '只有已判决 / 申诉中的案件可以改判' });
      expect(await statusOf(id)).toBe(status);
      expect(await scoreOf('subject')).toBe(85);
      expect(await scoreEventCount('subject')).toBe(0);
    },
  );
});

// ---------------------------------------------------------------------------

describe('POST /api/admin/report/:week/regenerate', () => {
  it.each(['latest', 'last-week', '2026-1-5', '20261019', '2026-10-19x', '26-10-19'])(
    'rejects week %j with 400 and writes nothing',
    async (week) => {
      await seedAdmin();
      const res = await call('POST', `/api/admin/report/${week}/regenerate`, { as: 'admin' });
      expect(res.status).toBe(400);
      expect(res.json).toEqual({ error: '周起始日格式应为 YYYY-MM-DD' });
      expect(await countRows('weekly_reports')).toBe(0);
    },
  );

  it('builds a fallback report for an empty week (AI off) and returns it', async () => {
    await seedAdmin();
    const res = await call('POST', '/api/admin/report/2026-10-19/regenerate', { as: 'admin' });
    expect(res.status).toBe(200);
    // Exact: every count must come back a number (a PG COUNT would be a string).
    expect(res.json.report).toEqual({
      week_start: '2026-10-19',
      source: 'fallback',
      narrative: '没有人被记一笔，大家都挺靠谱。',
      stats: {
        basis: 'verdict',
        weekStart: '2026-10-19',
        weekEnd: '2026-10-25',
        casesFiled: 0,
        totalPenalty: 0,
        absentVerdicts: 0,
        star: null,
        pigeon: null,
        bestTalker: null,
        harshest: null,
      },
      created_at: expect.stringMatching(SQLITE_DATETIME),
    });
    expect(await countRows('weekly_reports')).toBe(1);
  });

  it('upserts per week: a re-run recomputes stats and overwrites every column of the one row', async () => {
    await seedAdmin();
    await env.DB.prepare(
      `INSERT INTO weekly_reports (week_start, stats_json, narrative, source, created_at)
       VALUES ('2026-10-19', '{}', '旧的 AI 文案', 'ai', '2026-10-20 00:00:00')`,
    ).run();
    const first = await call('POST', '/api/admin/report/2026-10-19/regenerate', { as: 'admin' });
    expect(first.status).toBe(200);
    expect(first.json.report).toMatchObject({
      source: 'fallback',
      narrative: '没有人被记一笔，大家都挺靠谱。',
      stats: { casesFiled: 0 },
    });
    expect((first.json.report as { created_at: string }).created_at).not.toBe('2026-10-20 00:00:00');

    // New activity inside the week (local Monday 2026-10-19 = 2026-10-18 16:00 UTC).
    await seedUser({ id: 'judge', judge: true });
    await seedUser({ id: 'subject', score: 85 });
    const rid = await seedRecord({ subject: 'subject', reporter: 'judge' });
    await env.DB.prepare("UPDATE records SET created_at = '2026-10-20 12:00:00' WHERE id = ?")
      .bind(rid)
      .run();

    const second = await call('POST', '/api/admin/report/2026-10-19/regenerate', { as: 'admin' });
    expect(second.status).toBe(200);
    const report = second.json.report as { stats: Record<string, unknown>; created_at: string };
    expect(report).toMatchObject({
      week_start: '2026-10-19',
      source: 'fallback',
      narrative: '一共立案 1 起，合计扣了 15 分。有 1 起是缺席判决。',
      stats: {
        casesFiled: 1,
        totalPenalty: -15,
        absentVerdicts: 1,
        harshest: { name: 'subject', delta: -15 },
        bestTalker: null,
      },
    });

    expect(await countRows('weekly_reports')).toBe(1);
    const row = await env.DB.prepare(
      "SELECT stats_json, narrative, source, created_at FROM weekly_reports WHERE week_start = '2026-10-19'",
    ).first<{ stats_json: string; narrative: string; source: string; created_at: string }>();
    expect(JSON.parse(row?.stats_json ?? 'null')).toEqual(report.stats);
    expect(row?.narrative).toBe('一共立案 1 起，合计扣了 15 分。有 1 起是缺席判决。');
    expect(row?.source).toBe('fallback');
    expect(row?.created_at).toBe(report.created_at);

    // The public read serves exactly what the admin route returned.
    const latest = await call('GET', '/api/report/latest');
    expect(latest.status).toBe(200);
    expect(latest.json.report).toEqual(second.json.report);
  });

  it('does not touch any other week', async () => {
    await seedAdmin();
    await env.DB.prepare(
      `INSERT INTO weekly_reports (week_start, stats_json, narrative, source)
       VALUES ('2026-10-12', '{}', '上上周', 'ai')`,
    ).run();
    await call('POST', '/api/admin/report/2026-10-19/regenerate', { as: 'admin' });
    const other = await env.DB.prepare(
      "SELECT narrative, source FROM weekly_reports WHERE week_start = '2026-10-12'",
    ).first();
    expect(other).toEqual({ narrative: '上上周', source: 'ai' });
  });

  it.todo(
    'BUG: an impossible date that passes the regex (e.g. 2026-13-45) should be a 400, ' +
      'but computeStats/weekBounds call toISOString() on NaN and the route answers 500 ' +
      '(worker/report.ts:289 only checks the shape, worker/report.ts:44 throws RangeError)',
  );

  it.todo(
    'BUG: a non-Monday week key (e.g. 2026-10-21) is accepted and stored as its own ' +
      'weekly_reports row; getLatestReport (ORDER BY week_start DESC) then serves that ' +
      'off-grid week as the latest report (worker/report.ts:289). Same for a rolled-over ' +
      'date: 2026-02-30 answers 200 and is stored under week_start "2026-02-30"',
  );
});

// ---------------------------------------------------------------------------

describe('POST /api/admin/users/:id', () => {
  it('adjusts a score with an admin_adjust event and toggles roles', async () => {
    await seedAdmin();
    await seedUser({ id: 'target', score: 77 });
    const res = await call('POST', '/api/admin/users/target', {
      as: 'admin',
      body: { score: 150, is_judge: true },
    });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true });
    expect(await scoreOf('target')).toBe(100);
    const user = await env.DB.prepare('SELECT is_judge, is_admin FROM users WHERE id = ?')
      .bind('target')
      .first();
    expect(user).toEqual({ is_judge: 1, is_admin: 0 });
    const event = await env.DB.prepare(
      'SELECT delta, reason, resulting_score FROM score_events WHERE user_id = ?',
    )
      .bind('target')
      .first();
    expect(event).toEqual({ delta: 23, reason: 'admin_adjust', resulting_score: 100 });
  });

  it('answers 404 for an unknown user', async () => {
    await seedAdmin();
    const res = await call('POST', '/api/admin/users/nobody', { as: 'admin', body: { score: 1 } });
    expect(res.status).toBe(404);
    expect(res.json).toEqual({ error: '用户不存在' });
  });

  it('never writes wrongly-typed role flags or scores', async () => {
    // Only "nothing is written" is pinned. Answering 200 here is itself a
    // known bug (see the BUG todo in admin-users.test.ts): fixing it to a 400
    // must not break this test.
    await seedAdmin();
    await seedUser({ id: 'target', score: 77 });
    await call('POST', '/api/admin/users/target', {
      as: 'admin',
      body: { is_admin: 'yes', score: '0' },
    });
    expect(await scoreOf('target')).toBe(77);
    expect(await scoreEventCount('target')).toBe(0);
    const row = await env.DB.prepare('SELECT is_admin FROM users WHERE id = ?')
      .bind('target')
      .first<{ is_admin: number }>();
    expect(row?.is_admin).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('POST /api/admin/ai-config/test (dry run)', () => {
  it('with AI off, returns the base-sentence fallback and writes nothing', async () => {
    await seedAdmin();
    const res = await call('POST', '/api/admin/ai-config/test', { as: 'admin', body: {} });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      ok: false,
      source: 'fallback',
      verdict: {
        delta: VIOLATION_MAP.no_show.base,
        headline: 'AI 裁判暂时不可用',
        reasoning: '本次按基准分量刑。如有异议请点申诉，管理员会人工复核。',
        factors: [],
      },
      error: 'AI 未启用或未完成配置',
      clamped: false,
      parsed_delta: null,
    });
    expect(typeof res.json.latency_ms).toBe('number');
    expect(res.json).not.toHaveProperty('raw');
    expect(res.cacheControl).toBe('private, no-store');
    expect(await countRows('ai_verdicts')).toBe(0);
    expect(await countRows('records')).toBe(0);
    expect(await countRows('score_events')).toBe(0);
    expect(await countRows('app_settings')).toBe(0);
  });

  it('never leaks the API key in a dry-run response', async () => {
    await seedAdmin();
    const res = await call('POST', '/api/admin/ai-config/test', {
      as: 'admin',
      env: configuredEnv(),
      body: { claim: '自定义陈述', statement: '自定义辩解' },
    });
    expect(res.status).toBe(200);
    expect(res.text).not.toContain(FAKE_KEY);
  });
});


describe('AI credential administration and atomicity', () => {
  it('sets encrypted credentials without provider env and preserves, replaces, then explicitly clears them', async () => {
    await seedAdmin();
    const runtime = appEnv({ AI_CONFIG_MASTER_KEY: MASTER_KEY });
    const request = (body: unknown, targetEnv = runtime) => call('POST', '/api/admin/ai-config', { as: 'admin', env: targetEnv, body });
    const saved = await request({ enabled: true, base_url: 'https://fake.example/v1', model: 'fake', api_key: `  ${FAKE_KEY}  ` });
    expect(saved.status).toBe(200);
    expect(saved.json.enabled).toBe(true);
    expect(saved.cacheControl).toBe('private, no-store');
    let stored = (await settingsObject())['ai.api_key_encrypted'];
    expect(stored).toBeDefined();
    expect(stored).not.toContain(FAKE_KEY);
    expect(await openAiApiKey(stored, MASTER_KEY)).toBe(FAKE_KEY);
    const read = await call('GET', '/api/admin/ai-config', { as: 'admin', env: runtime });
    expect(read.json).toMatchObject({ enabled: true, configured_enabled: true, has_api_key: true, api_key_source: 'database', can_update_api_key: true });
    expect(read.cacheControl).toBe('private, no-store');
    expect(read.text + saved.text).not.toContain(FAKE_KEY);
    expect(read.text + saved.text).not.toContain(stored);
    await request({ model: 'changed' });
    expect((await settingsObject())['ai.api_key_encrypted']).toBe(stored);
    expect((await loadAiConfig(env.DB, runtime)).apiKey).toBe(FAKE_KEY);
    const replacement = 'sk-fake-replacement';
    expect((await request({ api_key: replacement })).status).toBe(200);
    expect((await loadAiConfig(env.DB, runtime)).apiKey).toBe(replacement);
    expect((await request({ api_key: null }, appEnv({ AI_API_KEY: FAKE_KEY }))).status).toBe(200);
    expect((await settingsObject())['ai.api_key_encrypted']).toBe('{"v":1,"state":"cleared"}');
    const cleared = await call('GET', '/api/admin/ai-config', { as: 'admin', env: configuredEnv({ AI_ENABLED: 'true' }) });
    expect(cleared.json).toMatchObject({ enabled: false, configured_enabled: true, has_api_key: false, api_key_source: 'none', can_update_api_key: false });
  });

  it.each(['', ' '.repeat(5), 'x'.repeat(4097), 42, true, {}, [], '\0abc', 'abc\r', '\nabc'])('rejects invalid key %j without changing a valid model', async (api_key) => {
    await seedAdmin();
    const res = await call('POST', '/api/admin/ai-config', { as: 'admin', env: appEnv({ AI_CONFIG_MASTER_KEY: MASTER_KEY }), body: { model: 'must-not-write', api_key } });
    expect(res.status).toBe(400);
    expect(await settingsObject()).toEqual({});
  });

  it('accepts exactly 4096 key characters', async () => {
    await seedAdmin();
    const res = await call('POST', '/api/admin/ai-config', { as: 'admin', env: appEnv({ AI_CONFIG_MASTER_KEY: MASTER_KEY }), body: { api_key: 'x'.repeat(4096) } });
    expect(res.status).toBe(200);
    expect(await openAiApiKey((await settingsObject())['ai.api_key_encrypted'], MASTER_KEY)).toHaveLength(4096);
  });

  it.each([undefined, 'invalid-master'])('fails setting with unusable master %j before any ordinary write', async (master) => {
    await seedAdmin();
    const runtime = appEnv({ AI_CONFIG_MASTER_KEY: master });
    const res = await call('POST', '/api/admin/ai-config', { as: 'admin', env: runtime, body: { model: 'must-not-write', api_key: FAKE_KEY } });
    expect(res.status).toBe(503);
    expect(res.text).not.toContain(FAKE_KEY);
    expect(res.json.error).toContain('AI_CONFIG_MASTER_KEY');
    expect(await settingsObject()).toEqual({});
    expect((await call('POST', '/api/admin/ai-config', { as: 'admin', env: runtime, body: { model: 'ordinary' } })).status).toBe(200);
    expect((await call('POST', '/api/admin/ai-config', { as: 'admin', env: runtime, body: { api_key: null } })).status).toBe(200);
  });

  it('validates all ordinary fields before writing any', async () => {
    await seedAdmin();
    const res = await call('POST', '/api/admin/ai-config', { as: 'admin', body: { model: 'must-not-write', temperature: 9 } });
    expect(res.status).toBe(400);
    expect(await settingsObject()).toEqual({});
  });

  it('rolls back earlier writes when a later database statement fails', async () => {
    await seedAdmin();
    // Keep real SQL and a real transaction; append a NOT NULL violation after
    // valid route statements to reproduce a late database failure on both engines.
    const broken = new Proxy(env.DB, { get(target, prop) {
      if (prop === 'batch') return (statements: D1PreparedStatement[]) => target.batch([...statements, target.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)').bind('fail-late', null)]);
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await call('POST', '/api/admin/ai-config', { as: 'admin', env: appEnv({ DB: broken, AI_CONFIG_MASTER_KEY: MASTER_KEY }), body: { model: 'must-roll-back', api_key: FAKE_KEY } });
      expect(res.status).toBe(500);
      expect(await settingsObject()).toEqual({});
      expect(res.text).not.toContain(FAKE_KEY);
      expect(log.mock.calls.flat().map(String).join(' ')).not.toContain(FAKE_KEY);
    } finally {
      log.mockRestore();
    }
  });

  it.each([undefined, 'invalid-master', btoa('w'.repeat(32))])('keeps public config available with unreadable stored credentials and master %j', async (master) => {
    await seedAdmin();
    const envelope = await sealAiApiKey(FAKE_KEY, MASTER_KEY);
    await env.DB.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)').bind('ai.api_key_encrypted', envelope).run();
    const runtime = configuredEnv({ AI_CONFIG_MASTER_KEY: master, AI_ENABLED: 'true', READ_ONLY: '1' });
    const publicRes = await call('GET', '/api/config', { env: runtime });
    expect(publicRes.status).toBe(200);
    expect(publicRes.json.aiEnabled).toBe(false);
    const adminRes = await call('GET', '/api/admin/ai-config', { as: 'admin', env: runtime });
    expect(adminRes.json).toMatchObject({ configured_enabled: true, has_api_key: false, api_key_source: 'database', can_update_api_key: master === btoa('w'.repeat(32)) });
    expect(adminRes.text + publicRes.text).not.toContain(FAKE_KEY);
    expect(adminRes.text + publicRes.text).not.toContain(envelope);
  });

  it('guards sensitive requests before JSON parsing, including read-only writes', async () => {
    await seedAdmin();
    await seedUser({ id: 'ordinary' });
    const rawBody = '{"api_key":';
    expect((await call('POST', '/api/admin/ai-config', { rawBody })).status).toBe(401);
    expect((await call('POST', '/api/admin/ai-config', { as: 'ordinary', rawBody })).status).toBe(403);
    const readOnly = await call('POST', '/api/admin/ai-config', { as: 'admin', env: appEnv({ READ_ONLY: '1' }), body: { api_key: FAKE_KEY } });
    expect(readOnly.status).toBe(503);
    expect(readOnly.cacheControl).toBe('private, no-store');
    expect(await settingsObject()).toEqual({});
  });
});


describe('saved AI config dry-run response', () => {
  it.each(['success', 'upstream-error'])('filters credentials from %s and omits raw output', async (kind) => {
    await seedAdmin();
    const runtime = configuredEnv({ AI_ENABLED: 'true' });
    const upstream = kind === 'success'
      ? new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ delta: -11, headline: FAKE_KEY, reasoning: FAKE_KEY, factors: [{ kind: 'mitigating', text: FAKE_KEY }] }) } }] }))
      : new Response(`rejected ${FAKE_KEY}`, { status: 500 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(upstream));
    try {
      const res = await call('POST', '/api/admin/ai-config/test', { as: 'admin', env: runtime });
      expect(res.status).toBe(200);
      expect(res.json.source).toBe(kind === 'success' ? 'ai' : 'fallback');
      expect(res.text).not.toContain(FAKE_KEY);
      expect(res.text).toContain('[已隐藏]');
      expect(res.json).not.toHaveProperty('raw');
      expect(res.cacheControl).toBe('private, no-store');
      expect(await countRows('ai_verdicts')).toBe(0);
      expect(await countRows('score_events')).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
