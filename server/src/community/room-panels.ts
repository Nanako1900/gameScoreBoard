import type { CommunityDiscord } from './discord';
import { renderRoomPanel } from './room-panel';
import type { CommunityStore } from './store';

interface PanelOptions { now?: () => number; isReadOnly?: () => boolean; onError?: (error: unknown) => void }
interface LastPanel { fingerprint: string; checkedAt: number; retryAt: number }

/** Presentation has its own retry state. A missing card must never turn a
 * successful room creation into uncertain work or change its ownership/version.
 * The deployed runtime has one Gateway and admits calls through the engine. */
export class CommunityRoomPanels {
  private readonly last = new Map<string, LastPanel>();
  private pending: Promise<unknown> = Promise.resolve();
  private readonly now: () => number;
  constructor(private readonly store: CommunityStore, private readonly discord: CommunityDiscord, private readonly options: PanelOptions = {}) { this.now = options.now ?? Date.now; }
  sync(): Promise<void> {
    const next = this.pending.then(() => this.syncNow()); this.pending = next.catch(() => undefined); return next;
  }
  private async syncNow(): Promise<void> {
    if (!this.discord.syncRoomPanel || this.options.isReadOnly?.()) return;
    const { settings, version, runtime } = await this.store.settings();
    if (!runtime.ready || runtime.appliedVersion !== version) return;
    const category = settings.rooms.categoryRef ? await this.store.resource(settings.rooms.categoryRef, 'category') : null;
    if (!category?.available) return;
    const rooms = await this.store.listRooms();
    const active = new Set(rooms.filter(room => room.status === 'active').map(room => room.ref));
    for (const ref of this.last.keys()) if (!active.has(ref)) this.last.delete(ref);
    for (const room of rooms) {
      if (room.status !== 'active' || !room.channelRef || this.options.isReadOnly?.()) continue;
      const previous = this.last.get(room.ref), now = this.now();
      if (previous && previous.retryAt > now) continue;
      try {
        const channel = await this.store.resource(room.channelRef, 'voice');
        if (!channel?.available) continue;
        const people = this.discord.occupants(channel.externalId); if (people === null) continue;
        const owner = room.ownerRef ? await this.store.resource(room.ownerRef, 'member') : null;
        const body = renderRoomPanel({ roomRef: room.ref, name: room.name, ownerName: owner?.name ?? '房主暂不可用',
          occupantCount: people.length, userLimit: room.userLimit, visibility: room.visibility, cleanupAt: room.cleanupAt,
          emptyGraceSeconds: settings.rooms.emptyGraceSeconds, claimable: !!room.ownerLeftAt &&
            now >= Date.parse(room.ownerLeftAt) + settings.rooms.ownerGraceSeconds * 1000 && !!people.length && (!owner || !people.includes(owner.externalId)),
          transferPending: !!room.transferToRef && !!room.transferExpiresAt && Date.parse(room.transferExpiresAt) > now });
        const fingerprint = JSON.stringify([channel.externalId, body]);
        if (previous?.fingerprint === fingerprint && now - previous.checkedAt < 60_000) continue;
        // A directory entry is only a read model. Never post into a manually
        // moved or deleted channel merely because its old resource still exists.
        const current = await this.discord.channel(channel.externalId);
        if (!current || current.kind !== 'voice' || current.parentId !== category.externalId || this.options.isReadOnly?.()) continue;
        const latestRoom = await this.store.getRoom(room.ref);
        if (!latestRoom || latestRoom.status !== 'active' || latestRoom.version !== room.version || latestRoom.channelRef !== channel.ref) continue;
        const beforeWrite = async (): Promise<void> => {
          const currentRoom = await this.store.getRoom(room.ref), config = await this.store.settings();
          if (this.options.isReadOnly?.() || !currentRoom || currentRoom.status !== 'active' || currentRoom.version !== room.version ||
            currentRoom.channelRef !== channel.ref || !config.runtime.ready || config.version !== version || config.runtime.appliedVersion !== version ||
            config.settings.rooms.categoryRef !== category.ref) throw new Error('房间状态已变化，等待下一次同步');
        };
        const messageId = await this.discord.syncRoomPanel(channel.externalId, room.ref,
          typeof channel.metadata.roomPanelMessageId === 'string' ? channel.metadata.roomPanelMessageId : null, body, category.externalId, beforeWrite);
        if (channel.metadata.roomPanelMessageId !== messageId) {
          const latest = await this.store.resource(channel.ref, 'voice');
          if (!latest) continue;
          await this.store.upsertResource('voice', channel.externalId, latest.name, { available: latest.available,
            metadata: { ...latest.metadata, roomPanelMessageId: messageId } });
        }
        this.last.set(room.ref, { fingerprint, checkedAt: now, retryAt: 0 });
      } catch {
        this.last.set(room.ref, { fingerprint: previous?.fingerprint ?? '', checkedAt: previous?.checkedAt ?? 0, retryAt: now + 30_000 });
        this.options.onError?.(new Error('房内控制卡暂未同步，将自动重试'));
      }
    }
  }
}
