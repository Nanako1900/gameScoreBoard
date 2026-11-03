import { beforeEach, expect, it, vi } from 'vitest';
import { defaultAgentSettings } from '../../shared/community-agent';
import { CommunityAgentStore, AgentDeliveryError } from '../../server/src/community/agent-store';
import { CommunityStore } from '../../server/src/community/store';
import { seedUser } from '../worker/helpers';
import { pool } from './cloudflare-test';

const GUILD = '111111111111111111', MEMBER = '222222222222222222', CHANNEL = '333333333333333333';
let store: CommunityAgentStore, community: CommunityStore, channelRef: string, now: number;
beforeEach(async () => {
  now = Date.parse('2026-11-03T12:00:00Z');
  store = new CommunityAgentStore(pool, GUILD, { now: () => now, offsetHours: 8 });
  community = new CommunityStore(pool, GUILD);
  await seedUser({ id: 'alice' }); await seedUser({ id: 'admin', admin: true });
  await community.upsertResource('member', MEMBER, 'Alice', { metadata: { bot: false } });
  channelRef = (await community.upsertResource('text', CHANNEL, '问答')).ref;
  await pool.query("INSERT INTO discord_links(discord_user_id,user_id,discord_username) VALUES($1,'alice','Alice')", [MEMBER]);
  await store.saveSettings({ ...defaultAgentSettings(), enabled: true, channelRefs: [channelRef], cooldownSeconds: 0 }, 0, 'admin');
});
async function reserve(messageId = '444444444444444444') { return store.reserve({ discordUserId: MEMBER, channelId: CHANNEL, messageId }); }
async function claim(messageId?: string) {
  const accepted = await reserve(messageId); expect(accepted.kind).toBe('accepted');
  if (accepted.kind !== 'accepted') throw new Error('not admitted');
  const result = await store.claim(accepted.request.ref); expect(result).not.toBeNull(); return result!;
}

it('publishes only explicit documents with independent optimistic versions and no raw identifiers', async () => {
  const draft = await store.saveDocument({ title: '规则', content: '欢迎 <@222222222222222222>', published: false, expectedVersion: 0 }, 'admin');
  expect(await store.publishedDocuments()).toEqual([]);
  const published = await store.saveDocument({ ref: draft.ref, title: draft.title, content: draft.content, published: true, expectedVersion: draft.version }, 'admin');
  expect(published.content).not.toContain(MEMBER); expect(published.version).toBe(2);
  expect((await store.settings()).version).toBe(1); expect((await store.settings()).knowledgeVersion).toBe(2);
  await expect(store.saveDocument({ ref: draft.ref, title: draft.title, content: draft.content, published: true, expectedVersion: 1 }, 'admin')).rejects.toMatchObject({ code: 'version_conflict' });
  await store.deleteDocument(published.ref, published.version, 'admin');
  expect(await store.documents()).toEqual([]); expect(await store.publishedDocuments()).toEqual([]);
});

it('deduplicates source messages and atomically limits Nanako-user and guild quotas', async () => {
  await store.saveSettings({ ...defaultAgentSettings(), enabled: true, channelRefs: [channelRef], userDailyLimit: 1, cooldownSeconds: 0 }, 1, 'admin');
  const results = await Promise.all([reserve(), reserve('555555555555555555')]);
  expect(results.map(result => result.kind).sort()).toEqual(['accepted', 'rate_limited']);
  const accepted = results.find(result => result.kind === 'accepted')!;
  if (accepted.kind !== 'accepted') throw new Error('not admitted');
  const row = (await pool.query('SELECT source_message_id FROM community_agent_requests WHERE ref=$1', [accepted.request.ref])).rows[0];
  expect((await reserve(row.source_message_id)).kind).toBe('duplicate');
  expect((await store.diagnostics()).usage.total).toBe(1);
});

it('does not consume quota for an unbound account or an unconfigured channel', async () => {
  await pool.query("DELETE FROM discord_links WHERE user_id='alice'");
  expect((await reserve()).kind).toBe('unbound');
  expect((await store.reserve({ discordUserId: MEMBER, channelId: '999999999999999999', messageId: '555555555555555555' })).kind).toBe('ignored');
  expect((await store.diagnostics()).usage.total).toBe(0);
});

it('cancels a claimed answer after unlink and same-account relink because the binding generation changed', async () => {
  const running = await claim();
  await pool.query("DELETE FROM discord_links WHERE user_id='alice'");
  await pool.query("INSERT INTO discord_links(discord_user_id,user_id,discord_username) VALUES($1,'alice','Alice')", [MEMBER]);
  const post = vi.fn(async () => 'receipt');
  expect(await store.withDeliveryGuard(running, post)).toEqual({ kind: 'canceled' }); expect(post).not.toHaveBeenCalled();
});

it('cancels after knowledge or settings change and never holds a model-call transaction open', async () => {
  const running = await claim();
  await store.saveDocument({ title: '新规则', content: '更新', published: true, expectedVersion: 0 }, 'admin');
  expect(await store.check(running)).toBe(false);
  const post = vi.fn(async () => 'receipt');
  expect(await store.withDeliveryGuard(running, post)).toEqual({ kind: 'canceled' }); expect(post).not.toHaveBeenCalled();
});

it('isolates an unknown Discord result and does not allow the claim to deliver again', async () => {
  const running = await claim();
  const post = vi.fn(async () => { throw new Error('upstream includes sensitive details'); });
  expect(await store.withDeliveryGuard(running, post)).toEqual({ kind: 'isolated' });
  expect(await store.withDeliveryGuard(running, post)).toEqual({ kind: 'canceled' }); expect(post).toHaveBeenCalledTimes(1);
  const view = await store.diagnostics(); expect(view.requests[0]).toMatchObject({ status: 'isolated', errorCode: 'delivery_unknown' });
  expect(JSON.stringify(view)).not.toContain('sensitive');
});

it('distinguishes a known failure, expires claims, and never stores question or answer columns', async () => {
  const running = await claim();
  expect(await store.withDeliveryGuard(running, async () => { throw new AgentDeliveryError(false, 'delivery_failed'); })).toEqual({ kind: 'failed' });
  const expired = await claim('555555555555555555'); now += 90_001;
  expect(await store.check(expired)).toBe(false);
  const columns = (await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='community_agent_requests'")).rows.map(row => row.column_name);
  expect(columns).not.toContain('question'); expect(columns).not.toContain('answer');
});

it('enforces one guild-wide budget across concurrent callers and a cooldown across midnight', async () => {
  const OTHER = '666666666666666666';
  await seedUser({ id: 'bob' }); await community.upsertResource('member', OTHER, 'Bob');
  await pool.query("INSERT INTO discord_links(discord_user_id,user_id,discord_username) VALUES($1,'bob','Bob')", [OTHER]);
  await store.saveSettings({ ...defaultAgentSettings(), enabled: true, channelRefs: [channelRef], guildDailyLimit: 1, cooldownSeconds: 10 }, 1, 'admin');
  now = Date.parse('2026-11-03T15:59:59Z');
  const inputs = [{ discordUserId: MEMBER, channelId: CHANNEL, messageId: '444444444444444444' }, { discordUserId: OTHER, channelId: CHANNEL, messageId: '555555555555555555' }];
  const admitted = await Promise.all(inputs.map(input => store.reserve(input)));
  expect(admitted.map(result => result.kind).sort()).toEqual(['accepted', 'rate_limited']);
  const winner = inputs[admitted.findIndex(result => result.kind === 'accepted')];
  now += 2_000;
  expect((await store.reserve({ ...winner, messageId: '777777777777777777' })).kind).toBe('rate_limited');
  now += 10_000;
  expect((await store.reserve({ ...winner, messageId: '888888888888888888' })).kind).toBe('accepted');
});

it('caps pending admissions at twenty and recovers only expired work without replaying it', async () => {
  await store.saveSettings({ ...defaultAgentSettings(), enabled: true, channelRefs: [channelRef], userDailyLimit: 100, cooldownSeconds: 0 }, 1, 'admin');
  for (let index = 0; index < 20; index++) expect((await reserve(String(400000000000000000n + BigInt(index)))).kind).toBe('accepted');
  expect((await reserve('555555555555555555')).kind).toBe('busy');
  const active = (await pool.query("SELECT ref FROM community_agent_requests WHERE status='queued' LIMIT 1")).rows[0].ref;
  expect(await store.claim(active)).not.toBeNull();
  await store.recoverExpired();
  expect(Number((await pool.query("SELECT count(*) AS count FROM community_agent_requests WHERE status='queued'")).rows[0].count)).toBe(19);
  now += 90_001; await store.recoverExpired();
  expect((await store.diagnostics()).requests.every(request => request.status === 'canceled')).toBe(true);
  expect(await store.claim(active)).toBeNull();
});

it('rechecks the lease immediately before a Discord write after fresh authorization took time', async () => {
  const running = await claim(); const post = vi.fn();
  const result = await store.withDeliveryGuard(running, async beforeWrite => {
    now += 90_001; await beforeWrite(); post(); return 'receipt';
  });
  expect(result).toEqual({ kind: 'canceled' }); expect(post).not.toHaveBeenCalled();
  expect((await store.diagnostics()).requests[0]).toMatchObject({ status: 'canceled', errorCode: 'lease_expired' });
});

it('holds configuration and binding locks throughout each Discord write', async () => {
  const running = await claim();
  const result = await store.withDeliveryGuard(running, async beforeWrite => {
    await beforeWrite();
    const client = await pool.connect();
    try {
      await client.query("SET lock_timeout='50ms'");
      await expect(client.query('UPDATE community_agent_settings SET knowledge_version=knowledge_version+1 WHERE guild_id=$1', [GUILD])).rejects.toMatchObject({ code: '55P03' });
      await expect(client.query('DELETE FROM discord_links WHERE discord_user_id=$1', [MEMBER])).rejects.toMatchObject({ code: '55P03' });
    } finally { await client.query("RESET lock_timeout"); client.release(); }
    return 'receipt';
  });
  expect(result).toEqual({ kind: 'delivered', value: 'receipt' });
  await store.finish(running.ref, running.claimToken, { status: 'succeeded', model: 'model', promptVersion: 'v1', latencyMs: 20 });
  const diagnostics = await store.diagnostics();
  expect(diagnostics.requests[0].status).toBe('succeeded');
  for (const secret of [GUILD, MEMBER, CHANNEL, 'alice', running.ref, running.claimToken, 'source_message_id', 'binding_id']) expect(JSON.stringify(diagnostics.requests)).not.toContain(secret);
});

it('retains request and quota metadata for thirty days and has no automatic replay path', async () => {
  await claim();
  now += 30 * 86_400_000 + 1;
  await store.recoverExpired();
  expect((await store.diagnostics()).requests).toEqual([]);
  expect(Number((await pool.query('SELECT count(*) AS total FROM community_agent_usage')).rows[0].total)).toBe(0);
});

it('caps active documents at fifty and permits a replacement after soft deletion', async () => {
  let first: Awaited<ReturnType<CommunityAgentStore['saveDocument']>> | null = null;
  for (let index = 0; index < 50; index++) {
    const doc = await store.saveDocument({ title: `资料${index}`, content: '正文', published: false, expectedVersion: 0 }, 'admin');
    first ??= doc;
  }
  await expect(store.saveDocument({ title: '第51篇', content: '正文', published: true, expectedVersion: 0 }, 'admin')).rejects.toMatchObject({ code: 'document_limit' });
  await store.deleteDocument(first!.ref, first!.version, 'admin');
  await store.saveDocument({ title: '替换资料', content: '正文', published: true, expectedVersion: 0 }, 'admin');
  expect(await store.documents()).toHaveLength(50);
});
