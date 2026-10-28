// App HTTP writes must become visible to an independently constructed bot
// context on its next domain call. Only PostgreSQL and a loopback fake provider
// are used; no real credentials, Discord connection or online AI are involved.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest';
import { createBackend, type Backend } from '../../server/src/backend';
import { asD1, PgD1Database } from '../../server/src/db/d1';
import { submitCaseAction } from '../../server/src/discord/case-actions';
import { linkAccounts } from '../../server/src/discord/links';
import { fileCase } from '../../worker/cases';
import { SESSION_COOKIE, signSession } from '../../worker/session';
import type { Env, User } from '../../worker/types';
import { seedUser } from '../worker/helpers';
import { env, pool } from './cloudflare-test';

const ORIGIN = 'https://ai-config.test';
const SESSION_SECRET = 'ai-config-test-session-secret';
const MASTER = Buffer.alloc(32, 31).toString('base64');
const FIRST_KEY = 'sk-pg-first-test-only';
const SECOND_KEY = 'sk-pg-second-test-only';
const LEGACY_KEY = 'sk-pg-legacy-must-not-revive';
const CLAIM = '说好八点开始，结果迟到十分钟才上线';

let provider: Server;
let providerUrl: string;
let calls: Array<{ authorization: string | undefined; model: unknown }>;
let botPool: pg.Pool;
let botDb: D1Database;
let backends: Backend[];
let errors: unknown[][];
let nextCaller: number;

beforeEach(async () => {
  calls = [];
  backends = [];
  errors = [];
  nextCaller = 0;
  provider = createServer(async (req, res) => {
    let text = '';
    for await (const chunk of req) text += chunk;
    const body = JSON.parse(text) as { model?: unknown };
    calls.push({ authorization: req.headers.authorization, model: body.model });
    const key = req.headers.authorization?.replace(/^Bearer /, '');
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions' || ![FIRST_KEY, SECOND_KEY].includes(key ?? '')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unexpected fake-provider request' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      delta: key === FIRST_KEY ? -2 : -1,
      headline: key === FIRST_KEY ? 'first credential accepted' : 'replacement credential accepted',
      // An upstream echo must not end up in a verdict, audit or admin response.
      reasoning: `隔离服务试跑 ${key}`,
      factors: [],
      confidence: 0.9,
    }) } }] }));
  });
  await new Promise<void>((resolve, reject) => {
    provider.once('error', reject);
    provider.listen(0, '127.0.0.1', resolve);
  });
  providerUrl = `http://localhost:${(provider.address() as AddressInfo).port}/v1`;
  botPool = new pg.Pool({ connectionString: inject('pgUrl'), options: '-c TimeZone=UTC' });
  botDb = asD1(new PgD1Database(botPool));
});

afterEach(async () => {
  await Promise.all(backends.map(backend => backend.close(5_000)));
  await botPool?.end();
  if (provider) {
    provider.closeAllConnections();
    await new Promise<void>((resolve, reject) => provider.close(error => error ? reject(error) : resolve()));
  }
});

function app(overrides: NodeJS.ProcessEnv = {}): Backend {
  const backend = createBackend({
    API_HOST: 'ai-config.test',
    DATABASE_URL: inject('pgUrl'),
    OAUTH_BASE_URL: 'https://idp.example',
    OAUTH_CLIENT_ID: 'test-client',
    OAUTH_CLIENT_SECRET: 'test-oauth-secret',
    SESSION_SECRET,
    APP_URL: ORIGIN,
    AI_CONFIG_MASTER_KEY: MASTER,
    ...overrides,
  }, { log: { error: (...args: unknown[]) => errors.push(args), warn: () => undefined } })!;
  backends.push(backend);
  return backend;
}

async function request(backend: Backend, path: string, body?: unknown, authenticated = true) {
  const headers = new Headers();
  if (authenticated) headers.set('Cookie', `${SESSION_COOKIE}=${await signSession({ sub: 'admin' }, SESSION_SECRET)}`);
  if (body !== undefined) {
    headers.set('Content-Type', 'application/json');
    headers.set('Origin', ORIGIN);
  }
  const response = await backend.part.fetch(new Request(`${ORIGIN}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await response.text();
  for (const secret of [FIRST_KEY, SECOND_KEY, LEGACY_KEY, MASTER]) expect(text).not.toContain(secret);
  expect(response.status, text).toBe(200);
  return JSON.parse(text) as Record<string, unknown>;
}

async function save(backend: Backend, fields: Record<string, unknown> = {}) {
  return request(backend, '/api/admin/ai-config', {
    enabled: true, base_url: providerUrl, model: 'saved-model', ...fields,
  });
}

function bot(master: string | undefined, legacyKey?: string) {
  // Constructed once, independently of app/buildEnv, like bot-main's actionCtx.
  // The master and legacy credential stay fixed while saved settings change.
  return {
    db: botDb,
    appUrl: ORIGIN,
    frontendUrl: 'https://score.example',
    env: { DB: botDb, AI_CONFIG_MASTER_KEY: master, AI_API_KEY: legacyKey } as Env,
  };
}

async function decide(ctx: ReturnType<typeof bot>, judge: User, id: string) {
  await seedUser({ id });
  const caller = { id: String(100000000000000000n + BigInt(++nextCaller)), username: id };
  await linkAccounts(botDb, { userId: id, discordUserId: caller.id, discordUsername: id, replace: false, via: 'web' });
  const filed = await fileCase(env.DB, judge, { subject_id: id, type: 'late_minor', claim: CLAIM }, { offsetHours: 8 }, ctx.env);
  const reply = await submitCaseAction('statement', filed.id, '临时堵车，已经道歉', caller, ctx);
  const row = (await pool.query('SELECT status, delta, verdict_source, verdict_headline, verdict_reason FROM records WHERE id = $1', [filed.id])).rows[0];
  expect(reply.content).toContain('判决');
  expect(row.status).toBe('decided');
  return row;
}

async function encryptedRow(): Promise<string> {
  return (await pool.query("SELECT value FROM app_settings WHERE key = 'ai.api_key_encrypted'")).rows[0].value;
}

async function assertNoSecretInStoredOutputs() {
  const rows = await pool.query(`SELECT row_to_json(r) AS value FROM records r
    UNION ALL SELECT row_to_json(a) AS value FROM ai_verdicts a`);
  const output = JSON.stringify([rows.rows, errors]);
  for (const secret of [FIRST_KEY, SECOND_KEY, LEGACY_KEY, MASTER]) expect(output).not.toContain(secret);
  expect(errors).toEqual([]);
}

describe('admin AI configuration across app and bot runtimes', () => {
  it('uses web-saved credentials on the next bot verdict, replaces them without rebuilding the bot, and never revives a cleared env key', async () => {
    await seedUser({ id: 'admin', admin: true, participant: false });
    const judge = await seedUser({ id: 'judge', judge: true });
    const backend = app(); // No provider variables or API key in the app env.
    const ctx = bot(MASTER, LEGACY_KEY);
    await save(backend, { api_key: FIRST_KEY });
    const firstEnvelope = await encryptedRow();
    expect(firstEnvelope).not.toContain(FIRST_KEY);
    const firstTry = await request(backend, '/api/admin/ai-config/test', {});
    expect(firstTry.source).toBe('ai');
    expect(firstTry).not.toHaveProperty('raw');
    expect(await decide(ctx, judge, 'first')).toMatchObject({ delta: -2, verdict_source: 'ai', verdict_headline: 'first credential accepted' });

    await save(backend, { model: 'updated-model' }); // Omitted api_key preserves it.
    expect(await encryptedRow()).toBe(firstEnvelope);
    expect(await decide(ctx, judge, 'preserved')).toMatchObject({ delta: -2, verdict_source: 'ai' });

    await save(backend, { api_key: SECOND_KEY, model: 'replacement-model' });
    expect(await encryptedRow()).not.toBe(firstEnvelope);
    expect(await decide(ctx, judge, 'replacement')).toMatchObject({ delta: -1, verdict_source: 'ai', verdict_headline: 'replacement credential accepted' });
    const replacementTry = await request(backend, '/api/admin/ai-config/test', {});
    expect(replacementTry.source).toBe('ai');
    expect(replacementTry.verdict).toMatchObject({ headline: 'replacement credential accepted' });
    expect(calls).toEqual([
      { authorization: `Bearer ${FIRST_KEY}`, model: 'saved-model' },
      { authorization: `Bearer ${FIRST_KEY}`, model: 'saved-model' },
      { authorization: `Bearer ${FIRST_KEY}`, model: 'updated-model' },
      { authorization: `Bearer ${SECOND_KEY}`, model: 'replacement-model' },
      { authorization: `Bearer ${SECOND_KEY}`, model: 'replacement-model' },
    ]);

    await save(backend, { api_key: null });
    expect(await decide(ctx, judge, 'cleared')).toMatchObject({ delta: -3, verdict_source: 'fallback' });
    expect(calls).toHaveLength(5);
    expect(await request(backend, '/api/admin/ai-config')).toMatchObject({ enabled: false, has_api_key: false, api_key_source: 'none' });
    await assertNoSecretInStoredOutputs();
  });

  it.each([
    ['missing', undefined],
    ['mismatched', Buffer.alloc(32, 47).toString('base64')],
  ])('falls back safely with a %s master, keeps public config readable, and recovers the same ciphertext after repair', async (_label, faultyMaster) => {
    await seedUser({ id: 'admin', admin: true, participant: false });
    const judge = await seedUser({ id: 'judge', judge: true });
    const backend = app();
    await save(backend, { api_key: FIRST_KEY });
    const envelope = await encryptedRow();
    const brokenBot = bot(faultyMaster, LEGACY_KEY);
    expect(await decide(brokenBot, judge, 'faulty')).toMatchObject({ delta: -3, verdict_source: 'fallback' });
    const brokenApp = app({ AI_CONFIG_MASTER_KEY: faultyMaster, AI_API_KEY: LEGACY_KEY });
    expect(await request(brokenApp, '/api/config', undefined, false)).toMatchObject({ aiEnabled: false });
    await brokenApp.close(5_000);
    backends = backends.filter(value => value !== brokenApp);
    expect(calls).toEqual([]);
    expect(await encryptedRow()).toBe(envelope);

    expect(await decide(bot(MASTER, LEGACY_KEY), judge, 'repaired')).toMatchObject({ delta: -2, verdict_source: 'ai' });
    expect(calls).toEqual([{ authorization: `Bearer ${FIRST_KEY}`, model: 'saved-model' }]);
    expect(await encryptedRow()).toBe(envelope);
    await assertNoSecretInStoredOutputs();
  });
});
