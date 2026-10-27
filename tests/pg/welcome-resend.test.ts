// S2 manual welcome retries: real API guards and an atomic local-PG quota.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildEnv } from '../../server/src/api';
import { createLinkRoutes } from '../../server/src/link-routes';
import { linkAccounts } from '../../server/src/discord/links';
import { signSession } from '../../worker/session';
import { seedUser } from '../worker/helpers';
import { env, pool } from './cloudflare-test';

const USER = 'resend-user';
const DISCORD = '110000000000000001';
const SECRET = 'test-session-secret-0123456789abcdef';
const API = 'https://api.example.com';
const SPA = 'https://score.example.com';
const CONFIG = { OAUTH_BASE_URL: 'https://idp.example.com', OAUTH_CLIENT_ID: 'client', OAUTH_CLIENT_SECRET: 'secret',
  SESSION_SECRET: SECRET, APP_URL: API, FRONTEND_URL: SPA, FRONTEND_ORIGIN: SPA, AI_ENABLED: 'false' };

function routes(extra: Record<string, string> = {}) {
  return createLinkRoutes({ env: buildEnv({ ...CONFIG, ...extra }, env.DB), db: env.DB,
    discord: { clientId: 'client', clientSecret: 'secret' }, onError() {} });
}
async function cookie(userId = USER) { return `edg_session=${await signSession({ sub: userId }, SECRET)}`; }
async function resend(options: { cookie?: string; extra?: Record<string, string> } = {}) {
  return routes(options.extra).request(new Request(`${API}/api/me/discord/welcome`, { method: 'POST',
    headers: { Origin: SPA, ...(options.cookie === undefined ? {} : { Cookie: options.cookie }) } }));
}
async function person() {
  await seedUser({ id: USER });
  await linkAccounts(env.DB, { userId: USER, discordUserId: DISCORD, discordUsername: '玩家', replace: false, via: 'web' });
}
async function events() {
  return (await pool.query("SELECT * FROM outbox WHERE kind = 'dm.welcome' AND entity_id = $1 AND dedupe_key LIKE '%:resend:%' ORDER BY id", [USER])).rows;
}
async function used(index: number, result: string | null = null, hoursAgo = 0) {
  await pool.query(`INSERT INTO outbox (kind, entity, entity_id, dedupe_key, result, processed_at, created_at)
    VALUES ('dm.welcome', 'user', $1, $2, $3, CASE WHEN $3::text IS NULL THEN NULL ELSE now() END,
      now() - $4 * interval '1 hour')`, [USER, `dm:welcome:${USER}:resend:used-${index}`, result, hoursAgo]);
}
afterEach(() => vi.useRealTimers());

describe('POST /api/me/discord/welcome', () => {
  it('requires a signed-in user', async () => {
    const response = await resend();
    expect(response.status).toBe(401); expect(await response.json()).toEqual({ error: '未登录' });
  });

  it('requires a binding', async () => {
    await seedUser({ id: USER });
    const response = await resend({ cookie: await cookie() });
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: '还没有绑定 Discord' });
  });

  it('requires notifications to be on without re-enabling them or clearing dm_ok', async () => {
    await person(); await pool.query('UPDATE discord_links SET notify_dm = 0, dm_ok = 0 WHERE user_id = $1', [USER]);
    const response = await resend({ cookie: await cookie() });
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: '先打开私信通知' });
    expect((await pool.query('SELECT notify_dm, dm_ok FROM discord_links WHERE user_id = $1', [USER])).rows[0]).toEqual({ notify_dm: 0, dm_ok: 0 });
    expect(await events()).toEqual([]);
  });

  it('respects read-only mode before writing', async () => {
    await person();
    const response = await resend({ cookie: await cookie(), extra: { READ_ONLY: 'true' } });
    expect(response.status).toBe(503); expect(await events()).toEqual([]);
  });

  it('rejects cross-origin requests through the existing CSRF guard', async () => {
    await person();
    const response = await routes().request(new Request(`${API}/api/me/discord/welcome`, { method: 'POST',
      headers: { Cookie: await cookie(), Origin: 'https://evil.example' } }));
    expect(response.status).toBe(403); expect(await events()).toEqual([]);
  });

  it('allows three retries, excludes the automatic welcome, then returns the exact limit message', async () => {
    await person(); const auth = await cookie();
    for (let i = 0; i < 3; i += 1) {
      const response = await resend({ cookie: auth });
      expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true });
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
    const limited = await resend({ cookie: auth });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: '24 小时内已经重发 3 次，稍后再试' });
    expect(await events()).toHaveLength(3);
    expect((await pool.query("SELECT count(*) FROM outbox WHERE kind = 'dm.welcome'")).rows[0].count).toBe(4);
  });

  it('resets dm_ok and queues an immediate guide without leaking binding details', async () => {
    await person(); await pool.query('UPDATE discord_links SET dm_ok = 0 WHERE user_id = $1', [USER]);
    const response = await resend({ cookie: await cookie() });
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true });
    expect((await pool.query('SELECT dm_ok FROM discord_links WHERE user_id = $1', [USER])).rows[0].dm_ok).toBe(1);
    const [event] = await events();
    expect(event).toMatchObject({ entity: 'user', entity_id: USER, payload: {}, result: null });
    expect(event.dedupe_key).toMatch(/^dm:welcome:resend-user:resend:\d+:/);
    expect((await pool.query('SELECT available_at <= now() AS due FROM outbox WHERE id = $1', [event.id])).rows[0].due).toBe(true);
  });

  it.each([null, 'sent', 'skipped', 'dead'])('counts a manual retry with result %s toward the quota', async (result) => {
    await person(); for (let i = 0; i < 3; i += 1) await used(i, result);
    const response = await resend({ cookie: await cookie() });
    expect(response.status).toBe(429); expect(await events()).toHaveLength(3);
  });

  it('uses a rolling 24-hour window and a per-user quota', async () => {
    await person(); await used(0, 'sent', 25); await used(1, null, 23); await used(2, 'dead', 23);
    await seedUser({ id: 'other' });
    await pool.query("INSERT INTO outbox (kind, entity, entity_id, dedupe_key) VALUES ('dm.welcome', 'user', 'other', 'dm:welcome:other:resend:1')");
    const response = await resend({ cookie: await cookie() });
    expect(response.status).toBe(200); expect(await events()).toHaveLength(4);
  });

  it('does not clear dm_ok when the quota is already used', async () => {
    await person(); for (let i = 0; i < 3; i += 1) await used(i);
    await pool.query('UPDATE discord_links SET dm_ok = 0 WHERE user_id = $1', [USER]);
    expect((await resend({ cookie: await cookie() })).status).toBe(429);
    expect((await pool.query('SELECT dm_ok FROM discord_links WHERE user_id = $1', [USER])).rows[0].dm_ok).toBe(0);
  });

  it('keeps distinct manual requests made in the same millisecond', async () => {
    await person(); const auth = await cookie();
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now());
    for (let i = 0; i < 3; i += 1) expect((await resend({ cookie: auth })).status).toBe(200);
    const queued = await events(); expect(queued).toHaveLength(3);
    expect(new Set(queued.map((event) => event.dedupe_key)).size).toBe(3);
  });

  it('never admits more than three simultaneous requests', async () => {
    await person(); const auth = await cookie();
    const responses = await Promise.all(Array.from({ length: 12 }, () => resend({ cookie: auth })));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 200, 200, 429, 429, 429, 429, 429, 429, 429, 429, 429]);
    expect(await events()).toHaveLength(3);
  });

  it('rolls dm_ok and the queued event back together', async () => {
    await person(); await pool.query('UPDATE discord_links SET dm_ok = 0 WHERE user_id = $1', [USER]);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      expect((await client.query('SELECT queue_welcome_resend($1, $2) AS outcome', [USER, String(Date.now())])).rows[0].outcome).toBe('queued');
      expect((await client.query('SELECT dm_ok FROM discord_links WHERE user_id = $1', [USER])).rows[0].dm_ok).toBe(1);
      expect((await client.query("SELECT * FROM outbox WHERE dedupe_key LIKE '%:resend:%'")).rows).toHaveLength(1);
      await client.query('ROLLBACK');
    } finally { await client.query('ROLLBACK'); client.release(); }
    expect((await pool.query('SELECT dm_ok FROM discord_links WHERE user_id = $1', [USER])).rows[0].dm_ok).toBe(0);
    expect(await events()).toEqual([]);
  });

  it('can reapply the migration without changing binding state or retry history', async () => {
    await person(); const auth = await cookie(); expect((await resend({ cookie: auth })).status).toBe(200);
    const sql = readFileSync(new URL('../../server/migrations/0009_welcome.sql', import.meta.url), 'utf8');
    await pool.query(sql); await pool.query(sql);
    expect(await events()).toHaveLength(1);
    expect((await resend({ cookie: auth })).status).toBe(200);
    expect(await events()).toHaveLength(2);
  });
});
