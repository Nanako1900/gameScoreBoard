import { randomUUID } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { defaultCommunitySettings, type CommunityJson } from '../../shared/community';
import { CommunityDiscordError, type CommunityDiscord, type CommunityDiscordChannel, type CommunityDiscordMember, type CommunityDiscordResource } from '../../server/src/community/discord';
import { CommunityEngine, type CommunityEngineOptions } from '../../server/src/community/engine';
import { CommunityRoomPanels } from '../../server/src/community/room-panels';
import { CommunityService } from '../../server/src/community/service';
import { CommunityStore, type CommunityActor } from '../../server/src/community/store';
import { seedUser } from '../worker/helpers';
import { pool, env } from './cloudflare-test';

const GUILD = '111111111111111111', OWNER = '222222222222222222', OTHER = '333333333333333333', ADMIN = '444444444444444444';
const CATEGORY = '555555555555555555', CREATOR = '666666666666666666', WAITING = '777777777777777777', CHANNEL = '888888888888888888', CREATED = '999999999999999999';
let store: CommunityStore, service: CommunityService, engine: CommunityEngine, discord: CommunityDiscord;
let ownerRef: string, otherRef: string, adminRef: string, channelRef: string;
let clock: number, ready: boolean;
let positions: Map<string, string | null>;
let members: Map<string, CommunityDiscordMember>;
let channels: Map<string, CommunityDiscordChannel>;
let resources: CommunityDiscordResource[];

beforeEach(async () => {
  clock = Date.now(); ready = true; store = new CommunityStore(pool, GUILD); service = new CommunityService(store, env.DB);
  await seedUser({ id: 'owner' }); await seedUser({ id: 'other' }); await seedUser({ id: 'admin', admin: true });
  positions = new Map([[OWNER, CREATOR], [OTHER, WAITING], [ADMIN, WAITING]]);
  members = new Map([OWNER, OTHER, ADMIN].map(id => [id, { id, name: id === OWNER ? '房主' : id === OTHER ? '访客' : '管理员', bot: false, protected: id === ADMIN, roleIds: [], joinedAt: '2026-10-28T08:00:00.000Z' }]));
  channels = new Map([
    [CATEGORY, { id: CATEGORY, name: '社区', kind: 'category', parentId: null }],
    ...[CREATOR, WAITING, CHANNEL].map(id => [id, { id, name: '语音', kind: 'voice', parentId: CATEGORY }] as [string, CommunityDiscordChannel]),
  ]);
  resources = [...members.values()].map(member => ({ id: member.id, name: member.name, kind: 'member', available: true }));
  resources.push(...[...channels.values()].map(channel => ({ id: channel.id, name: channel.name, kind: channel.kind, available: true, metadata: { parentId: channel.parentId } })));
  for (const resource of resources) await store.upsertResource(resource.kind, resource.id, resource.name, { metadata: resource.metadata as never });
  ownerRef = (await store.resourceByExternal('member', OWNER))!.ref; otherRef = (await store.resourceByExternal('member', OTHER))!.ref;
  adminRef = (await store.resourceByExternal('member', ADMIN))!.ref; channelRef = (await store.resourceByExternal('voice', CHANNEL))!.ref;
  await pool.query("INSERT INTO discord_links(discord_user_id,user_id,discord_username) VALUES($1,'owner','房主'),($2,'other','访客'),($3,'admin','管理员')", [OWNER, OTHER, ADMIN]);
  const settings = defaultCommunitySettings(); settings.enabled = true; settings.rooms.enabled = true;
  Object.assign(settings.rooms, { categoryRef: (await store.resourceByExternal('category', CATEGORY))!.ref, creatorRef: (await store.resourceByExternal('voice', CREATOR))!.ref, waitingRef: (await store.resourceByExternal('voice', WAITING))!.ref, cooldownSeconds: 0 });
  await store.saveSettings(settings, 0); await store.setRuntime({ ready: true, syncedAt: new Date(clock).toISOString(), appliedVersion: 1 });
  discord = {
    snapshot: vi.fn(async () => ({ ready, guildName: '社区', selfId: '101010101010101010', resources, members: [...members.values()] })),
    member: vi.fn(async (id: string) => members.get(id) ?? null), channel: vi.fn(async (id: string) => channels.get(id) ?? null),
    channelOf: vi.fn((id: string) => ready ? positions.get(id) : undefined),
    occupants: vi.fn((id: string) => ready ? [...positions].filter(([, channel]) => channel === id).map(([member]) => member) : null),
    canView: vi.fn(async () => true), canConnect: vi.fn(async () => true),
    createVoice: vi.fn(async () => {
      channels.set(CREATED, { id: CREATED, name: '新房间', kind: 'voice', parentId: CATEGORY });
      resources.push({ id: CREATED, name: '新房间', kind: 'voice', available: true, metadata: { parentId: CATEGORY } }); return CREATED;
    }),
    findCreatedVoice: vi.fn(async () => null),
    move: vi.fn(async (memberId: string, channelId: string | null) => { positions.set(memberId, channelId); }),
    delete: vi.fn(async (id: string) => { channels.delete(id); }), rename: vi.fn(async () => {}), setLimit: vi.fn(async () => {}),
    setVisibility: vi.fn(async () => {}), grant: vi.fn(async () => {}), deny: vi.fn(async () => {}), sendPanel: vi.fn(async () => '121212121212121212'),
  } as unknown as CommunityDiscord;
  engine = buildEngine();
});
function buildEngine(extra: Partial<CommunityEngineOptions> = {}) {
  return new CommunityEngine(store, discord, { authorize: actor => service.actorForExecution(actor), now: () => clock, ...extra });
}
function queue(kind: string, roomRef: string | null = null, payload: CommunityJson = {}, version?: number, actor: CommunityActor = { source: 'web', userId: 'owner', memberRef: ownerRef }) {
  return store.enqueue(kind, roomRef, actor, payload, randomUUID(), version);
}
async function room() { const value = await store.createRoom(ownerRef, '小屋', { channelRef }); return store.patchRoom(value.ref, { status: 'active' }, value.version); }
const latest = (ref: string) => store.getOperation(ref);

it('returns an owner from the creator to the existing room through a durable operation', async () => {
  const value = await room(); await engine.onVoice(OWNER, CREATOR);
  expect(discord.createVoice).not.toHaveBeenCalled(); expect(positions.get(OWNER)).toBe(CHANNEL);
  const ops = await store.listOperations(); expect(ops).toHaveLength(1); expect(ops[0]).toMatchObject({kind: 'room.join', roomRef: value.ref, status: 'succeeded'});
  expect(await store.listRooms()).toHaveLength(1);
});

it('does not replay an old creator return after the owner moves elsewhere or unlinks', async () => {
  const value = await room(); const op = await queue('room.join', value.ref, {creatorOnly: true}, value.version);
  positions.set(OWNER, WAITING); await engine.runOne(); expect((await latest(op.ref))!.status).toBe('conflict');
  positions.set(OWNER, CREATOR); const other = await queue('room.join', value.ref, {creatorOnly: true}, value.version);
  await pool.query("DELETE FROM discord_links WHERE user_id='owner'"); await engine.runOne();
  expect((await latest(other.ref))!.status).toBe('conflict'); expect(discord.move).not.toHaveBeenCalled();
});

it('keeps a room active when its card fails and persists card identity separately without public IDs', async () => {
  const errors = vi.fn(); discord.syncRoomPanel = vi.fn(async () => { throw new Error('panel failure'); });
  const panels = new CommunityRoomPanels(store, discord, {now: () => clock, onError: errors});
  engine = buildEngine({syncPanels: () => panels.sync()}); const op = await queue('room.create'); await engine.runOne();
  await panels.sync(); const created = (await store.listRooms())[0]; expect(created.status).toBe('active'); expect((await latest(op.ref))!.status).toBe('succeeded');
  discord.syncRoomPanel = vi.fn(async () => '121212121212121212'); clock += 30_000; await panels.sync();
  const resource = (await store.resource(created.channelRef!, 'voice'))!;
  expect(resource.metadata.roomPanelMessageId).toBe('121212121212121212'); expect((await store.getRoom(created.ref))!.version).toBe(created.version);
  const publicViews = JSON.stringify([await service.rooms('owner'), await service.resources('admin')]);
  expect(publicViews).not.toContain('121212121212121212'); expect(publicViews).not.toContain(CREATED); expect(publicViews).not.toContain('roomPanelMessageId');
});

it('preserves card identity across a fresh Gateway resource snapshot and uses it after restart', async () => {
  await room(); await store.upsertResource('voice', CHANNEL, '小屋', {metadata: {parentId: CATEGORY, roomPanelMessageId: '121212121212121212'}});
  await engine.sync(); expect((await store.resource(channelRef, 'voice'))!.metadata.roomPanelMessageId).toBe('121212121212121212');
  discord.syncRoomPanel = vi.fn(async () => '121212121212121212');
  await new CommunityRoomPanels(store, discord, {now: () => clock}).sync();
  expect(discord.syncRoomPanel).toHaveBeenCalledWith(CHANNEL, expect.any(String), '121212121212121212', expect.any(Object), CATEGORY, expect.any(Function));
});

it('persists the create intent, adopts the returned channel and moves only a still-connected owner', async () => {
  const op = await queue('room.create'); await engine.runOne();
  expect((await latest(op.ref))!.status).toBe('succeeded'); const rooms = await store.listRooms();
  expect(rooms).toHaveLength(1); expect(rooms[0]).toMatchObject({ status: 'active', metadata: { operationRef: op.ref } });
  expect((await store.resource(rooms[0].channelRef!, 'voice'))!.externalId).toBe(CREATED); expect(positions.get(OWNER)).toBe(CREATED);
});

it('preserves the created room without dragging an owner who disconnected during creation', async () => {
  const create = vi.mocked(discord.createVoice).getMockImplementation()!; vi.mocked(discord.createVoice).mockImplementationOnce(async (...args) => { const id = await create(...args); positions.set(OWNER, null); return id; });
  const op = await queue('room.create'); await engine.runOne();
  expect((await latest(op.ref))!.status).toBe('succeeded'); expect((await store.listRooms())[0].status).toBe('active'); expect(discord.move).not.toHaveBeenCalled();
});

it('keeps both the operation and room quarantined after an ambiguous create, including across a restart', async () => {
  vi.mocked(discord.createVoice).mockRejectedValueOnce(new CommunityDiscordError(503, '响应未知', true));
  const op = await queue('room.create'); await engine.runOne();
  expect((await latest(op.ref))!.status).toBe('needs_review'); const created = (await store.listRooms())[0]; expect(created.status).toBe('needs_review');
  const restarted = buildEngine(); await restarted.sync(); await restarted.onVoice(OWNER, CREATOR);
  expect(discord.createVoice).toHaveBeenCalledTimes(1); expect((await store.getRoom(created.ref))!.status).toBe('needs_review'); expect(await store.listOperations()).toHaveLength(1);
});

it('releases the owner slot after a certain create rejection with no side effect', async () => {
  vi.mocked(discord.createVoice).mockRejectedValueOnce(new CommunityDiscordError(403, '没有权限'));
  const op = await queue('room.create'); await engine.runOne(); expect((await latest(op.ref))!.status).toBe('failed');
  expect(await store.listRooms()).toHaveLength(0);
  clock += 1000;
  await engine.onVoice(OWNER, CREATOR); expect(discord.createVoice).toHaveBeenCalledTimes(2); expect((await store.listRooms())[0].status).toBe('active');
});

it('recovers a crashed create only from its unique audit marker in the current managed category', async () => {
  const op = await queue('room.create'); await store.claim(); const intention = await store.createRoom(ownerRef, '恢复房', { metadata: { operationRef: op.ref } });
  await pool.query("UPDATE community_operations SET lease_until=now()-interval '1 second' WHERE ref=$1", [op.ref]);
  channels.set(CREATED, { id: CREATED, kind: 'voice', name: '恢复房', parentId: CATEGORY }); resources.push({ id: CREATED, kind: 'voice', name: '恢复房', available: true });
  vi.mocked(discord.findCreatedVoice).mockResolvedValueOnce(CREATED);
  await buildEngine().sync(); expect((await store.getRoom(intention.ref))!.status).toBe('active'); expect((await latest(op.ref))!.status).toBe('succeeded'); expect(discord.createVoice).not.toHaveBeenCalled();
});

it('does not recover an audit result moved outside the configured category or create a replacement', async () => {
  const op = await queue('room.create'); await store.claim(); const intention = await store.createRoom(ownerRef, '恢复房', { metadata: { operationRef: op.ref } });
  await pool.query("UPDATE community_operations SET lease_until=now()-interval '1 second' WHERE ref=$1", [op.ref]);
  channels.set(CREATED, { id: CREATED, kind: 'voice', name: '恢复房', parentId: WAITING }); resources.push({ id: CREATED, kind: 'voice', name: '恢复房', available: true });
  vi.mocked(discord.findCreatedVoice).mockResolvedValue(CREATED);
  await buildEngine().sync(); expect((await store.getRoom(intention.ref))!.status).toBe('needs_review'); expect((await latest(op.ref))!.status).toBe('needs_review'); expect(discord.createVoice).not.toHaveBeenCalled();
});

it('retains an occupied room when a later waiting-room move fails during admin closure', async () => {
  const value = await room(); positions.set(OWNER, CHANNEL); positions.set(OTHER, CHANNEL);
  vi.mocked(discord.move).mockImplementation(async (id, target) => { if (id === OTHER) throw new CommunityDiscordError(403, '无法移动'); positions.set(id, target); });
  const op = await queue('room.admin_delete', value.ref, { confirm: true }, value.version, { source: 'web', userId: 'admin', memberRef: adminRef });
  await engine.runOne(); expect((await latest(op.ref))!.status).toBe('needs_review'); expect((await store.getRoom(value.ref))!.status).toBe('needs_review');
  expect(positions.get(OWNER)).toBe(WAITING); expect(positions.get(OTHER)).toBe(CHANNEL); expect(discord.delete).not.toHaveBeenCalled();
});

it.each(['admin', 'binding'])('rechecks current %s authority between every forced move', async change => {
  const value = await room(); positions.set(OWNER, CHANNEL); positions.set(OTHER, CHANNEL);
  vi.mocked(discord.move).mockImplementationOnce(async (id, target) => {
    positions.set(id, target);
    if (change === 'admin') await pool.query("UPDATE users SET is_admin=0 WHERE id='admin'");
    else await pool.query("DELETE FROM discord_links WHERE user_id='admin'");
  });
  const op = await queue('room.admin_delete', value.ref, { confirm: true }, value.version, { source: 'web', userId: 'admin', memberRef: adminRef });
  await engine.runOne(); expect((await latest(op.ref))!.status).toBe('needs_review'); expect(discord.move).toHaveBeenCalledTimes(1); expect(discord.delete).not.toHaveBeenCalled();
});

it('checks current binding before the first queued owner mutation', async () => {
  const value = await room(); const op = await queue('room.rename', value.ref, { name: '新名' }, value.version);
  await pool.query("DELETE FROM discord_links WHERE user_id='owner'"); await engine.runOne();
  expect((await latest(op.ref))!.status).toBe('conflict'); expect(discord.rename).not.toHaveBeenCalled();
});

it('stops later effects after the room owner or version changes during the first mutation', async () => {
  const value = await room(); positions.set(OTHER, CHANNEL);
  vi.mocked(discord.deny).mockImplementationOnce(async () => { await store.patchRoom(value.ref, { ownerRef: otherRef }, value.version); });
  const op = await queue('room.deny', value.ref, { memberRef: otherRef }, value.version); await engine.runOne();
  expect((await latest(op.ref))!.status).toBe('needs_review'); expect(discord.deny).toHaveBeenCalledTimes(1); expect(discord.move).not.toHaveBeenCalled(); expect((await store.getRoom(value.ref))!.ownerRef).toBe(otherRef);
});

it('refuses cleanup if a member reentered after scheduling and retains the room', async () => {
  const value = await room(); const due = await store.patchRoom(value.ref, { cleanupAt: new Date(clock - 1000).toISOString(), emptySince: new Date(clock - 121000).toISOString() }, value.version);
  const op = await queue('room.cleanup', due.ref, {}, due.version, { source: 'system' }); positions.set(OTHER, CHANNEL);
  await engine.runOne(); expect((await latest(op.ref))!.status).toBe('conflict'); expect(discord.delete).not.toHaveBeenCalled(); expect((await store.getRoom(value.ref))!.status).toBe('active');
});

it('checks occupancy again at deletion instead of trusting the earlier empty snapshot', async () => {
  const value = await room(); const due = await store.patchRoom(value.ref, { cleanupAt: new Date(clock - 1000).toISOString() }, value.version);
  vi.mocked(discord.occupants).mockReturnValueOnce([]).mockReturnValueOnce([OTHER]);
  const op = await queue('room.cleanup', due.ref, {}, due.version, { source: 'system' }); await engine.runOne();
  expect((await latest(op.ref))!.status).toBe('conflict'); expect(discord.delete).not.toHaveBeenCalled();
});

it('does not mark unknown Gateway occupancy empty or clean up while disconnected', async () => {
  const value = await room(); ready = false; await engine.tick();
  expect((await store.getRoom(value.ref))!.emptySince).toBeNull(); expect(discord.delete).not.toHaveBeenCalled(); expect(await store.listOperations()).toHaveLength(0);
});

it('cancels a scheduled empty-room deadline when the next complete snapshot is occupied', async () => {
  const value = await room(); await engine.tick(); expect((await store.getRoom(value.ref))!.cleanupAt).not.toBeNull();
  clock += 121000; positions.set(OTHER, CHANNEL); await engine.tick();
  expect((await store.getRoom(value.ref))!.cleanupAt).toBeNull(); expect(discord.delete).not.toHaveBeenCalled();
});

it('requires a current voice connection and current room connect permission before joining', async () => {
  const value = await room(); positions.set(OTHER, null);
  let op = await queue('room.join', value.ref, {}, value.version, { source: 'web', userId: 'other', memberRef: otherRef }); await engine.runOne();
  expect((await latest(op.ref))!.status).toBe('failed'); expect(discord.move).not.toHaveBeenCalled();
  positions.set(OTHER, WAITING); vi.mocked(discord.canConnect).mockResolvedValue(false);
  op = await queue('room.join', value.ref, {}, value.version, { source: 'web', userId: 'other', memberRef: otherRef }); await engine.runOne();
  expect((await latest(op.ref))!.status).toBe('failed'); expect(discord.move).not.toHaveBeenCalled();
});

it('serializes the same room across two engine instances using PostgreSQL claims and versions', async () => {
  const value = await room(); const one = await queue('room.rename', value.ref, { name: '一' }, value.version); const two = await queue('room.rename', value.ref, { name: '二' }, value.version);
  await Promise.all([engine.runOne(), buildEngine().runOne()]); await engine.runOne();
  expect((await latest(one.ref))!.status).toBe('succeeded'); expect((await latest(two.ref))!.status).toBe('conflict'); expect(discord.rename).toHaveBeenCalledTimes(1);
});

it('does not count an extra executor result as safe success when binding changes after its effects', async () => {
  const extra = buildEngine({ executeExtra: async () => { await pool.query("DELETE FROM discord_links WHERE user_id='owner'"); return { saved: true }; } });
  const op = await queue('roles.set', null, { roleRefs: [] }); await extra.runOne(); expect((await latest(op.ref))!.status).toBe('needs_review');
});
