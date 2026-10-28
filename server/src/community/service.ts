import { getUserById } from '../../../worker/db';
import { linkByDiscordId, linkByUserId } from '../discord/links';
import { isCommunityRef, parseCommunitySettings, type CommunityJson, type CommunityMemberView, type CommunityOverview,
  type CommunityResourceKind, type CommunityResourceView, type CommunityRoomView, type CommunitySettings } from '../../../shared/community';
import { canReadRoom, publicCommunityJson, publicCommunitySettings, safeCommunityText } from './security';
import { CommunityStore, CommunityStoreError, operationView, type CommunityActor, type StoredOperation, type StoredRoom, type StoredResource } from './store';

export interface CommunityWebActor {
  userId: string | null; linked: boolean; memberRef: string | null; isAdmin: boolean; memberAvailable: boolean;
}
function fail(status: number, code: string, message: string): never { throw new CommunityStoreError(status, code, message); }
const missing = (): never => fail(404, 'not_found', '内容不存在');
function fields(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) return fail(400, 'invalid_input', '请求字段无效');
  return value as Record<string, unknown>;
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) return fail(400, 'invalid_input', '数值超出允许范围');
  return value;
}
function text(value: unknown, max = 100): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\u0000')) return fail(400, 'invalid_input', '名称或内容格式无效');
  return safeCommunityText(value.trim());
}
const safeResource = (resource: StoredResource): CommunityResourceView => ({ ref: resource.ref, kind: resource.kind, name: safeCommunityText(resource.name), available: resource.available, safe: resource.safe });

export class CommunityService {
  constructor(public readonly store: CommunityStore, public readonly db: D1Database) {}
  private async identity(userId: string | null, member: StoredResource | null, linked: boolean, isAdmin: boolean): Promise<CommunityWebActor> {
    return { userId, linked, memberRef: member?.ref ?? null, isAdmin,
      memberAvailable: !!member?.available && member.metadata.bot !== true && (await this.store.runtime()).ready };
  }
  async actorFromWeb(userId: string): Promise<CommunityWebActor> {
    const user = await getUserById(this.db, userId); if (!user) return fail(401, 'unauthorized', '未登录');
    const link = await linkByUserId(this.db, userId);
    const member = link ? await this.store.resourceByExternal('member', link.discord_user_id) : null;
    return this.identity(userId, member, !!link, user.is_admin === 1);
  }
  async actorFromDiscord(externalId: string): Promise<CommunityWebActor> {
    const member = await this.store.resourceByExternal('member', externalId);
    const link = await linkByDiscordId(this.db, externalId);
    const user = link ? await getUserById(this.db, link.user_id) : null;
    return this.identity(user?.id ?? null, member, !!link, user?.is_admin === 1);
  }
  async actorForExecution(actor: CommunityActor): Promise<CommunityWebActor> {
    if (actor.source === 'web') return this.actorFromWeb(actor.userId ?? '');
    if (actor.source === 'system') return { userId: null, linked: false, memberRef: actor.memberRef ?? null, isAdmin: true, memberAvailable: false };
    const member = actor.memberRef ? await this.store.resource(actor.memberRef, 'member') : null;
    return member ? this.actorFromDiscord(member.externalId) : this.identity(null, null, false, false);
  }
  private requireAdmin(actor: CommunityWebActor): void { if (!actor.isAdmin) fail(403, 'forbidden', '需要管理员权限'); }
  private requireMember(actor: CommunityWebActor): void {
    if (!actor.memberAvailable || !actor.memberRef) fail(403, 'membership_required', actor.linked ? '需要当前服务器成员身份' : '请先绑定 Discord');
  }
  async overview(userId: string): Promise<CommunityOverview> {
    const actor = await this.actorFromWeb(userId); const stored = await this.store.settings();
    const candidate = actor.memberRef ? await this.store.resource(actor.memberRef, 'member') : null;
    const member = candidate?.available && candidate.metadata.bot !== true ? candidate : null;
    return { settings: publicCommunitySettings(stored.settings), version: stored.version, runtime: stored.runtime,
      me: { linked: actor.linked, member: member ? { ref: member.ref, name: safeCommunityText(member.name) } : null,
        isAdmin: actor.isAdmin, needsMembership: actor.linked && !member } };
  }
  private async roomForActor(roomRef: string, actor: CommunityWebActor): Promise<StoredRoom> {
    const room = await this.store.getRoom(roomRef); if (!room || room.status === 'closed') return missing();
    if (!canReadRoom(actor, room, await this.store.roomAccess(room.ref))) return missing();
    return room;
  }
  private async memberView(memberRef: string | null): Promise<CommunityMemberView | null> {
    if (!memberRef) return null; const member = await this.store.resource(memberRef, 'member');
    return member ? { ref: member.ref, name: safeCommunityText(member.name) } : null;
  }
  private async roomView(room: StoredRoom, actor: CommunityWebActor): Promise<CommunityRoomView> {
    const access = await this.store.roomAccess(room.ref); const settings = (await this.store.settings()).settings;
    const present = access.filter(item => item.present); const members = (await Promise.all(present.map(item => this.memberView(item.memberRef)))).filter((value): value is CommunityMemberView => value !== null);
    const mine = access.find(item => item.memberRef === actor.memberRef);
    const canClaim = actor.memberAvailable && !!mine?.present && !mine.blocked && room.ownerRef !== actor.memberRef &&
      !present.some(item => item.memberRef === room.ownerRef) && room.ownerLeftAt !== null &&
      Date.now() >= Date.parse(room.ownerLeftAt) + settings.rooms.ownerGraceSeconds * 1000;
    return { ref: room.ref, name: safeCommunityText(room.name), owner: await this.memberView(room.ownerRef), members,
      status: room.status, visibility: room.visibility, userLimit: room.userLimit, version: room.version,
      canManage: actor.isAdmin || (actor.memberAvailable && room.ownerRef === actor.memberRef), canClaim: canClaim && room.status === 'active',
      transferTo: await this.memberView(room.transferToRef), cleanupAt: room.cleanupAt, createdAt: room.createdAt, updatedAt: room.updatedAt };
  }
  async rooms(userId: string): Promise<CommunityRoomView[]> {
    const actor = await this.actorFromWeb(userId); const result: CommunityRoomView[] = [];
    for (const room of await this.store.listRooms()) if (canReadRoom(actor, room, await this.store.roomAccess(room.ref))) result.push(await this.roomView(room, actor));
    return result;
  }
  async room(roomRef: string, userId: string): Promise<CommunityRoomView> {
    const actor = await this.actorFromWeb(userId); return this.roomView(await this.roomForActor(roomRef, actor), actor);
  }
  async resources(userId: string, kind?: CommunityResourceKind): Promise<CommunityResourceView[]> {
    const actor = await this.actorFromWeb(userId);
    if (!actor.isAdmin && kind !== undefined && !['member', 'role'].includes(kind)) fail(403, 'forbidden', '需要管理员权限');
    if (!actor.isAdmin) this.requireMember(actor);
    const settings = (await this.store.settings()).settings;
    return (await this.store.storedResources(kind)).filter(resource => actor.isAdmin ||
      (resource.available && (resource.kind === 'member' ? resource.metadata.bot !== true : resource.kind === 'role' && resource.safe && settings.roles.allowedRefs.includes(resource.ref))))
      .map(safeResource);
  }
  async settings(userId: string) {
    this.requireAdmin(await this.actorFromWeb(userId)); const result = await this.store.settings();
    return { ...result, settings: publicCommunityJson(result.settings as unknown as CommunityJson) as unknown as CommunitySettings };
  }
  private async validateSettings(settings: CommunitySettings): Promise<void> {
    const references: [string | null, CommunityResourceKind, boolean][] = [
      [settings.rooms.categoryRef, 'category', settings.enabled && settings.rooms.enabled],
      [settings.rooms.creatorRef, 'voice', settings.enabled && settings.rooms.enabled],
      [settings.rooms.waitingRef, 'voice', settings.enabled && settings.rooms.enabled],
      [settings.rooms.panelRef, 'text', settings.enabled && settings.rooms.enabled],
      [settings.welcome.channelRef, 'text', settings.enabled && settings.welcome.enabled],
    ];
    for (const [resourceRef, kind, requireAvailable] of references) {
      if (!resourceRef) continue; const resource = await this.store.resource(resourceRef, kind);
      if (!resource || (requireAvailable && !resource.available)) fail(400, 'invalid_resource', '所选资源已不可用或类型不匹配');
    }
    for (const roleRef of settings.roles.allowedRefs) {
      const role = await this.store.resource(roleRef, 'role'); if (!role?.available || !role.safe) fail(400, 'invalid_resource', '身份白名单包含不可安全自选的身份');
    }
  }
  async saveSettings(userId: string, input: unknown, expectedVersion: number, key: string) {
    const actor = await this.actorFromWeb(userId); this.requireAdmin(actor); let settings: CommunitySettings;
    try { settings = parseCommunitySettings(input); } catch { return fail(400, 'invalid_input', '社区设置格式或范围无效'); }
    await this.validateSettings(settings);
    const saved = await this.store.saveSettingsAndEnqueue(settings, expectedVersion, { source: 'web', userId, ...(actor.memberRef ? { memberRef: actor.memberRef } : {}) }, key);
    return { settings: publicCommunityJson(saved.settings as unknown as CommunityJson), version: saved.version, runtime: saved.runtime, operation: operationView(saved.operation) };
  }
  async enqueue(userId: string, kind: string, roomRef: string | null, payload: unknown, key: string, version?: number) {
    const actor = await this.actorFromWeb(userId);
    return operationView(await this.enqueueForActor({ source: 'web', userId, ...(actor.memberRef ? { memberRef: actor.memberRef } : {}) }, kind, roomRef, payload, key, version));
  }
  /** Trusted Bot entry point; HTTP callers never supply a CommunityActor. */
  async enqueueForActor(actor: CommunityActor, kind: string, roomRef: string | null, input: unknown, key: string, version?: number): Promise<StoredOperation> {
    const authority = await this.actorForExecution(actor); const settings = (await this.store.settings()).settings;
    let payload: Record<string, unknown> = {};
    if (kind === 'resources.sync' || kind === 'panel.refresh') {
      this.requireAdmin(authority); payload = fields(input, []);
    } else if (kind === 'room.create') {
      this.requireMember(authority); if (!settings.enabled || !settings.rooms.enabled) fail(409, 'feature_disabled', '自助房间已停用');
      payload = fields(input, ['name']); if (payload.name !== undefined) payload = typeof payload.name === 'string' && !payload.name.trim() ? {} : { name: text(payload.name) };
      if (roomRef !== null) fail(400, 'invalid_input', '创建房间不能指定房间引用');
    } else if (kind.startsWith('room.')) {
      const action = kind.slice(5); const allowed = ['join', 'rename', 'limit', 'visibility', 'grant', 'deny', 'kick', 'transfer', 'accept', 'claim', 'dissolve', 'admin_delete'];
      if (!allowed.includes(action)) fail(400, 'invalid_input', '不支持此房间操作');
      if (!roomRef) return missing(); const room = await this.roomForActor(roomRef, authority); integer(version, 1, Number.MAX_SAFE_INTEGER);
      const view = await this.roomView(room, authority); const access = await this.store.roomAccess(room.ref);
      if (action === 'admin_delete') this.requireAdmin(authority);
      else if (action === 'join') { this.requireMember(authority); if (access.some(item => item.memberRef === authority.memberRef && item.blocked)) return missing(); }
      else if (action === 'claim') { this.requireMember(authority); if (!view.canClaim) fail(403, 'forbidden', '当前不能认领这个房间'); }
      else if (action === 'accept') { this.requireMember(authority); if (room.transferToRef !== authority.memberRef || !room.transferExpiresAt || Date.parse(room.transferExpiresAt) <= Date.now()) fail(403, 'forbidden', '没有待接受的房主转让'); }
      else if (!view.canManage) fail(403, 'not_owner', '当前账号没有房间管理权限');
      const extra = action === 'rename' ? ['name'] : action === 'limit' ? ['userLimit'] : action === 'visibility' ? ['visibility'] : ['grant', 'deny', 'kick', 'transfer'].includes(action) ? ['memberRef'] : action === 'admin_delete' ? ['confirm'] : [];
      payload = { ...fields(input, ['action', ...extra]), action };
      if (action === 'rename') payload.name = text(payload.name);
      if (action === 'limit') payload.userLimit = integer(payload.userLimit, 0, settings.rooms.maxUserLimit);
      if (action === 'visibility' && !['open', 'locked', 'hidden'].includes(String(payload.visibility))) fail(400, 'invalid_input', '房间可见性无效');
      if (extra.includes('memberRef')) {
        if (!isCommunityRef(payload.memberRef)) fail(400, 'invalid_resource', '成员引用无效');
        const member = await this.store.resource(payload.memberRef, 'member'); if (!member?.available || member.metadata.bot === true) fail(400, 'invalid_resource', '成员已不可用');
        if (['deny', 'kick'].includes(action) && (member.metadata.protected === true || member.ref === room.ownerRef)) fail(403, 'forbidden', '不能移除此成员');
        if (action === 'transfer' && member.ref === room.ownerRef) fail(400, 'invalid_input', '请选择其他成员接任房主');
      }
      if (action === 'dissolve' && access.some(item => item.present)) fail(409, 'room_occupied', '房主只能解散空房间');
      if (action === 'admin_delete' && payload.confirm !== true) fail(400, 'confirmation_required', '请确认移往等候区后解散');
    } else if (kind === 'roles.set') {
      this.requireMember(authority); payload = fields(input, ['roleRefs']);
      if (!Array.isArray(payload.roleRefs) || payload.roleRefs.some(value => !isCommunityRef(value))) fail(400, 'invalid_input', '身份引用无效');
      const roles = [...new Set(payload.roleRefs as string[])];
      const selected = (await this.store.pool.query('SELECT role_ref FROM community_role_choices WHERE guild_id=$1 AND member_ref=$2', [this.store.guildId, authority.memberRef])).rows.map(row => String(row.role_ref));
      const onlyRemoves = roles.length < selected.length && roles.every(value => selected.includes(value));
      if (roles.length > settings.roles.maxChoices && !onlyRemoves) fail(400, 'invalid_input', '所选身份数量超出上限');
      for (const roleRef of roles.filter(value => !selected.includes(value))) {
        const role = await this.store.resource(roleRef, 'role');
        if (!settings.enabled || !settings.roles.enabled) fail(409, 'feature_disabled', '自选身份已停用');
        if (!settings.roles.allowedRefs.includes(roleRef) || !role?.available || !role.safe) fail(400, 'invalid_resource', '此身份不在可自选白名单中');
      }
      payload = { roleRefs: roles };
    } else if (kind.startsWith('fun.')) {
      this.requireMember(authority); if (!settings.enabled || !settings.fun.enabled) fail(409, 'feature_disabled', '社区互动已停用');
      if (kind === 'fun.create') {
        payload = fields(input, ['kind', 'input', 'roomRef']);
        if (!settings.fun.enabledTools.includes(payload.kind as never)) fail(400, 'invalid_input', '此互动工具不可用');
        const target = payload.roomRef ?? roomRef; if (target != null) { if (!isCommunityRef(target)) fail(400, 'invalid_resource', '房间引用无效'); await this.roomForActor(target, authority); payload.roomRef = target; roomRef = target; }
      } else if (['fun.vote', 'fun.close', 'fun.redraw'].includes(kind)) {
        payload = fields(input, kind === 'fun.vote' ? ['ref', 'choice'] : ['ref']); if (!isCommunityRef(payload.ref)) return missing();
        const item = (await this.store.pool.query('SELECT creator_ref,room_ref,kind FROM community_fun WHERE guild_id=$1 AND ref=$2', [this.store.guildId, payload.ref])).rows[0]; if (!item) return missing();
        if (item.room_ref) await this.roomForActor(String(item.room_ref), authority);
        if (kind !== 'fun.vote' && !authority.isAdmin && String(item.creator_ref) !== authority.memberRef) fail(403, 'forbidden', '只有发起者或管理员可以操作');
        if (kind === 'fun.vote') payload.choice = integer(payload.choice, 0, 9);
        roomRef = item.room_ref ? String(item.room_ref) : null;
      } else fail(400, 'invalid_input', '不支持此互动操作');
    } else return fail(400, 'invalid_input', '不支持此社区操作');
    return this.store.enqueue(kind, roomRef, actor, payload as CommunityJson, key, version);
  }
  async operation(operationRef: string, userId: string) {
    const actor = await this.actorFromWeb(userId); const operation = await this.store.getOperation(operationRef); if (!operation) return missing();
    if (!actor.isAdmin) {
      // A Nanako session does not retain the former Discord identity after an
      // unlink/rebind, and former administrators cannot inspect privileged jobs.
      if (['settings.apply', 'resources.sync', 'panel.refresh', 'room.admin_delete'].includes(operation.kind) ||
        !actor.memberAvailable || !actor.memberRef || operation.actor.memberRef !== actor.memberRef) return missing();
    }
    if (operation.roomRef) {
      const room = await this.store.getRoom(operation.roomRef);
      if (!room || !canReadRoom(actor, room, await this.store.roomAccess(room.ref))) return missing();
      // A successful delete still needs a receipt. Do not resurrect the closed
      // room's details or embedded interaction content through its operation.
      if (room.status === 'closed') return { ...operationView(operation), result: { roomRef: room.ref } };
    }
    return operationView(operation);
  }
  async operations(userId: string) { this.requireAdmin(await this.actorFromWeb(userId)); return this.store.listOperations(); }
  async audit(userId: string) { this.requireAdmin(await this.actorFromWeb(userId)); return this.store.audit(); }
}
