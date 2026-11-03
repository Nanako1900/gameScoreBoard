import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultCommunitySettings } from '../../shared/community';
import { buildEnv } from '../../server/src/api';
import { createCommunityRoutes } from '../../server/src/community/routes';
import { CommunityService } from '../../server/src/community/service';
import { CommunityStore } from '../../server/src/community/store';
import { signSession } from '../../worker/session';
import { seedUser } from '../worker/helpers';
import { env, pool } from './cloudflare-test';

const GUILD = '111111111111111111', MEMBER = '222222222222222222';
const API = 'https://api.example.com', ORIGIN = 'https://score.example.com', SECRET = 'community-retirement-session-secret-0123456789';
const store = new CommunityStore(pool, GUILD), service = new CommunityService(store, env.DB);
const environment = () => buildEnv({ OAUTH_BASE_URL: 'https://idp.example.com', OAUTH_CLIENT_ID: 'client', OAUTH_CLIENT_SECRET: 'secret', SESSION_SECRET: SECRET, APP_URL: API, FRONTEND_ORIGIN: ORIGIN }, env.DB);
let memberRef: string;
let app: ReturnType<typeof createCommunityRoutes>;
beforeEach(async () => {
  await seedUser({ id: 'alice' }); await seedUser({ id: 'admin', admin: true });
  memberRef = (await store.upsertResource('member', MEMBER, 'Alice', { metadata: { bot: false } })).ref;
  await pool.query("INSERT INTO discord_links(discord_user_id,user_id,discord_username) VALUES($1,'alice','Alice')", [MEMBER]);
  await store.setRuntime({ ready: true });
  app = createCommunityRoutes({ store, db: env.DB, env: environment(), onError: () => undefined });
});
async function request(path: string, user: string | null = 'alice', body?: unknown, origin = ORIGIN) {
  const headers: Record<string, string> = { Origin: origin };
  if (user) headers.Cookie = 'edg_session=' + await signSession({ sub: user }, SECRET);
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return app.fetch(new Request(API + path, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) }));
}
async function legacyResult() {
  return (await pool.query(`INSERT INTO community_fun(guild_id,kind,title,data,creator_ref) VALUES($1,'ai','OLD_PRIVATE_TITLE',$2,$3) RETURNING ref`,
    [GUILD, JSON.stringify({ theme: 'OLD_PRIVATE_INPUT', suggestions: ['OLD_PRIVATE_RESULT'], myChoice: 1 }), memberRef])).rows[0].ref as string;
}

describe('retired community tools boundaries', () => {
  it.each(['GET', 'CREATE', 'ACTION'] as const)('tombstones the legacy %s route without reading results or enqueuing jobs', async mode => {
    const ref = await legacyResult();
    const read = vi.spyOn(pool, 'query');
    try {
      const response = await request(mode === 'ACTION' ? `/api/community/fun/${ref}/actions` : '/api/community/fun', 'alice', mode === 'GET' ? undefined : { kind: 'ai', input: { theme: 'PRIVATE_NEW_INPUT' }, action: 'vote', choice: 0, requestKey: 'legacy' });
      expect(response.status).toBe(410);
      expect(await response.json()).toEqual({ error: '趣味工具已下线', code: 'feature_retired' });
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(read.mock.calls.every(([sql]) => !/community_fun|community_poll_votes|community_ai_usage|INSERT INTO community_operations/i.test(String(sql)))).toBe(true);
    } finally { read.mockRestore(); }
    expect((await pool.query('SELECT count(*) FROM community_fun')).rows[0].count).toBe(1);
    expect(await store.listOperations()).toEqual([]);
  });

  it('keeps session, mutation origin and maintenance checks in front of retired endpoints', async () => {
    expect((await request('/api/community/fun', null)).status).toBe(401);
    expect((await request('/api/community/fun', 'alice', {}, 'https://evil.example')).status).toBe(403);
    app = createCommunityRoutes({ store, db: env.DB, env: { ...environment(), READ_ONLY: '1' }, onError: () => undefined });
    expect((await request('/api/community/fun', 'alice', {})).status).toBe(503);
    expect((await request('/api/community/fun')).status).toBe(410);
  });

  it.each(['fun.create', 'fun.vote', 'fun.close', 'fun.redraw'])('rejects %s at the service boundary before any queue write', async kind => {
    await expect(service.enqueueForActor({ source: 'web', userId: 'alice', memberRef }, kind, null, { kind: 'ai', ref: crypto.randomUUID() }, kind))
      .rejects.toMatchObject({ status: 410, code: 'feature_retired' });
    expect(await store.listOperations()).toEqual([]);
  });

  it('normalizes stored legacy topics and prompts before public and administrator reads', async () => {
    const settings = defaultCommunitySettings();
    await pool.query('UPDATE community_settings SET settings=$2 WHERE guild_id=$1', [GUILD, JSON.stringify({ ...settings, fun: { enabled: true, enabledTools: ['ai', 'poll'], topics: [{ text: 'OLD_PRIVATE_TOPIC', tags: ['OLD_PRIVATE_TAG'] }], ai: { enabled: true, prompt: 'OLD_PRIVATE_PROMPT' } } })]);
    for (const path of ['/api/community', '/api/admin/community']) {
      const response = await request(path, 'admin'); expect(response.status).toBe(200);
      const body = await response.json() as { settings: { fun: unknown } };
      expect(body.settings.fun).toMatchObject({ enabled: false, enabledTools: [], ai: { enabled: false } });
      expect(JSON.stringify(body)).not.toContain('OLD_PRIVATE');
    }
  });

  it('accepts an old client save containing a damaged retired block without restoring it', async () => {
    const settings = { ...defaultCommunitySettings(), fun: { enabled: true, ai: null, topics: 'OLD_PRIVATE_TOPIC' } };
    const response = await request('/api/admin/community', 'admin', { settings, expectedVersion: 0, requestKey: 'legacy-save' });
    expect(response.status).toBe(202); expect(JSON.stringify(await response.json())).not.toContain('OLD_PRIVATE');
    expect((await store.settings()).settings.fun).toMatchObject({ enabled: false, enabledTools: [], topics: [], ai: { enabled: false, prompt: '此功能已下线。' } });
  });

  it('withholds embedded retired results from personal and administrator history without deleting stored history', async () => {
    const item = await legacyResult();
    const op = await store.enqueue('fun.create', null, { source: 'web', userId: 'alice', memberRef }, { kind: 'ai' }, 'legacy-done');
    await pool.query(`UPDATE community_operations SET status='succeeded',finished_at=now(),result=$2 WHERE ref=$1`, [op.ref, JSON.stringify({ item: { ref: item, title: 'OLD_PRIVATE_TITLE', data: { theme: 'OLD_PRIVATE_INPUT', suggestions: ['OLD_PRIVATE_RESULT'], myChoice: 1 } } })]);
    for (const user of ['alice', 'admin']) {
      const response = await request('/api/community/operations/' + op.ref, user);
      expect(response.status).toBe(200);
      const body = await response.json() as { operation: { status: string; result: unknown } };
      expect(body.operation).toMatchObject({ status: 'succeeded', result: null });
      expect(JSON.stringify(body)).not.toContain('OLD_PRIVATE');
    }
    expect((await store.listOperations())[0].result).toBeNull();
    expect((await pool.query('SELECT result FROM community_operations WHERE ref=$1', [op.ref])).rows[0].result.item.ref).toBe(item);
  });
});

describe('retired community operations do not block active room work', () => {
  async function queuedRoomWork() {
    const room = await store.createRoom(memberRef, '保留的语音房');
    const active = await store.patchRoom(room.ref, { status: 'active' }, room.version);
    const old = await store.enqueue('fun.create', room.ref, { source: 'web', userId: 'alice', memberRef }, { kind: 'ai' }, 'old-tool');
    const next = await store.enqueue('room.rename', room.ref, { source: 'web', userId: 'alice', memberRef }, { name: '正常改名' }, 'room-after-tool', active.version);
    return { room: active, old, next };
  }

  it.each(['queued', 'retry_wait', 'expired-running', 'missing-lease', 'needs_review'] as const)
  ('retires %s tool work before claiming the room operation behind it', async state => {
    const { room, old, next } = await queuedRoomWork();
    if (state === 'retry_wait') await pool.query("UPDATE community_operations SET status='retry_wait',available_at=now()+interval '1 day' WHERE ref=$1", [old.ref]);
    if (state === 'expired-running') await pool.query("UPDATE community_operations SET status='running',claim_token=gen_random_uuid(),lease_until=now()-interval '1 second' WHERE ref=$1", [old.ref]);
    if (state === 'missing-lease') await pool.query("UPDATE community_operations SET status='running',claim_token=gen_random_uuid(),lease_until=NULL WHERE ref=$1", [old.ref]);
    if (state === 'needs_review') await pool.query("UPDATE community_operations SET status='needs_review',error_code='execution_uncertain' WHERE ref=$1", [old.ref]);
    const claimed = await store.claim();
    expect(claimed?.ref).toBe(next.ref);
    expect(await store.getOperation(old.ref)).toMatchObject({ status: 'canceled', errorCode: 'feature_retired', claimToken: null });
    expect((await store.getOperation(old.ref))?.finishedAt).not.toBeNull();
    expect((await store.getRoom(room.ref))?.status).toBe('active');
    expect(await store.audit()).toEqual([expect.objectContaining({ action: 'operation.cancel', target: old.ref, outcome: 'canceled' })]);
    await store.recoverExpired(); expect(await store.audit()).toHaveLength(1);
  });

  it('preserves a valid running tool lease and does not claim its blocked scope', async () => {
    const { old } = await queuedRoomWork(); const token = crypto.randomUUID();
    await pool.query("UPDATE community_operations SET status='running',claim_token=$2,lease_until=now()+interval '5 minutes' WHERE ref=$1", [old.ref, token]);
    await store.recoverExpired(); expect(await store.claim()).toBeNull();
    expect(await store.getOperation(old.ref)).toMatchObject({ status: 'running', claimToken: token });
    expect(await store.audit()).toEqual([]);
    await pool.query("UPDATE community_operations SET lease_until=now()-interval '1 second' WHERE ref=$1", [old.ref]);
    await store.recoverExpired();
    expect(await store.getOperation(old.ref)).toMatchObject({ status: 'canceled', claimToken: null });
    expect(await store.finish(old.ref, token, { status: 'succeeded' })).toBe(false);
  });

  it('never sends a tool lease that expires between retirement and ordinary recovery to room review', async () => {
    const { room, old, next } = await queuedRoomWork();
    await pool.query("UPDATE community_operations SET status='running',claim_token=gen_random_uuid(),lease_until=now()+interval '5 minutes' WHERE ref=$1", [old.ref]);
    const execute = pool.query.bind(pool);
    let expired = false;
    const query = vi.spyOn(pool, 'query').mockImplementation((async (sql: string, values?: unknown[]) => {
      const result = await execute(sql, values);
      if (!expired && sql.includes('WITH retired AS')) {
        expired = true;
        await execute("UPDATE community_operations SET lease_until=now()-interval '1 second' WHERE ref=$1", [old.ref]);
      }
      return result;
    }) as typeof pool.query);
    try { await store.recoverExpired(); } finally { query.mockRestore(); }
    expect(expired).toBe(true);
    expect((await store.getOperation(old.ref))?.status).toBe('running');
    expect((await store.getRoom(room.ref))?.status).toBe('active');
    expect((await store.claim())?.ref).toBe(next.ref);
    expect((await store.getOperation(old.ref))?.status).toBe('canceled');
  });

  it('preserves unrelated review barriers and never restores a quarantined room without inspection', async () => {
    const { room, old, next } = await queuedRoomWork();
    await pool.query("UPDATE community_operations SET status='needs_review' WHERE ref=ANY($1::uuid[])", [[old.ref, next.ref]]);
    await store.patchRoom(room.ref, { status: 'needs_review' }, room.version);
    await store.recoverExpired();
    expect((await store.getOperation(old.ref))?.status).toBe('canceled');
    expect((await store.getOperation(next.ref))?.status).toBe('needs_review');
    expect((await store.getRoom(room.ref))?.status).toBe('needs_review');
    expect(await store.claim()).toBeNull();
  });

  it('retains completed results, votes and quota history while canceling only this guild’s pending tools', async () => {
    const result = await legacyResult();
    await pool.query('INSERT INTO community_ai_usage(guild_id,day,member_ref,count) VALUES($1,current_date,$2,3)', [GUILD, memberRef]);
    await pool.query('INSERT INTO community_poll_votes(fun_ref,member_ref,choice) VALUES($1,$2,0)', [result, memberRef]);
    const done = await store.enqueue('fun.create', null, { source: 'web', userId: 'alice', memberRef }, { kind: 'ai' }, 'old-done');
    await pool.query("UPDATE community_operations SET status='succeeded',finished_at=now(),result=$2 WHERE ref=$1", [done.ref, JSON.stringify({ item: { ref: result } })]);
    const elsewhere = new CommunityStore(pool, '333333333333333333');
    const foreign = await elsewhere.enqueue('fun.vote', null, { source: 'system' }, {}, 'foreign');
    await store.recoverExpired();
    expect((await store.getOperation(done.ref))?.status).toBe('succeeded');
    expect((await elsewhere.getOperation(foreign.ref))?.status).toBe('queued');
    expect((await pool.query('SELECT count(*) FROM community_fun')).rows[0].count).toBe(1);
    expect((await pool.query('SELECT count(*) FROM community_poll_votes')).rows[0].count).toBe(1);
    expect((await pool.query('SELECT count FROM community_ai_usage')).rows[0].count).toBe(3);
  });
});
