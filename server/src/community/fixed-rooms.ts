import { isCommunityRef, type CommunitySettings, type CommunityVisibility } from '../../../shared/community';
import type { CommunityDiscordSnapshot } from './discord';
import { safeCommunityText } from './security';
import { CommunityStoreError, type CommunityStore, type StoredRoom } from './store';

export function isFixedRoom(room: Pick<StoredRoom, 'metadata'>): boolean { return room.metadata.kind === 'fixed'; }
export function fixedManagerRefs(room: Pick<StoredRoom, 'metadata'>): string[] {
  return Array.isArray(room.metadata.managerRefs) ? [...new Set(room.metadata.managerRefs.filter(isCommunityRef))] : [];
}
const invalid = (): never => { throw new CommunityStoreError(503, 'resource_missing', '固定房间权限尚未完整同步'); };
function memberIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !/^\d{17,20}$/.test(id))) return invalid();
  if (new Set(value).size !== value.length) return invalid();
  return value as string[];
}

/** Imports only explicitly selected categories. This is a read projection of
 * Discord's actual ACL, not a translation into the temporary-room access model.
 * No Discord create, permission mutation or delete is performed here. */
export async function syncFixedRooms(store: CommunityStore, snapshot: CommunityDiscordSnapshot, settings: CommunitySettings): Promise<void> {
  if (!snapshot.ready) return;
  const configured = (settings.rooms as { fixedCategoryRefs?: readonly string[] }).fixedCategoryRefs ?? [];
  const categories = new Map<string, string>();
  for (const ref of configured) {
    if (!isCommunityRef(ref)) return invalid();
    const category = await store.resource(ref, 'category');
    if (category?.available) categories.set(category.externalId, category.ref);
  }
  const existing = await store.listRooms({ includeClosed: true });
  const byChannel = new Map(existing.filter(room => room.channelRef).map(room => [room.channelRef!, room]));
  const completeMembers = new Set(snapshot.members.map(member => member.id));
  const memberRefs = await store.memberRefsByExternal([...completeMembers]);
  const selected = new Set<string>();
  for (const resource of snapshot.resources) {
    const metadata = resource.metadata ?? {}, parent = metadata.parentId;
    if (resource.kind !== 'voice' || !resource.available || typeof parent !== 'string' || !categories.has(parent)) continue;
    const channel = await store.resourceByExternal('voice', resource.id);
    if (!channel?.available) return invalid();
    if (channel.ref === settings.rooms.creatorRef || channel.ref === settings.rooms.waitingRef) continue;
    const previous = byChannel.get(channel.ref);
    if (previous && !isFixedRoom(previous)) continue;
    selected.add(channel.ref);
    try {
      const visible = memberIds(metadata.viewableMemberIds), present = memberIds(metadata.presentMemberIds);
      if ([...visible, ...present].some(id => !completeMembers.has(id) || !memberRefs.has(id))) return invalid();
      if (typeof metadata.userLimit !== 'number' || !Number.isInteger(metadata.userLimit) || metadata.userLimit < 0 || metadata.userLimit > 99
        || !['open', 'locked', 'hidden'].includes(String(metadata.defaultVisibility))) return invalid();
      const categoryRef = categories.get(parent)!;
      const room = previous ?? await store.ensureFixedRoom(channel.ref, safeCommunityText(resource.name), { categoryRef, managerRefs: [] });
      const visibleRefs = visible.map(id => memberRefs.get(id)!);
      const allowed = new Set(visibleRefs);
      await store.syncFixedRoomProjection(room.ref, room.version, {
        name: safeCommunityText(resource.name), userLimit: metadata.userLimit, visibility: metadata.defaultVisibility as CommunityVisibility,
        categoryRef, visibleMemberRefs: visibleRefs, presentMemberRefs: present.map(id => memberRefs.get(id)!).filter(ref => allowed.has(ref)),
      });
    } catch (error) {
      // A former public projection must not survive incomplete current proof.
      // Recovery requires a later complete snapshot and no uncertain operation.
      if (previous && previous.status !== 'closed' && previous.status !== 'needs_review')
        await store.patchRoom(previous.ref, { status: 'needs_review' }, previous.version).catch(() => undefined);
      throw error;
    }
  }
  for (const room of existing) {
    if (!isFixedRoom(room) || !room.channelRef || selected.has(room.channelRef)) continue;
    const categoryRef = room.metadata.categoryRef;
    if (!isCommunityRef(categoryRef)) return invalid();
    await store.syncFixedRoomProjection(room.ref, room.version, {
      name: room.name, userLimit: room.userLimit, visibility: room.visibility, categoryRef,
      visibleMemberRefs: [], presentMemberRefs: [], active: false,
    });
  }
}
