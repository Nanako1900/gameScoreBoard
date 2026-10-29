import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { defaultCommunitySettings } from '../../shared/community';
import { CommunityDiscordError, type CommunityDiscord } from '../src/community/discord';
import { CommunityRoomPanels } from '../src/community/room-panels';
import type { CommunityStore, StoredResource, StoredRoom } from '../src/community/store';

function setup() {
  let now = Date.parse('2026-10-29T12:00:00Z'), readOnly = false;
  const room = { ref: randomUUID(), ownerRef: randomUUID(), channelRef: randomUUID(), status: 'active', name: '小屋',
    metadata: {}, visibility: 'open', userLimit: 6, version: 2, cleanupAt: null, ownerLeftAt: null, transferToRef: null, transferExpiresAt: null } as StoredRoom;
  const category = { ref: randomUUID(), externalId: 'category', kind: 'category', available: true } as StoredResource;
  const channel = { ref: room.channelRef!, externalId: 'channel', kind: 'voice', name: '小屋', metadata: {}, available: true } as StoredResource;
  const owner = { ref: room.ownerRef!, externalId: 'owner', name: 'Nanako', available: true, kind: 'member' } as StoredResource;
  const settings = defaultCommunitySettings(); settings.rooms.categoryRef = category.ref;
  const resources = new Map([category, channel, owner].map(r => [r.ref, r]));
  const store = { settings: vi.fn(async () => ({settings, version: 1, runtime: {ready: true, appliedVersion: 1}})),
    listRooms: vi.fn(async () => [room]), getRoom: vi.fn(async () => room), resource: vi.fn(async (ref: string) => resources.get(ref) ?? null),
    upsertResource: vi.fn(async (_kind: string, _id: string, _name: string, options: object) => { Object.assign(channel, options); return channel; }),
    patchRoom: vi.fn() } as unknown as CommunityStore;
  const discord = { occupants: vi.fn(() => ['owner']), channel: vi.fn(async () => ({id: 'channel', kind: 'voice', parentId: 'category'})),
    syncRoomPanel: vi.fn(async () => 'message') } as unknown as CommunityDiscord;
  const errors = vi.fn();
  const panels = new CommunityRoomPanels(store, discord, { now: () => now, isReadOnly: () => readOnly, onError: errors });
  return { panels, store, discord, room, channel, owner, settings, errors, setNow: (value: number) => { now = value; }, now: () => now, setReadOnly: () => { readOnly = true; } };
}

describe('independent room control card synchronization', () => {
  it('publishes a safe actionable card permission diagnostic and clears it on success', async () => {
    const s = setup(); vi.mocked(s.discord.syncRoomPanel!).mockRejectedValueOnce(new CommunityDiscordError(403, 'secret raw discord 123456789012345678'));
    await s.panels.sync(); expect(s.channel.metadata.roomPanelProblem).toBe('permissions_missing'); expect(s.errors.mock.calls.map(([error])=>(error as Error).message).join(' ')).not.toContain('123456789012345678');
    s.setNow(s.now()+30_000); await s.panels.sync(); expect(s.channel.metadata.roomPanelProblem).toBeNull();
  });
  it('adds a fixed room card in its configured category without requiring a temporary-room category', async () => {
    const s = setup(); const category = s.settings.rooms.categoryRef!; s.settings.rooms.categoryRef=null;s.settings.rooms.fixedCategoryRefs=[category];
    s.room.metadata={kind:'fixed',categoryRef:category,managerRefs:[s.owner.ref]}; await s.panels.sync();
    expect(s.discord.syncRoomPanel).toHaveBeenCalled(); const card=JSON.stringify(vi.mocked(s.discord.syncRoomPanel!).mock.calls[0][3]);expect(card).toContain('固定');expect(card).not.toContain('自动删除');
  });
  it('rechecks read-only mode and room quarantine immediately before a delayed message write', async () => {
    const s = setup(); vi.mocked(s.discord.syncRoomPanel!).mockImplementation(async (...args) => { s.setReadOnly(); await args[5]!(); return 'message'; });
    await s.panels.sync(); expect(vi.mocked(s.discord.syncRoomPanel!).mock.calls[0][5]).toBeTypeOf('function'); expect(s.store.upsertResource).not.toHaveBeenCalled(); expect(s.channel.metadata.roomPanelMessageId).toBeUndefined();
    const t = setup(); vi.mocked(t.discord.syncRoomPanel!).mockImplementation(async (...args) => { t.room.status = 'needs_review'; await args[5]!(); return 'message'; });
    await t.panels.sync(); expect(t.store.upsertResource).not.toHaveBeenCalled();
  });
  it('persists the message identity privately without changing the room version', async () => {
    const s = setup(); await s.panels.sync();
    expect(s.discord.syncRoomPanel).toHaveBeenCalledWith('channel', s.room.ref, null, expect.any(Object), 'category', expect.any(Function));
    expect(s.channel.metadata.roomPanelMessageId).toBe('message'); expect(s.store.patchRoom).not.toHaveBeenCalled();
  });
  it('coalesces unchanged events and periodically verifies the original message', async () => {
    const s = setup(); await s.panels.sync(); await s.panels.sync(); expect(s.discord.syncRoomPanel).toHaveBeenCalledTimes(1);
    s.setNow(s.now() + 60_000); await s.panels.sync(); expect(s.discord.syncRoomPanel).toHaveBeenLastCalledWith('channel', s.room.ref, 'message', expect.any(Object), 'category', expect.any(Function));
  });
  it('refreshes name, people, limits, mode, owner and cleanup changes without requiring a manual refresh', async () => {
    const s = setup(); await s.panels.sync(); s.room.name = '新名字'; s.room.userLimit = 4; s.room.visibility = 'locked';
    s.owner.name = '新房主'; s.room.cleanupAt = new Date(s.now() + 120_000).toISOString(); vi.mocked(s.discord.occupants).mockReturnValue([]);
    await s.panels.sync(); const body = JSON.stringify(vi.mocked(s.discord.syncRoomPanel!).mock.calls.at(-1));
    expect(body).toContain('新名字'); expect(body).toContain('新房主'); expect(s.discord.syncRoomPanel).toHaveBeenCalledTimes(2);
  });
  it('contains panel failures, backs off and keeps room state untouched', async () => {
    const s = setup(); vi.mocked(s.discord.syncRoomPanel!).mockRejectedValueOnce(new Error('no permissions'));
    await expect(s.panels.sync()).resolves.toBeUndefined(); await s.panels.sync(); expect(s.discord.syncRoomPanel).toHaveBeenCalledTimes(1);
    expect(s.room.status).toBe('active'); expect(s.errors).toHaveBeenCalled();
    s.setNow(s.now() + 30_000); await s.panels.sync(); expect(s.channel.metadata.roomPanelMessageId).toBe('message');
  });
  it('lets the adapter recover a sent card after message identity persistence fails', async () => {
    const s = setup(); vi.mocked(s.store.upsertResource).mockRejectedValueOnce(new Error('database unavailable'));
    await s.panels.sync(); s.setNow(s.now() + 30_000); await s.panels.sync();
    expect(s.discord.syncRoomPanel).toHaveBeenNthCalledWith(2, 'channel', s.room.ref, null, expect.any(Object), 'category', expect.any(Function)); expect(s.room.status).toBe('active');
  });
  it('does not write a card for unknown occupancy, quarantined rooms or manually moved channels', async () => {
    const s = setup(); vi.mocked(s.discord.occupants).mockReturnValue(null); await s.panels.sync();
    vi.mocked(s.discord.occupants).mockReturnValue([]); s.room.status = 'needs_review'; await s.panels.sync();
    s.room.status = 'active'; vi.mocked(s.discord.channel).mockResolvedValue({id: 'channel', name: '小屋', kind: 'voice', parentId: 'elsewhere'}); await s.panels.sync();
    expect(s.discord.syncRoomPanel).not.toHaveBeenCalled();
  });
  it('does not write during read-only mode or before the applied configuration is ready', async () => {
    const s = setup(); s.setReadOnly(); await s.panels.sync(); expect(s.discord.syncRoomPanel).not.toHaveBeenCalled();
    const t = setup(); vi.mocked(t.store.settings).mockResolvedValue({settings: t.settings, version: 2, runtime: {ready: true, appliedVersion: 1}} as never); await t.panels.sync(); expect(t.discord.syncRoomPanel).not.toHaveBeenCalled();
  });
});
