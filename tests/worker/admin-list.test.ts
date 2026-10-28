import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../worker/index';
import { SESSION_COOKIE, signSession } from '../../worker/session';
import { noAiEnv, seedUser } from './helpers';

const BASE = 'https://score.example';
const SECRET = 'admin-list-local-fixture-secret-123456789';
const FIELDS = ['id', 'username', 'avatar_url', 'is_participant', 'is_judge', 'is_admin', 'score', 'created_at'].sort();
interface Row { id: string; username: string; avatar_url: string | null; is_participant: boolean; is_judge: boolean; is_admin: boolean; score: number; created_at: string }
interface Result { users: Row[]; truncated: boolean }
beforeEach(async () => {
  await seedUser({ id: 'admin', admin: true, participant: false });
  await seedUser({ id: 'judge', judge: true, participant: false });
  await seedUser({ id: 'visitor', participant: false });
  await seedUser({ id: 'participant' });
});
async function call(actor?: string, query = '', readOnly = false) {
  const headers = actor ? { Cookie: `${SESSION_COOKIE}=${await signSession({ sub: actor }, SECRET)}` } : undefined;
  const context = createExecutionContext();
  const response = await worker.fetch(new Request(BASE + '/api/admin/users' + query, { headers }),
    noAiEnv({ SESSION_SECRET: SECRET, ...(readOnly ? { READ_ONLY: '1' } : {}) }), context);
  await waitOnExecutionContext(context); return response;
}

describe('admin account list shared by D1 and PostgreSQL', () => {
  it.each([undefined, 'visitor', 'judge', 'participant'])('requires an admin for actor=%s and never shares denied responses', async (actor) => {
    const response = await call(actor); expect(response.status).toBe(actor ? 403 : 401);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ error: actor ? '需要管理员权限' : '未登录' });
  });
  it('includes unlisted visitors and judges and serializes all role flags as booleans', async () => {
    const response = await call('admin'); expect(response.status).toBe(200);
    const body = await response.json() as Result;
    expect(body.truncated).toBe(false); expect(body.users.map(user => user.id).sort()).toEqual(['admin', 'judge', 'participant', 'visitor']);
    expect(body.users.find(user => user.id === 'visitor')).toMatchObject({ is_participant: false, is_judge: false, is_admin: false });
    expect(body.users.find(user => user.id === 'judge')?.is_judge).toBe(true);
    for (const user of body.users) for (const flag of ['is_participant', 'is_judge', 'is_admin'] as const) expect(typeof user[flag]).toBe('boolean');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });
  it('returns only the eight declared fields and the effective display name', async () => {
    await env.DB.prepare("UPDATE users SET display_name='生效显示名', email='PRIVATE_MAIL', avatar_url='https://avatar.example/u.png' WHERE id='visitor'").run();
    const body = await (await call('admin')).json() as Result;
    const visitor = body.users.find(user => user.id === 'visitor');
    expect(visitor).toMatchObject({ username: '生效显示名', avatar_url: 'https://avatar.example/u.png' });
    for (const user of body.users) expect(Object.keys(user).sort()).toEqual(FIELDS);
    expect(JSON.stringify(body)).not.toMatch(/PRIVATE_MAIL|email|discord|oauth_username|channel_id/);
  });
  it('orders newest first with a stable ascending Nanako id tie breaker', async () => {
    await env.DB.prepare("UPDATE users SET created_at='2026-10-25 00:00:00'").run();
    await env.DB.batch(['b', 'a', 'z'].map(id => env.DB.prepare('INSERT INTO users (id,username,created_at) VALUES (?,?,?)')
      .bind(id, id, id === 'z' ? '2026-10-27 00:00:00' : '2026-10-26 00:00:00')));
    const body = await (await call('admin')).json() as Result;
    expect(body.users.map(user => user.id)).toEqual(['z', 'a', 'b', 'admin', 'judge', 'participant', 'visitor']);
  });
  it.each([500, 501])('returns at most 500 and accurately reports truncation with %s total accounts', async (total) => {
    await env.DB.batch(Array.from({ length: total - 4 }, (_, index) => {
      const id = `row-${String(index).padStart(4, '0')}`;
      return env.DB.prepare("INSERT INTO users (id,username,created_at) VALUES (?,?,'2000-01-01 00:00:00')").bind(id, id);
    }));
    const response = await call('admin'); expect(response.status).toBe(200);
    const body = await response.json() as Result;
    expect(body.users).toHaveLength(500); expect(body.truncated).toBe(total > 500);
    expect(new Set(body.users.map(user => user.id)).size).toBe(500);
  }, 15_000);
  it('does not silently turn the full account list into a participant-only or client-limited query', async () => {
    const body = await (await call('admin', '?limit=1&is_participant=1')).json() as Result;
    expect(body.users).toHaveLength(4); expect(body.truncated).toBe(false);
  });
  it('remains a read during maintenance mode', async () => {
    const response = await call('admin', '', true); expect(response.status).toBe(200);
    expect((await response.json() as Result).users).toHaveLength(4);
  });
});
