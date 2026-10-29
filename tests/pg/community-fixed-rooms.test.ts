import { beforeEach, describe, expect, it } from 'vitest';
import { defaultCommunitySettings, type CommunitySettings } from '../../shared/community';
import type { CommunityDiscordSnapshot } from '../../server/src/community/discord';
import { syncFixedRooms } from '../../server/src/community/fixed-rooms';
import { CommunityStore } from '../../server/src/community/store';
import { pool } from './cloudflare-test';

const GUILD = '111111111111111111', CATEGORY = '222222222222222222', CHANNEL = '333333333333333333';
const MEMBER = '444444444444444444', OTHER = '555555555555555555', CREATOR = '666666666666666666';
const store = new CommunityStore(pool, GUILD);
beforeEach(async () => { await pool.query('TRUNCATE community_settings,community_resources,community_rooms,community_room_access,community_operations CASCADE'); });
async function setup() {
  const category = await store.upsertResource('category', CATEGORY, '固定房间');
  const channel = await store.upsertResource('voice', CHANNEL, 'Room 1', { metadata: { parentId: CATEGORY } });
  const one = await store.upsertResource('member', MEMBER, '成员一'), two = await store.upsertResource('member', OTHER, '成员二');
  const creator = await store.upsertResource('voice', CREATOR, '创建入口');
  const settings = defaultCommunitySettings(); settings.rooms.creatorRef = creator.ref;
  Object.assign(settings.rooms, { fixedCategoryRefs: [category.ref] });
  const snapshot: CommunityDiscordSnapshot = { ready: true, guildName: '社区', selfId: '777777777777777777',
    members: [one, two].map(member => ({ id: member.externalId, name: member.name, bot: false, protected: false, roleIds: [], joinedAt: null })),
    resources: [{ id: CHANNEL, kind: 'voice', name: 'Room 1', available: true, metadata: { parentId: CATEGORY, userLimit: 6,
      defaultVisibility: 'hidden', viewableMemberIds: [MEMBER], presentMemberIds: [MEMBER, OTHER] } }] };
  return { category, channel, one, two, creator, settings, snapshot };
}

describe('fixed Discord room registration and projections', () => {
  it('registers a pre-existing channel once without assigning a room owner', async () => {
    const s = await setup();
    const rows = await Promise.all([store.ensureFixedRoom(s.channel.ref, 'Room 1', { kind: 'fixed', categoryRef: s.category.ref, managerRefs: [] }),
      store.ensureFixedRoom(s.channel.ref, 'Room 1', { kind: 'fixed', categoryRef: s.category.ref, managerRefs: [] })]);
    expect(rows[0].ref).toBe(rows[1].ref); expect(rows[0]).toMatchObject({ ownerRef: null, status: 'active', metadata: { kind: 'fixed', managerRefs: [] } });
    expect(await store.listRooms()).toHaveLength(1);
  });
  it('does not convert a temporary room into fixed ownership', async () => {
    const s = await setup(); await store.createRoom(s.one.ref, '临时房', { channelRef: s.channel.ref });
    await expect(store.ensureFixedRoom(s.channel.ref, 'Room 1', { categoryRef: s.category.ref })).rejects.toMatchObject({ status: 409 });
    expect((await store.listRooms())[0].ownerRef).toBe(s.one.ref);
  });
  it('does not count fixed rooms against the temporary room cap', async () => {
    const s = await setup(); await store.ensureFixedRoom(s.channel.ref, 'Room 1', { categoryRef: s.category.ref });
    await expect(store.createRoom(s.one.ref, '临时房', { maxRooms: 1 })).resolves.toMatchObject({ ownerRef: s.one.ref });
    await expect(store.createRoom(s.two.ref, '第二间临时房', { maxRooms: 1 })).rejects.toMatchObject({ code: 'room_limit' });
  });
  it('imports exact current visibility, limits and visible membership without leaking raw identifiers', async () => {
    const s = await setup(); await syncFixedRooms(store, s.snapshot, s.settings);
    const [room] = await store.listRooms();
    expect(room).toMatchObject({ name: 'Room 1', visibility: 'hidden', userLimit: 6, ownerRef: null,
      cleanupAt: null, emptySince: null, ownerLeftAt: null, metadata: { kind: 'fixed', categoryRef: s.category.ref, managerRefs: [] } });
    expect(await store.roomAccess(room.ref)).toEqual([expect.objectContaining({ memberRef: s.one.ref, allowed: true, present: true, blocked: false })]);
    for (const raw of [CATEGORY, CHANNEL, MEMBER, OTHER]) expect(JSON.stringify(room)).not.toContain(raw);
  });
  it('updates permissions atomically, removes stale access and leaves an unchanged projection version alone', async () => {
    const s = await setup(); await syncFixedRooms(store, s.snapshot, s.settings); const [room] = await store.listRooms();
    await syncFixedRooms(store, s.snapshot, s.settings); expect((await store.getRoom(room.ref))?.version).toBe(room.version);
    s.snapshot.resources[0].metadata!.viewableMemberIds = [OTHER]; s.snapshot.resources[0].metadata!.presentMemberIds = [OTHER];
    await syncFixedRooms(store, s.snapshot, s.settings);
    expect(await store.roomAccess(room.ref)).toEqual(expect.arrayContaining([
      expect.objectContaining({ memberRef: s.one.ref, allowed: false, present: false }),
      expect.objectContaining({ memberRef: s.two.ref, allowed: true, present: true }),
    ]));
    expect((await store.getRoom(room.ref))!.version).toBeGreaterThan(room.version);
  });
  it('keeps assigned managers and never turns them into a temporary room owner during refresh', async () => {
    const s = await setup(); await syncFixedRooms(store, s.snapshot, s.settings); let [room] = await store.listRooms();
    room = await store.patchRoom(room.ref, { metadata: { ...room.metadata, managerRefs: [s.two.ref] } }, room.version);
    s.snapshot.resources[0].name = '人工改名'; await syncFixedRooms(store, s.snapshot, s.settings);
    expect(await store.getRoom(room.ref)).toMatchObject({ name: '人工改名', ownerRef: null, metadata: { managerRefs: [s.two.ref] } });
  });
  it('excludes creator, waiting and registered temporary channels from fixed discovery', async () => {
    const s = await setup(); s.settings.rooms.creatorRef = s.channel.ref;
    await syncFixedRooms(store, s.snapshot, s.settings); expect(await store.listRooms()).toHaveLength(0);
    s.settings.rooms.creatorRef = s.creator.ref; s.settings.rooms.waitingRef = s.channel.ref;
    await syncFixedRooms(store, s.snapshot, s.settings); expect(await store.listRooms()).toHaveLength(0);
    s.settings.rooms.waitingRef = null; const temporary = await store.createRoom(s.one.ref, '临时房', { channelRef: s.channel.ref });
    await syncFixedRooms(store, s.snapshot, s.settings); expect((await store.listRooms()).map(room => room.ref)).toEqual([temporary.ref]);
  });
  it('stops controlling unselected or moved channels and revives the same registration only after safe selection', async () => {
    const s = await setup(); await syncFixedRooms(store, s.snapshot, s.settings); const [room] = await store.listRooms();
    Object.assign(s.settings.rooms, { fixedCategoryRefs: [] }); await syncFixedRooms(store, s.snapshot, s.settings);
    expect((await store.getRoom(room.ref))?.status).toBe('closed'); expect(await store.listRooms()).toHaveLength(0);
    Object.assign(s.settings.rooms, { fixedCategoryRefs: [s.category.ref] }); await syncFixedRooms(store, s.snapshot, s.settings);
    expect((await store.listRooms())[0].ref).toBe(room.ref);
    s.snapshot.resources[0].metadata!.parentId = '888888888888888888'; await syncFixedRooms(store, s.snapshot, s.settings);
    expect((await store.getRoom(room.ref))?.status).toBe('closed');
  });
  it('does not automatically release an uncertain room operation from quarantine', async () => {
    const s = await setup(); await syncFixedRooms(store, s.snapshot, s.settings); let [room] = await store.listRooms();
    const op = await store.enqueue('room.rename', room.ref, { source: 'web', userId: 'admin' }, { name: '改名' }, 'rename', room.version);
    await store.claim(); await pool.query("UPDATE community_operations SET status='needs_review',lease_until=NULL WHERE ref=$1", [op.ref]);
    room = await store.patchRoom(room.ref, { status: 'needs_review' }, room.version);
    await syncFixedRooms(store, s.snapshot, s.settings); expect((await store.getRoom(room.ref))?.status).toBe('needs_review');
    expect((await store.getOperation(op.ref))?.status).toBe('needs_review');
  });
  it('fails closed when visible membership cannot be completely mapped', async () => {
    const s = await setup(); await syncFixedRooms(store, s.snapshot, s.settings); const [room] = await store.listRooms();
    s.snapshot.resources[0].metadata!.viewableMemberIds = [MEMBER, '999999999999999999'];
    await expect(syncFixedRooms(store, s.snapshot, s.settings)).rejects.toThrow();
    expect((await store.getRoom(room.ref))?.status).toBe('needs_review');
  });
  it('does nothing with an unavailable snapshot and refuses malformed visibility evidence', async () => {
    const s = await setup(); s.snapshot.ready = false; await syncFixedRooms(store, s.snapshot, s.settings); expect(await store.listRooms()).toHaveLength(0);
    s.snapshot.ready = true; delete s.snapshot.resources[0].metadata!.viewableMemberIds;
    await expect(syncFixedRooms(store, s.snapshot, s.settings)).rejects.toThrow(); expect(await store.listRooms()).toHaveLength(0);
  });
  it('rejects invalid or cross-guild fixed references instead of registering them', async () => {
    const s = await setup(), other = new CommunityStore(pool, '999999999999999999');
    await expect(other.ensureFixedRoom(s.channel.ref, 'Room 1', { categoryRef: s.category.ref })).rejects.toMatchObject({ status: 400 });
    await expect(store.ensureFixedRoom(s.one.ref, 'Room 1', { categoryRef: s.category.ref })).rejects.toMatchObject({ status: 400 });
    await expect(store.ensureFixedRoom(s.channel.ref, 'Room 1', { categoryRef: s.category.ref, managerRefs: [MEMBER] })).rejects.toMatchObject({ status: 400 });
  });
});
