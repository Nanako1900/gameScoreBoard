import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { defaultAgentSettings, type AgentAdminData } from '../../shared/community-agent';
import { buildEnv } from '../../server/src/api';
import { createCommunityRoutes } from '../../server/src/community/routes';
import { CommunityStore } from '../../server/src/community/store';
import { signSession } from '../../worker/session';
import { seedUser } from '../worker/helpers';
import { env as pgEnv, pool } from './cloudflare-test';

const API = 'https://api.example.com', SPA = 'https://score.example.com', SECRET = 'agent-api-test-session-secret';
const GUILD = '111111111111111111', CHANNEL = '222222222222222222';
const PATH = '/api/admin/community/agent';
let store: CommunityStore, app: ReturnType<typeof createCommunityRoutes>, channelRef: string;
function environment(extra = {}) {
  return { ...buildEnv({ OAUTH_BASE_URL: 'https://idp.example.com', OAUTH_CLIENT_ID: 'client', OAUTH_CLIENT_SECRET: 'secret', SESSION_SECRET: SECRET, APP_URL: API, FRONTEND_ORIGIN: SPA }, pgEnv.DB), ...extra };
}
beforeEach(async () => {
  await seedUser({ id: 'admin', admin: true }); await seedUser({ id: 'member' });
  store = new CommunityStore(pool, GUILD);
  channelRef = (await store.upsertResource('text', CHANNEL, '问答')).ref;
  app = createCommunityRoutes({ store, db: pgEnv.DB, env: environment(), onError: () => undefined });
});
async function request(path = PATH, input?: unknown, user: string | null = 'admin', origin = SPA) {
  const headers = new Headers({ Origin: origin });
  if (user) headers.set('Cookie', `edg_session=${await signSession({ sub: user }, SECRET)}`);
  if (input !== undefined) headers.set('Content-Type', 'application/json');
  return app.fetch(new Request(API + path, { method: input === undefined ? 'GET' : 'POST', headers, body: input === undefined ? undefined : JSON.stringify(input) }));
}
async function data(response: Response): Promise<AgentAdminData> { expect(response.status).toBe(200); return response.json() as Promise<AgentAdminData>; }

describe('community Agent administration', () => {
  it('uses current Nanako admin authority, CSRF and maintenance rules for every new route', async () => {
    expect((await request(PATH, undefined, null)).status).toBe(401);
    expect((await request(PATH, undefined, 'member')).status).toBe(403);
    const input = { settings: defaultAgentSettings(), expectedVersion: 0 };
    expect((await request(PATH, input, 'admin', 'https://evil.example')).status).toBe(403);
    app = createCommunityRoutes({ store, db: pgEnv.DB, env: environment({ READ_ONLY: '1' }) });
    expect((await request(PATH, input)).status).toBe(503);
    expect((await request(PATH)).status).toBe(200);
    app = createCommunityRoutes({ store, db: pgEnv.DB, env: environment() });
    await pool.query("UPDATE users SET is_admin=0 WHERE id='admin'");
    expect((await request(PATH + '/documents', { title: '规则', content: '正文', published: true, expectedVersion: 0 })).status).toBe(403);
  });
  it('reports readiness independently of the judicial switch and never returns provider credentials', async () => {
    app = createCommunityRoutes({ store, db: pgEnv.DB, env: environment({ AI_BASE_URL: 'https://provider.example/v1', AI_MODEL: 'model', AI_API_KEY: 'sk-privatecredential123', AI_ENABLED: 'false' }) });
    const response = await request(); expect(response.headers.get('Cache-Control')).toBe('no-store');
    const admin = await data(response);
    expect(admin).toMatchObject({ settings: defaultAgentSettings(), version: 0, knowledgeVersion: 0, documents: [], requests: [], provider: { ready: true, reason: null } });
    expect(JSON.stringify(admin)).not.toMatch(/sk-privatecredential123|provider\.example|apiKey|discord_user_id/);
  });
  it('honors the shared cleared credential state without reviving a legacy environment key', async () => {
    app = createCommunityRoutes({ store, db: pgEnv.DB, env: environment({ AI_BASE_URL: 'https://provider.example/v1', AI_MODEL: 'model', AI_API_KEY: 'sk-legacycredential123' }) });
    await pool.query("INSERT INTO app_settings(key,value,updated_by) VALUES('ai.api_key_encrypted',$1,'admin')", [JSON.stringify({ v: 1, state: 'cleared' })]);
    const admin = await data(await request()); expect(admin.provider.ready).toBe(false); expect(admin.provider.reason).toBeTruthy();
    expect(JSON.stringify(admin)).not.toContain('sk-legacycredential123');
  });
  it('saves independent settings and safe documents, supports stable-reference creation retries, and rejects stale edits', async () => {
    const settings = { ...defaultAgentSettings(), enabled: true, channelRefs: [channelRef] };
    const saved = await data(await request(PATH, { settings, expectedVersion: 0 })); expect(saved.version).toBe(1);
    const ref = randomUUID(), input = { ref, title: '规则', content: `联系 <@${CHANNEL}> https://discord.com/channels/${GUILD}/${CHANNEL} sk-testcredential123`, published: false, expectedVersion: 0 };
    const created = await data(await request(PATH + '/documents', input));
    expect(created.documents).toHaveLength(1); expect(created.documents[0]).toMatchObject({ ref, published: false, version: 1 });
    for (const secret of [GUILD, CHANNEL, 'discord.com/channels', 'sk-testcredential123']) expect(JSON.stringify(created)).not.toContain(secret);
    const repeated = await data(await request(PATH + '/documents', input)); expect(repeated.knowledgeVersion).toBe(1); expect(repeated.documents).toHaveLength(1);
    expect((await request(PATH + '/documents', { ...input, content: 'different' })).status).toBe(409);
    const published = await data(await request(PATH + '/documents', { ...input, content: '正文', published: true, expectedVersion: 1 }));
    expect(published.documents[0]).toMatchObject({ version: 2, published: true }); expect(published.knowledgeVersion).toBe(2);
    expect((await request(PATH + '/documents', { ...input, expectedVersion: 1 })).status).toBe(409);
    const deleted = await data(await request(PATH + `/documents/${ref}/delete`, { expectedVersion: 2 })); expect(deleted.documents).toEqual([]); expect(deleted.knowledgeVersion).toBe(3);
    expect((await store.settings()).version).toBe(0);
  });
  it('rejects unknown fields, unsafe channels and invalid documents without partial writes', async () => {
    expect((await request(PATH, { settings: defaultAgentSettings(), expectedVersion: 0, api_key: 'x' })).status).toBe(400);
    const member = await store.upsertResource('member', '333333333333333333', '成员');
    expect((await request(PATH, { settings: { ...defaultAgentSettings(), channelRefs: [member.ref] }, expectedVersion: 0 })).status).toBe(400);
    expect((await request(PATH + '/documents', { title: '', content: '正文', published: true, expectedVersion: 0 })).status).toBe(400);
    expect((await data(await request())).documents).toEqual([]);
  });
});
