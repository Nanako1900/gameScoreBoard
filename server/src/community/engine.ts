import { randomUUID } from 'node:crypto';
import { isCommunityRef, parseCommunitySettings, type CommunityJson, type CommunityResourceKind, type CommunitySettings } from '../../../shared/community';
import { CommunityDiscordError, type CommunityDiscord } from './discord';
import { planRoomMaintenance } from './room-plan';
import { safeCommunityText } from './security';
import { CommunityStore, CommunityStoreError, type CommunityActor, type CommunityJsonObject, type RoomPatch, type StoredOperation, type StoredResource, type StoredRoom } from './store';

export interface CommunityExecutionActor { memberRef: string | null; isAdmin: boolean }
export interface CommunityEngineOptions {
  authorize: (actor: CommunityActor) => Promise<CommunityExecutionActor>;
  isReadOnly?: () => boolean;
  executeExtra?: (operation: StoredOperation, actor: CommunityExecutionActor, beforeEffect: () => Promise<void>) => Promise<CommunityJson>;
  welcome?: (memberId: string) => Promise<void>;
  now?: () => number; onError?: (error: unknown) => void; intervalMs?: number;
}
function fail(code: string, message: string, status = 409): never { throw new CommunityStoreError(status, code, message); }
const data = (value: CommunityJson): CommunityJsonObject => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
const millis = (value: string | null): number | null => value === null ? null : Date.parse(value);
const iso = (value: number | null): string | null => value === null ? null : new Date(value).toISOString();

/** The queue is durable; this process-local lock only prevents Gateway callbacks
 * and the timer from racing the same runtime's reconciliation. Every mutation
 * still uses a database lease, fresh identity and optimistic room version. */
export class CommunityEngine {
  private timer: ReturnType<typeof setInterval> | undefined;
  private pending: Promise<unknown> = Promise.resolve();
  private stopped = false;
  private lastSync = 0;
  private readonly now: () => number;
  constructor(private readonly store: CommunityStore, private readonly discord: CommunityDiscord, private readonly options: CommunityEngineOptions) { this.now = options.now ?? Date.now; }
  private serial<T>(work: () => Promise<T>): Promise<T> { const next = this.pending.then(work); this.pending = next.catch(() => undefined); return next; }
  async start(): Promise<void> {
    this.stopped = false; await this.sync();
    if (!this.timer) { this.timer = setInterval(() => { void this.tick().catch(error => this.options.onError?.(error)); }, this.options.intervalMs ?? 5000); this.timer.unref?.(); }
  }
  async stop(): Promise<void> { this.stopped = true; if (this.timer) clearInterval(this.timer); this.timer = undefined; await this.pending; await this.store.setRuntime({ ready: false, problem: 'bot_offline' }); }
  sync(): Promise<boolean> { return this.serial(() => this.syncNow()); }
  private async syncNow(): Promise<boolean> {
    try {
      if (this.options.isReadOnly?.()) { await this.store.setRuntime({ ready: false, problem: 'read_only' }); return false; }
      const continuous = this.lastSync !== 0 && (await this.store.runtime()).ready;
      await this.store.setRuntime({ ready: false, problem: 'bot_offline' });
      const snapshot = await this.discord.snapshot();
      if (!snapshot.ready) { await this.store.setRuntime({ ready: false, problem: 'bot_offline' }); return false; }
      const seen: string[] = [];
      const members = new Map(snapshot.members.map(member => [member.id, member]));
      for (const resource of snapshot.resources) {
        const member = members.get(resource.id);
        const previous = await this.store.resourceByExternal(resource.kind, resource.id);
        const stored = await this.store.upsertResource(resource.kind, resource.id, safeCommunityText(resource.name).slice(0, 100) || '社区成员', {
          available: resource.available, safe: resource.safe, metadata: {
            ...previous?.metadata, ...resource.metadata as CommunityJsonObject,
            ...(member ? { bot: member.bot, protected: member.protected, roleIds: member.roleIds, joinedAt: member.joinedAt } : {}),
          },
        }); seen.push(stored.ref);
      }
      // Only a complete REST snapshot can make a former resource unavailable.
      await this.store.pool.query('UPDATE community_resources SET available=false WHERE guild_id=$1 AND NOT(ref=ANY($2::uuid[]))', [this.store.guildId, seen]);
      await this.store.recoverExpired();
      // Expired executors may have changed access just before crashing. Hide
      // unconfirmed rooms before publishing a new ready snapshot.
      for (const room of await this.store.listRooms()) {
        if (room.status === 'needs_review') continue;
        if (await this.awaitingReview(room)) await this.store.patchRoom(room.ref, { status: 'needs_review' }, room.version);
      }
      await this.recoverCreations();
      await this.recoverTrackedRooms();
      if (!continuous) for (const room of await this.store.listRooms()) {
        if (room.status === 'active' && (room.emptySince || room.cleanupAt || room.ownerLeftAt))
          await this.store.patchRoom(room.ref, { emptySince: null, cleanupAt: null, ownerLeftAt: null }, room.version);
      }
      await this.store.setRuntime({ ready: true, syncedAt: iso(this.now()), problem: null });
      this.lastSync = this.now();
      return true;
    } catch (error) { await this.store.setRuntime({ ready: false, problem: error instanceof CommunityDiscordError && error.status === 403 ? 'permissions_missing' : 'bot_offline' }); this.options.onError?.(error); return false; }
  }
  private async recoverCreations(): Promise<void> {
    const settings = (await this.store.settings()).settings;
    const category = settings.rooms.categoryRef ? await this.store.resource(settings.rooms.categoryRef, 'category') : null;
    for (const room of await this.store.listRooms()) {
      if (room.channelRef || !['creating', 'needs_review'].includes(room.status) || typeof room.metadata.operationRef !== 'string') continue;
      const operation = await this.store.getOperation(room.metadata.operationRef);
      // A live lease belongs to another process; only expired/uncertain work is recovered.
      if (!operation || !['needs_review', 'failed', 'canceled'].includes(operation.status)) continue;
      try {
        const channelId = await this.discord.findCreatedVoice(room.metadata.operationRef);
        if (!channelId) { if (room.status !== 'needs_review') await this.store.patchRoom(room.ref, { status: 'needs_review' }, room.version); continue; }
        const channel = await this.discord.channel(channelId);
        if (!category?.available || !channel || channel.kind !== 'voice' || channel.parentId !== category.externalId) fail('resource_missing', '创建结果已移出受管分类');
        const resource = await this.store.upsertResource('voice', channelId, safeCommunityText(channel.name), { available: true, metadata: { parentId: channel.parentId } });
        await this.store.patchRoom(room.ref, { status: 'active', channelRef: resource.ref, name: safeCommunityText(channel.name) }, room.version);
        await this.store.resolveRecoveredOperation(operation.ref, { roomRef: room.ref });
        await this.store.addAudit({ source: 'system' }, 'room.recover', room.ref, 'succeeded');
      } catch (error) { if (room.status !== 'needs_review') await this.store.patchRoom(room.ref, { status: 'needs_review' }, room.version); this.options.onError?.(error); }
    }
  }
  private async awaitingReview(room: StoredRoom): Promise<boolean> {
    const pending = await this.store.pool.query(`SELECT 1 FROM community_operations WHERE guild_id=$1 AND status='needs_review'
      AND (room_ref=$2 OR ref::text=$3) LIMIT 1`, [this.store.guildId, room.ref, typeof room.metadata.operationRef === 'string' ? room.metadata.operationRef : null]);
    return pending.rows.length > 0;
  }
  private async recoverTrackedRooms(): Promise<void> {
    for (const room of await this.store.listRooms()) {
      if (room.status !== 'needs_review' || !room.channelRef || await this.awaitingReview(room)) continue;
      try {
        const channel = await this.store.resource(room.channelRef, 'voice');
        if (!channel) continue;
        const current = await this.discord.channel(channel.externalId);
        if (!current) { await this.store.patchRoom(room.ref, { status: 'closed', cleanupAt: null, transferToRef: null, transferExpiresAt: null }, room.version); continue; }
        const config = (await this.store.settings()).settings;
        const category = config.rooms.categoryRef ? await this.store.resource(config.rooms.categoryRef, 'category') : null;
        const owner = room.ownerRef ? await this.store.resource(room.ownerRef, 'member') : null;
        if (!category?.available || !owner || current.kind !== 'voice' || current.parentId !== category.externalId || !this.discord.inspectRoom) continue;
        const state = await this.discord.inspectRoom(channel.externalId, owner.externalId);
        if (!state) continue;
        const acl: Array<{ ref: string; allowed: boolean }> = [];
        for (const [ids, allowed] of [[state.allowedMemberIds, true], [state.blockedMemberIds, false]] as const) for (const id of ids) {
          const member = await this.store.resourceByExternal('member', id);
          if (!member) fail('resource_missing', '房间成员权限尚未完整映射');
          acl.push({ ref: member.ref, allowed });
        }
        const occupants = this.discord.occupants(channel.externalId); if (occupants === null) continue;
        const present: string[] = [];
        for (const id of occupants) {
          const member = await this.store.resourceByExternal('member', id);
          if (!member) fail('resource_missing', '房间成员状态尚未完整映射'); present.push(member.ref);
        }
        // Access is rebuilt while quarantined; ordinary readers cannot see a
        // partially rebuilt ACL. Only a verified complete projection is active.
        for (const access of await this.store.roomAccess(room.ref)) await this.store.setRoomAccess(room.ref, access.memberRef, { allowed: false, blocked: false, present: false });
        for (const access of acl) await this.store.setRoomAccess(room.ref, access.ref, { allowed: access.allowed, blocked: !access.allowed });
        for (const ref of present) await this.store.setRoomAccess(room.ref, ref, { present: true });
        await this.store.patchRoom(room.ref, { status: 'active', name: safeCommunityText(state.name), userLimit: state.userLimit,
          visibility: state.visibility, transferToRef: null, transferExpiresAt: null, emptySince: null, cleanupAt: null, ownerLeftAt: null }, room.version);
        await this.store.addAudit({ source: 'system' }, 'room.reconcile', room.ref, 'succeeded');
      } catch (error) { this.options.onError?.(error); }
    }
  }
  tick(): Promise<void> { return this.serial(async () => {
    if (this.stopped) return;
    if (this.now() - this.lastSync >= 30_000 && !await this.syncNow()) return;
    if (this.options.isReadOnly?.()) return;
    await this.maintenance();
    for (let i = 0; i < 10; i += 1) if (!await this.runNow()) break;
  }); }
  runOne(): Promise<boolean> { return this.serial(() => this.runNow()); }
  private async resource(ref: string | null | undefined, kind: CommunityResourceKind): Promise<StoredResource> {
    const value = ref ? await this.store.resource(ref, kind) : null;
    if (!value?.available) return fail('resource_missing', '目标资源已不可用'); return value;
  }
  private async member(ref: string | null | undefined): Promise<{ resource: StoredResource; id: string; protected: boolean }> {
    const resource = await this.resource(ref, 'member'), member = await this.discord.member(resource.externalId);
    if (!member || member.bot) return fail('membership_required', '需要当前服务器成员身份', 403);
    return { resource, id: member.id, protected: member.protected };
  }
  private async managed(room: StoredRoom, settings: CommunitySettings): Promise<StoredResource> {
    const resource = room.channelRef ? await this.store.resource(room.channelRef, 'voice') : null;
    if (!resource) return fail('resource_missing', '房间资源不可用');
    const channel = await this.discord.channel(resource.externalId);
    if (!channel) {
      // A fresh REST 404 proves manual deletion; a missing/unknown Gateway
      // snapshot alone never releases the room or destroys history.
      await this.store.patchRoom(room.ref, { status: 'closed', cleanupAt: null, transferToRef: null, transferExpiresAt: null }, room.version);
      return fail('resource_missing', '房间已在 Discord 删除');
    }
    const category = await this.resource(settings.rooms.categoryRef, 'category');
    if (channel.kind !== 'voice' || channel.parentId !== category.externalId) {
      if (room.status !== 'needs_review') await this.store.patchRoom(room.ref, { status: 'needs_review' }, room.version);
      return fail('resource_missing', '房间已移出受管范围');
    }
    return resource;
  }
  private async authority(op: StoredOperation): Promise<CommunityExecutionActor> {
    if (this.options.isReadOnly?.()) return fail('read_only', '系统维护中');
    if (op.expiresAt && Date.parse(op.expiresAt) <= this.now()) return fail('operation_expired', '操作已过期');
    if (!op.claimToken || !await this.store.renew(op.ref, op.claimToken, 300)) return fail('version_conflict', '执行租约已失效');
    if (op.actor.source === 'system') {
      if (!['room.cleanup', 'welcome.send'].includes(op.kind)) return fail('not_owner', '不允许此系统操作', 403);
      return { memberRef: null, isAdmin: false };
    }
    const actor = await this.options.authorize(op.actor);
    if ((op.actor.memberRef ?? null) !== actor.memberRef) return fail('version_conflict', '账号绑定已变化');
    return actor;
  }
  private async runNow(): Promise<boolean> {
    if (this.stopped) return false;
    const op = await this.store.claim(300); if (!op) return false;
    let changed = false, createdRoom: StoredRoom | null = null;
    let executionRoom: StoredRoom | null = null, requiredAdmin = false;
    let checkedActor: CommunityExecutionActor | null = null;
    const guard = async (): Promise<void> => {
      const current = await this.authority(op); checkedActor = current;
      if (requiredAdmin && !current.isAdmin) fail('not_owner', '管理员权限已变化', 403);
      if (op.actor.source !== 'system' && current.memberRef) await this.member(current.memberRef);
      if (executionRoom) {
        const latest = await this.store.getRoom(executionRoom.ref);
        if (!latest || latest.status !== 'active' || latest.version !== executionRoom.version) fail('version_conflict', '房间已变化');
        const action = op.kind.slice(5);
        if (!['cleanup', 'accept', 'claim', 'join'].includes(action) && !current.isAdmin && latest.ownerRef !== current.memberRef) fail('not_owner', '房主或权限已变化', 403);
      }
    };
    const effect = async <T>(work: () => Promise<T>): Promise<T> => { await guard(); const result = await work(); changed = true; return result; };
    try {
      const actor = await this.authority(op), stored = await this.store.settings(), settings = stored.settings, payload = data(op.payload);
      let result: CommunityJson = {};
      if (op.kind === 'resources.sync') {
        requiredAdmin = true; if (!actor.isAdmin) fail('not_owner', '需要管理员权限', 403);
        if (!await this.syncNow()) fail('bot_offline', '机器人尚未就绪'); result = { synced: true };
      } else if (op.kind === 'settings.apply' || op.kind === 'panel.refresh') {
        requiredAdmin = true; if (!actor.isAdmin) fail('not_owner', '需要管理员权限', 403);
        if (op.kind === 'settings.apply' && payload.version !== stored.version) fail('version_conflict', '设置已更新');
        const config = op.kind === 'settings.apply' ? parseCommunitySettings(payload.settings) : settings;
        await this.validateSettings(config);
        if (config.enabled && config.rooms.enabled && config.rooms.panelRef) {
          const panel = await this.resource(config.rooms.panelRef, 'text');
          const messageId = await effect(() => this.discord.sendPanel(panel.externalId, typeof panel.metadata.panelMessageId === 'string' ? panel.metadata.panelMessageId : null));
          await this.store.upsertResource('text', panel.externalId, panel.name, { available: true, metadata: { ...panel.metadata, panelMessageId: messageId } });
        }
        await this.authority(op); if (op.kind === 'settings.apply') await this.store.setRuntime({ appliedVersion: stored.version, problem: null }); result = { appliedVersion: stored.version };
      } else {
        if (!stored.runtime.ready) fail('bot_offline', '机器人尚未就绪');
        if (stored.runtime.appliedVersion !== stored.version) fail('version_conflict', '请等待设置应用完成');
        if (op.kind === 'room.create') {
          if (!settings.enabled || !settings.rooms.enabled) fail('feature_disabled', '自助房间已停用');
          const owner = await this.member(actor.memberRef), category = await this.resource(settings.rooms.categoryRef, 'category');
          const source = this.discord.channelOf(owner.id), creator = await this.resource(settings.rooms.creatorRef, 'voice');
          if (!source || payload.creatorOnly === true && source !== creator.externalId) fail('membership_required', '请先进入语音频道', 403);
          if ((await this.store.listRooms()).some(room => room.ownerRef === actor.memberRef)) fail('version_conflict', '你已经有一个有效房间');
          const past = (await this.store.listRooms({ includeClosed: true })).filter(room => room.ownerRef === actor.memberRef);
          if (past.some(room => this.now() - Date.parse(room.createdAt) < settings.rooms.cooldownSeconds * 1000)) fail('rate_limited', '创建过于频繁');
          const name = safeCommunityText(typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : `${owner.resource.name} 的房间`).slice(0, 100);
          createdRoom = await this.store.createRoom(owner.resource.ref, name, { visibility: settings.rooms.visibility, userLimit: settings.rooms.userLimit, maxRooms: settings.rooms.maxRooms, metadata: { operationRef: op.ref, categoryRef: category.ref } });
          const channelId = await effect(() => this.discord.createVoice(category.externalId, name, owner.id, settings.rooms.visibility, settings.rooms.userLimit, op.ref));
          const actual = await this.discord.channel(channelId);
          if (!actual || actual.kind !== 'voice' || actual.parentId !== category.externalId) throw new CommunityDiscordError(409, '创建结果需要对账', true);
          const resource = await this.store.upsertResource('voice', channelId, name, { available: true, metadata: { parentId: category.externalId } });
          createdRoom = await this.store.patchRoom(createdRoom.ref, { channelRef: resource.ref, status: 'active' }, createdRoom.version);
          executionRoom = { ...createdRoom };
          // A delayed create must never pull a disconnected member back into voice.
          if (this.discord.channelOf(owner.id) === source && await this.discord.canConnect(owner.id, channelId)) await effect(() => this.discord.move(owner.id, channelId));
          result = { roomRef: createdRoom.ref };
        } else if (op.kind.startsWith('room.')) {
          const room = op.roomRef ? await this.store.getRoom(op.roomRef) : null;
          if (!room || room.status !== 'active') fail('resource_missing', '房间当前不可操作');
          if (op.expectedVersion !== null && room.version !== op.expectedVersion) fail('version_conflict', '房间已变化');
          executionRoom = { ...room };
          const action = op.kind.slice(5), channel = await this.managed(room, settings);
          requiredAdmin = action === 'admin_delete';
          const current = actor.memberRef ? await this.member(actor.memberRef) : null;
          if (!['cleanup', 'accept', 'claim', 'join'].includes(action) && !actor.isAdmin && room.ownerRef !== actor.memberRef) fail('not_owner', '当前账号没有房间管理权限', 403);
          let patch: RoomPatch = {};
          if (action === 'join') {
            if (!current || !this.discord.channelOf(current.id)) fail('membership_required', '请先连接语音频道', 403);
            const access = await this.store.roomAccess(room.ref);
            if (access.some(item => item.memberRef === actor.memberRef && item.blocked) || !await this.discord.canConnect(current.id, channel.externalId)) fail('resource_missing', '房间不可加入', 404);
            const source = this.discord.channelOf(current.id);
            await effect(async () => {
              if (!source || this.discord.channelOf(current.id) !== source) fail('version_conflict', '语音位置已变化');
              await this.discord.move(current.id, channel.externalId);
            });
          } else if (action === 'rename') {
            if (typeof payload.name !== 'string' || !payload.name.trim() || payload.name.length > 100) fail('invalid_input', '名称无效', 400);
            const name = safeCommunityText(payload.name.trim()); await effect(() => this.discord.rename(channel.externalId, name)); patch.name = name;
          } else if (action === 'limit') {
            if (typeof payload.userLimit !== 'number' || !Number.isInteger(payload.userLimit) || payload.userLimit < 0 || payload.userLimit > settings.rooms.maxUserLimit) fail('invalid_input', '人数上限无效', 400);
            await effect(() => this.discord.setLimit(channel.externalId, payload.userLimit as number)); patch.userLimit = payload.userLimit;
          } else if (action === 'visibility') {
            if (!['open', 'locked', 'hidden'].includes(String(payload.visibility))) fail('invalid_input', '可见性无效', 400);
            const owner = await this.member(room.ownerRef); await effect(() => this.discord.setVisibility(channel.externalId, owner.id, payload.visibility as StoredRoom['visibility'])); patch.visibility = payload.visibility as StoredRoom['visibility'];
          } else if (['grant', 'deny', 'kick', 'transfer'].includes(action)) {
            const target = await this.member(typeof payload.memberRef === 'string' ? payload.memberRef : null);
            if (['deny', 'kick'].includes(action) && (target.protected || target.resource.ref === room.ownerRef)) fail('not_owner', '不能移除此成员', 403);
            if (action === 'transfer') {
              if (target.resource.ref === room.ownerRef || !await this.discord.canView(target.id, channel.externalId)) fail('resource_missing', '目标成员无法查看房间', 404);
              if ((await this.store.listRooms()).some(other => other.ref !== room.ref && other.ownerRef === target.resource.ref)) fail('version_conflict', '对方已有房间');
              patch = { transferToRef: target.resource.ref, transferExpiresAt: iso(this.now() + 300_000) };
            } else if (action === 'grant') { await effect(() => this.discord.grant(channel.externalId, target.id)); await this.store.setRoomAccess(room.ref, target.resource.ref, { allowed: true, blocked: false }); }
            else if (action === 'deny') {
              await effect(() => this.discord.deny(channel.externalId, target.id)); await this.store.setRoomAccess(room.ref, target.resource.ref, { allowed: false, blocked: true });
              if (this.discord.channelOf(target.id) === channel.externalId) await effect(() => this.discord.move(target.id, null));
            } else {
              if (this.discord.channelOf(target.id) !== channel.externalId) fail('resource_missing', '成员已不在房间', 404);
              await effect(() => this.discord.move(target.id, null));
            }
          } else if (action === 'accept' || action === 'claim') {
            if (!current) fail('membership_required', '需要当前服务器成员身份', 403);
            if ((await this.store.listRooms()).some(other => other.ref !== room.ref && other.ownerRef === actor.memberRef)) fail('version_conflict', '你已经有房间');
            if (!await this.discord.canView(current.id, channel.externalId)) fail('resource_missing', '房间不可见', 404);
            if (action === 'accept') {
              if (room.transferToRef !== actor.memberRef || !room.transferExpiresAt || Date.parse(room.transferExpiresAt) <= this.now()) fail('not_owner', '转让邀请已失效', 403);
            } else {
              const occupants = this.discord.occupants(channel.externalId), oldOwner = room.ownerRef ? await this.store.resource(room.ownerRef, 'member') : null;
              if (!occupants || !occupants.includes(current.id) || oldOwner && occupants.includes(oldOwner.externalId) || room.ownerLeftAt === null || this.now() < Date.parse(room.ownerLeftAt) + settings.rooms.ownerGraceSeconds * 1000) fail('not_owner', '现在不能认领', 403);
            }
            await effect(() => this.discord.grant(channel.externalId, current.id));
            await this.store.setRoomAccess(room.ref, current.resource.ref, { allowed: true, blocked: false });
            patch = { ownerRef: current.resource.ref, transferToRef: null, transferExpiresAt: null, ownerLeftAt: this.discord.channelOf(current.id) === channel.externalId ? null : iso(this.now()) };
          } else if (['dissolve', 'admin_delete', 'cleanup'].includes(action)) {
            let occupants = this.discord.occupants(channel.externalId); if (!occupants) fail('bot_offline', '语音状态尚未就绪');
            if (action === 'admin_delete') {
              if (!actor.isAdmin || payload.confirm !== true) fail('not_owner', '需要管理员明确确认', 403);
              const waiting = await this.resource(settings.rooms.waitingRef, 'voice');
              if (waiting.externalId === channel.externalId || settings.rooms.waitingRef === settings.rooms.creatorRef) fail('invalid_input', '等候区配置无效');
              for (const id of occupants) {
                if (!await this.discord.canConnect(id, waiting.externalId)) fail('permissions_missing', '成员无法进入等候区');
                await effect(() => this.discord.move(id, waiting.externalId));
              }
              occupants = this.discord.occupants(channel.externalId); if (!occupants) fail('bot_offline', '语音状态尚未就绪');
            } else if (action === 'cleanup') {
              if (op.actor.source !== 'system' || !room.cleanupAt || Date.parse(room.cleanupAt) > this.now()) fail('version_conflict', '尚未到清理时间');
            }
            if (occupants.length) fail('version_conflict', '房主只能解散空房间');
            await effect(async () => {
              const latest = this.discord.occupants(channel.externalId);
              if (!latest || latest.length) fail('version_conflict', '房间状态已变化，取消删除');
              await this.discord.delete(channel.externalId);
            }); patch.status = 'closed';
          } else fail('invalid_input', '不支持此房间操作', 400);
          await guard(); await this.store.patchRoom(room.ref, Object.keys(patch).length ? patch : { name: room.name }, room.version); executionRoom = null;
          result = { roomRef: room.ref };
        } else if (this.options.executeExtra) { result = await effect(() => this.options.executeExtra!(op, checkedActor ?? actor, guard)); }
        else fail('invalid_input', '不支持此操作', 400);
      }
      await guard();
      if (await this.store.finish(op.ref, op.claimToken!, { status: 'succeeded', result })) await this.store.addAudit(op.actor, op.kind, op.roomRef ?? createdRoom?.ref ?? null, 'succeeded');
    } catch (error) {
      const uncertain = changed || error instanceof CommunityDiscordError && error.uncertain;
      if (createdRoom && !changed && error instanceof CommunityDiscordError && !error.uncertain) {
        const pending = await this.store.getRoom(createdRoom.ref);
        if (pending?.status === 'creating' && !pending.channelRef) await this.store.patchRoom(pending.ref, { status: 'closed' }, pending.version).catch(() => undefined);
      }
      if (createdRoom && (uncertain || changed)) {
        const current = await this.store.getRoom(createdRoom.ref); if (current && current.status !== 'needs_review' && current.status !== 'closed') await this.store.patchRoom(current.ref, { status: 'needs_review' }, current.version).catch(() => undefined);
      }
      if (uncertain && op.roomRef) {
        const room = await this.store.getRoom(op.roomRef);
        if (room && room.status !== 'closed' && room.status !== 'needs_review') await this.store.patchRoom(room.ref, { status: 'needs_review' }, room.version).catch(() => undefined);
      }
      const code = uncertain ? 'execution_uncertain' : error instanceof CommunityStoreError ? error.code : error instanceof CommunityDiscordError && error.status === 403 ? 'permissions_missing' : 'discord_error';
      const status = uncertain ? 'needs_review' : error instanceof CommunityStoreError && ['version_conflict', 'room_exists', 'room_limit'].includes(error.code) ? 'conflict' : 'failed';
      if (await this.store.finish(op.ref, op.claimToken!, { status, error: code })) await this.store.addAudit(op.actor, op.kind, op.roomRef ?? createdRoom?.ref ?? null, status);
      this.options.onError?.(error);
    }
    return true;
  }
  private async validateSettings(config: CommunitySettings): Promise<void> {
    if (config.enabled && config.rooms.enabled) {
      await this.resource(config.rooms.categoryRef, 'category'); await this.resource(config.rooms.creatorRef, 'voice');
      if (config.rooms.waitingRef) await this.resource(config.rooms.waitingRef, 'voice');
      if (config.rooms.panelRef) await this.resource(config.rooms.panelRef, 'text');
    }
    if (config.enabled && config.welcome.enabled) { const channel = await this.resource(config.welcome.channelRef, 'text'); if (channel.metadata.publicView !== true) fail('permissions_missing', '欢迎频道必须向全体成员公开'); }
    for (const ref of config.roles.allowedRefs) if (!(await this.resource(ref, 'role')).safe) fail('permissions_missing', '身份白名单包含不安全身份');
  }
  private async maintenance(): Promise<void> {
    if (!(await this.store.runtime()).ready) return;
    const settings = (await this.store.settings()).settings;
    for (let room of await this.store.listRooms()) {
      if (room.status !== 'active') continue;
      let channel: StoredResource; try { channel = await this.managed(room, settings); } catch { continue; }
      const occupants = this.discord.occupants(channel.externalId); if (!occupants) continue;
      const refs: string[] = [];
      for (const id of occupants) { const resource = await this.store.resourceByExternal('member', id); if (resource) refs.push(resource.ref); }
      const access = await this.store.roomAccess(room.ref);
      for (const item of access) if (item.present !== refs.includes(item.memberRef)) await this.store.setRoomAccess(room.ref, item.memberRef, { present: refs.includes(item.memberRef) });
      for (const ref of refs) if (!access.some(item => item.memberRef === ref)) await this.store.setRoomAccess(room.ref, ref, { present: true });
      const owner = room.ownerRef ? await this.store.resource(room.ownerRef, 'member') : null;
      const plan = planRoomMaintenance({ status: room.status, ownerLeftAt: millis(room.ownerLeftAt), emptySince: millis(room.emptySince), cleanupAt: millis(room.cleanupAt) }, { count: occupants.length, ownerPresent: !!owner && occupants.includes(owner.externalId) }, settings.rooms, this.now());
      if (Object.keys(plan.patch).length) room = await this.store.patchRoom(room.ref, Object.fromEntries(Object.entries(plan.patch).map(([key, value]) => [key, iso(value as number | null)])), room.version);
      if (plan.remove) await this.store.enqueue('room.cleanup', room.ref, { source: 'system' }, {}, `cleanup:${room.ref}:${room.cleanupAt}`, room.version);
      if (room.transferExpiresAt && Date.parse(room.transferExpiresAt) <= this.now()) await this.store.patchRoom(room.ref, { transferToRef: null, transferExpiresAt: null }, room.version);
    }
  }
  onVoice(memberId: string, channelId?: string | null): Promise<void> { return this.serial(async () => {
    if (this.stopped || this.options.isReadOnly?.() || !(await this.store.runtime()).ready) return;
    await this.maintenance();
    const config = (await this.store.settings()).settings;
    if (!config.enabled || !config.rooms.enabled || !config.rooms.creatorRef) return;
    const creator = await this.resource(config.rooms.creatorRef, 'voice'); if (channelId !== creator.externalId || this.discord.channelOf(memberId) !== creator.externalId) return;
    const member = await this.discord.member(memberId); if (!member || member.bot) return;
    const resource = await this.store.upsertResource('member', member.id, safeCommunityText(member.name), { available: true, metadata: { bot: false, protected: member.protected, roleIds: member.roleIds, joinedAt: member.joinedAt } });
    const rooms = await this.store.listRooms({ includeClosed: true }); const active = rooms.find(room => room.ownerRef === resource.ref && room.status !== 'closed');
    if (active) return;
    const last = rooms.filter(room => room.ownerRef === resource.ref).at(-1);
    await this.store.enqueue('room.create', null, { source: 'discord', memberRef: resource.ref }, { creatorOnly: true }, `voice-create:${resource.ref}:${randomUUID()}`);
    await this.runNow();
  }); }
  async onMemberJoin(memberId: string): Promise<void> { if (!this.stopped) await this.options.welcome?.(memberId); }
}
