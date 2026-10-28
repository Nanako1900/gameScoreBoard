// Discord-only boundary. Every identifier in this module is internal; API DTOs
// must resolve resources through the opaque references owned by CommunityStore.
import { ChannelType, PermissionFlagsBits as P, Routes, type Client } from 'discord.js';
import type { CommunityResourceKind, CommunityVisibility } from '../../../shared/community';

export interface CommunityDiscordResource {
  id: string;
  name: string;
  kind: CommunityResourceKind;
  available: boolean;
  safe?: boolean;
  metadata?: Record<string, unknown>;
}
export interface CommunityDiscordMember {
  id: string;
  name: string;
  bot: boolean;
  roleIds: string[];
  protected: boolean;
  joinedAt: string | null;
}
export interface CommunityDiscordChannel {
  id: string;
  name: string;
  kind: 'category' | 'voice' | 'text';
  parentId: string | null;
  userLimit?: number;
}
export interface CommunityDiscordSnapshot {
  ready: boolean;
  guildName: string;
  selfId: string;
  resources: CommunityDiscordResource[];
  members: CommunityDiscordMember[];
}
export interface CommunityDiscord {
  snapshot(): Promise<CommunityDiscordSnapshot>;
  member(id: string): Promise<CommunityDiscordMember | null>;
  channel(id: string): Promise<CommunityDiscordChannel | null>;
  canView(memberId: string, channelId: string): Promise<boolean>;
  canConnect(memberId: string, channelId: string): Promise<boolean>;
  occupants(channelId: string): readonly string[] | null;
  /** undefined means unavailable; null proves disconnected in the ready snapshot. */
  channelOf(memberId: string): string | null | undefined;
  createVoice(parentId: string, name: string, ownerId: string, visibility: CommunityVisibility, userLimit: number, operationRef: string): Promise<string>;
  findCreatedVoice(operationRef: string): Promise<string | null>;
  move(memberId: string, channelId: string | null): Promise<void>;
  rename(channelId: string, name: string): Promise<void>;
  setLimit(channelId: string, limit: number): Promise<void>;
  setVisibility(channelId: string, ownerId: string, visibility: CommunityVisibility): Promise<void>;
  grant(channelId: string, memberId: string): Promise<void>;
  deny(channelId: string, memberId: string): Promise<void>;
  delete(channelId: string): Promise<void>;
  addRole(memberId: string, roleId: string): Promise<void>;
  removeRole(memberId: string, roleId: string): Promise<void>;
  sendText(channelId: string, content: string): Promise<string>;
  sendPanel(channelId: string, messageId?: string | null): Promise<string>;
}
export class CommunityDiscordError extends Error {
  constructor(readonly status: number, message: string, readonly uncertain = false) {
    super(message); this.name = 'CommunityDiscordError';
  }
}
interface Role { id: string; name: string; position: number; permissions: bigint; managed: boolean }
interface Member { id: string; name: string; bot: boolean; roleIds: string[]; joinedAt: string | null }
interface Overwrite { id: string; type: 0 | 1; allow: string; deny: string }
interface Channel extends CommunityDiscordChannel { overwrites: Overwrite[] }
interface Context { selfId: string; ownerId: string; guildName: string; roles: Map<string, Role>; self: Member; highest: number }
type Raw = Record<string, unknown>;
const ID = /^\d{17,20}$/;
const OP = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const ACCESS = P.ViewChannel | P.Connect;
const CHANNEL_MANAGEMENT = P.ViewChannel | P.ManageChannels;
const DANGEROUS = Object.entries(P).filter(([name]) => name.startsWith('Manage') || name.startsWith('Moderate') ||
  ['Administrator', 'KickMembers', 'BanMembers', 'ViewAuditLog', 'MentionEveryone', 'MoveMembers', 'MuteMembers', 'DeafenMembers'].includes(name))
  .reduce((all, [, bit]) => all | bit, 0n);
const MEMBER_PAGE = 1000;
const AUDIT_PAGE = 100;
const MAX_PAGES = 1000;
const invalid = () => new CommunityDiscordError(502, 'Discord 返回的数据不完整，等待重新同步');
const missing = () => new CommunityDiscordError(404, '社区资源已不存在');
const forbidden = () => new CommunityDiscordError(403, '机器人或当前成员缺少所需权限');
const unavailable = () => new CommunityDiscordError(503, '服务器状态暂不可用，请稍后重试');
function raw(value: unknown): Raw { if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid(); return value as Raw; }
function id(value: unknown): string { if (typeof value !== 'string' || !ID.test(value)) throw invalid(); return value; }
function bits(value: unknown): bigint { if (typeof value !== 'string' || !/^\d+$/.test(value)) throw invalid(); return BigInt(value); }
function has(value: bigint, required: bigint): boolean { return (value & required) === required; }
function validateId(value: string): void { if (!ID.test(value)) throw new CommunityDiscordError(400, '社区资源引用无效'); }
function validateName(value: string): void { if (!value.trim() || value.length > 100 || /[\u0000-\u001f\u007f]/.test(value)) throw new CommunityDiscordError(400, '房间名字须为 1–100 字且不能包含控制字符'); }
function validateLimit(value: number): void { if (!Number.isInteger(value) || value < 0 || value > 99) throw new CommunityDiscordError(400, '人数限制须为 0–99 的整数'); }
function reason(operationRef: string): string { if (!OP.test(operationRef)) throw new CommunityDiscordError(400, '操作引用无效'); return `community-room:${operationRef}`; }
function parseRole(value: unknown): Role {
  const r = raw(value);
  if (typeof r.name !== 'string' || typeof r.position !== 'number' || !Number.isInteger(r.position) || typeof r.managed !== 'boolean') throw invalid();
  return { id: id(r.id), name: r.name, position: r.position, permissions: bits(r.permissions), managed: r.managed };
}
function parseMember(value: unknown): Member {
  const r = raw(value), user = raw(r.user);
  if (typeof user.username !== 'string' || !Array.isArray(r.roles)) throw invalid();
  const name = typeof r.nick === 'string' && r.nick.trim() ? r.nick : typeof user.global_name === 'string' && user.global_name.trim() ? user.global_name : user.username;
  return { id: id(user.id), name, bot: user.bot === true, roleIds: r.roles.map(id), joinedAt: typeof r.joined_at === 'string' ? r.joined_at : null };
}
function parseChannel(value: unknown, guildId: string): Channel | null {
  const r = raw(value); if (r.guild_id !== guildId) throw forbidden();
  const kind = r.type === ChannelType.GuildCategory ? 'category' : r.type === ChannelType.GuildVoice ? 'voice'
    : r.type === ChannelType.GuildText || r.type === ChannelType.GuildAnnouncement ? 'text' : null;
  if (kind === null) return null;
  if (typeof r.name !== 'string' || !Array.isArray(r.permission_overwrites)) throw invalid();
  const overwrites = r.permission_overwrites.map((value): Overwrite => {
    const o = raw(value); if (o.type !== 0 && o.type !== 1) throw invalid();
    return { id: id(o.id), type: o.type, allow: bits(o.allow).toString(), deny: bits(o.deny).toString() };
  });
  return { id: id(r.id), kind, name: r.name, parentId: r.parent_id === null || r.parent_id === undefined ? null : id(r.parent_id),
    ...(kind === 'voice' ? { userLimit: typeof r.user_limit === 'number' ? r.user_limit : 0 } : {}), overwrites };
}
function publicChannel(channel: Channel): CommunityDiscordChannel {
  const { overwrites: _overwrites, ...out } = channel; return out;
}
function guildPermissions(member: Member, ctx: Context, guildId: string): bigint {
  if (member.id === ctx.ownerId) return -1n;
  let value = ctx.roles.get(guildId)?.permissions ?? 0n;
  for (const role of member.roleIds) { const found = ctx.roles.get(role); if (!found) throw invalid(); value |= found.permissions; }
  return has(value, P.Administrator) ? -1n : value;
}
function channelPermissions(member: Member, channel: Channel, ctx: Context, guildId: string): bigint {
  let value = guildPermissions(member, ctx, guildId); if (value === -1n) return value;
  const everyone = channel.overwrites.find(o => o.type === 0 && o.id === guildId);
  if (everyone) value = (value & ~BigInt(everyone.deny)) | BigInt(everyone.allow);
  let allow = 0n, deny = 0n;
  for (const o of channel.overwrites) if (o.type === 0 && member.roleIds.includes(o.id)) { allow |= BigInt(o.allow); deny |= BigInt(o.deny); }
  value = (value & ~deny) | allow;
  const own = channel.overwrites.find(o => o.type === 1 && o.id === member.id);
  return own ? (value & ~BigInt(own.deny)) | BigInt(own.allow) : value;
}
function memberView(member: Member, ctx: Context, guildId: string): CommunityDiscordMember {
  return { ...member, protected: member.bot || member.id === ctx.ownerId || (guildPermissions(member, ctx, guildId) & DANGEROUS) !== 0n };
}
function safeRole(role: Role, ctx: Context, guildId: string): boolean {
  return role.id !== guildId && !role.managed && role.position < ctx.highest && (role.permissions & DANGEROUS) === 0n;
}

export function createCommunityDiscord(client: Client, guildId: string): CommunityDiscord {
  validateId(guildId);
  const gateway = () => client.user !== null && client.isReady() && client.guilds.cache.get(guildId)?.available === true;
  const assertReady = (): void => { if (!gateway()) throw unavailable(); };
  async function request(method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: `/${string}`, options?: object): Promise<unknown> {
    try { return await client.rest[method](path, options); }
    catch (error) {
      if (error instanceof CommunityDiscordError) throw error;
      const status = typeof (error as { status?: unknown } | null)?.status === 'number' ? (error as { status: number }).status : 503;
      throw new CommunityDiscordError(status, status === 403 ? 'Discord 拒绝了这项权限操作' : status === 404 ? '社区资源已不存在' : 'Discord 操作暂未确认，请稍后对账', status >= 500);
    }
  }
  async function readMember(memberId: string): Promise<Member | null> {
    validateId(memberId);
    try { return parseMember(await request('get', Routes.guildMember(guildId, memberId))); }
    catch (error) { if (error instanceof CommunityDiscordError && error.status === 404) return null; throw error; }
  }
  async function context(): Promise<Context> {
    assertReady(); const selfId = id(client.user?.id);
    const [guildRaw, rolesRaw, self] = await Promise.all([request('get', Routes.guild(guildId)), request('get', Routes.guildRoles(guildId)), readMember(selfId)]);
    const guild = raw(guildRaw); if (guild.id !== guildId || typeof guild.name !== 'string' || !Array.isArray(rolesRaw) || !self) throw unavailable();
    const roles = new Map(rolesRaw.map(value => { const r = parseRole(value); return [r.id, r] as const; }));
    if (!roles.has(guildId)) throw invalid();
    const highest = Math.max(0, ...self.roleIds.map(roleId => { const role = roles.get(roleId); if (!role) throw invalid(); return role.position; }));
    assertReady(); return { selfId, ownerId: id(guild.owner_id), guildName: guild.name, roles, self, highest };
  }
  async function readChannel(channelId: string): Promise<Channel | null> {
    validateId(channelId);
    try { return parseChannel(await request('get', Routes.channel(channelId)), guildId); }
    catch (error) { if (error instanceof CommunityDiscordError && error.status === 404) return null; throw error; }
  }
  async function managedChannel(channelId: string, required = CHANNEL_MANAGEMENT): Promise<{ ctx: Context; channel: Channel }> {
    const ctx = await context(), channel = await readChannel(channelId);
    if (!channel) throw missing(); if (channel.kind !== 'voice' || !has(channelPermissions(ctx.self, channel, ctx, guildId), required)) throw forbidden();
    return { ctx, channel };
  }
  async function currentMember(memberId: string, ctx: Context): Promise<Member> {
    const member = await readMember(memberId); if (!member) throw missing();
    // Permissions are derived from a fresh roles response, never member caches.
    guildPermissions(member, ctx, guildId); return member;
  }
  function occupants(channelId: string): readonly string[] | null {
    if (!gateway()) return null;
    const values = client.guilds.cache.get(guildId)!.voiceStates.cache.values(), found: string[] = [];
    for (const state of values) {
      if (state.channelId !== null && typeof state.channelId !== 'string') return null;
      if (state.channelId === channelId) found.push(state.id);
    }
    return found;
  }
  function channelOf(memberId: string): string | null | undefined {
    if (!gateway()) return undefined;
    const state = client.guilds.cache.get(guildId)!.voiceStates.cache.get(memberId);
    return state ? state.channelId === null || typeof state.channelId === 'string' ? state.channelId : undefined : null;
  }
  async function memberList(): Promise<Member[]> {
    const result: Member[] = []; let after: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const query = new URLSearchParams({ limit: String(MEMBER_PAGE), ...(after ? { after } : {}) });
      const response = await request('get', Routes.guildMembers(guildId), { query });
      if (!Array.isArray(response) || response.length > MEMBER_PAGE) throw invalid();
      for (const value of response) { const member = parseMember(value); if (after && BigInt(member.id) <= BigInt(after)) throw invalid(); after = member.id; result.push(member); }
      if (response.length < MEMBER_PAGE) return result;
    }
    throw new CommunityDiscordError(503, '成员目录尚未完整同步');
  }
  function visibilityOverwrites(channel: Channel | null, ctx: Context, ownerId: string, visibility: CommunityVisibility): Overwrite[] {
    if (!['open', 'locked', 'hidden'].includes(visibility)) throw new CommunityDiscordError(400, '房间访问模式无效');
    const blocked = visibility === 'hidden' ? ACCESS : visibility === 'locked' ? P.Connect : 0n;
    const source = channel?.overwrites ?? [];
    if (blocked !== 0n && source.some(o => o.type === 0 && o.id !== guildId && (BigInt(o.allow) & blocked) !== 0n)) {
      throw new CommunityDiscordError(409, '人工设置的角色权限与房间访问模式冲突，请管理员检查');
    }
    const output = source.filter(o => ![guildId, ctx.selfId, ownerId].includes(o.id)).map(o => ({ ...o }));
    const update = (targetId: string, type: 0 | 1, allow: bigint, deny: bigint): void => {
      const prior = source.find(o => o.id === targetId && o.type === type);
      output.push({ id: targetId, type, allow: ((prior ? BigInt(prior.allow) : 0n) & ~ACCESS | allow).toString(), deny: ((prior ? BigInt(prior.deny) : 0n) & ~ACCESS | deny).toString() });
    };
    update(guildId, 0, visibility === 'hidden' ? 0n : visibility === 'locked' ? P.ViewChannel : ACCESS, blocked);
    update(ctx.selfId, 1, ACCESS, 0n);
    update(ownerId, 1, ACCESS, 0n);
    return output;
  }
  async function textChannel(channelId: string): Promise<{ ctx: Context; channel: Channel }> {
    const ctx = await context(), channel = await readChannel(channelId);
    if (!channel || channel.kind !== 'text') throw missing();
    if (!has(channelPermissions(ctx.self, channel, ctx, guildId), P.ViewChannel | P.SendMessages)) throw forbidden();
    return { ctx, channel };
  }
  async function access(memberId: string, channelId: string, connect: boolean): Promise<boolean> {
    const ctx = await context(), [member, channel] = await Promise.all([readMember(memberId), readChannel(channelId)]);
    if (!member || !channel) return false;
    return has(channelPermissions(member, channel, ctx, guildId), P.ViewChannel | (connect ? P.Connect : 0n));
  }
  async function roleChange(memberId: string, roleId: string, remove: boolean): Promise<void> {
    validateId(roleId); const ctx = await context(), role = ctx.roles.get(roleId);
    if (!role || !safeRole(role, ctx, guildId) || !has(guildPermissions(ctx.self, ctx, guildId), P.ManageRoles)) throw forbidden();
    const member = await currentMember(memberId, ctx); if (member.bot || member.id === ctx.ownerId) throw forbidden();
    assertReady(); await request(remove ? 'delete' : 'put', Routes.guildMemberRole(guildId, memberId, roleId), { reason: 'community self-selected role' });
  }
  return {
    async snapshot() {
      if (!gateway()) return { ready: false, guildName: '', selfId: client.user?.id ?? '', resources: [], members: [] };
      await context();
      const [channelsRaw, members] = await Promise.all([request('get', Routes.guildChannels(guildId)), memberList()]);
      if (!Array.isArray(channelsRaw)) throw invalid();
      const ctx = await context(), channels = channelsRaw.map(value => parseChannel(value, guildId)).filter((value): value is Channel => value !== null);
      const resources: CommunityDiscordResource[] = channels.map(channel => ({ id: channel.id, name: channel.name, kind: channel.kind,
        available: has(channelPermissions(ctx.self, channel, ctx, guildId), P.ViewChannel), metadata: { parentId: channel.parentId, ...(channel.kind === 'voice' ? { userLimit: channel.userLimit } : {}) } }));
      for (const role of ctx.roles.values()) resources.push({ id: role.id, name: role.name, kind: 'role', available: true, safe: safeRole(role, ctx, guildId),
        metadata: { managed: role.managed, position: role.position, unsafePermissions: (role.permissions & DANGEROUS) !== 0n } });
      for (const member of members) resources.push({ id: member.id, name: member.name, kind: 'member', available: true });
      return { ready: true, guildName: ctx.guildName, selfId: ctx.selfId, resources, members: members.map(member => memberView(member, ctx, guildId)) };
    },
    async member(memberId) { const ctx = await context(), member = await readMember(memberId); return member ? memberView(member, ctx, guildId) : null; },
    async channel(channelId) { assertReady(); const channel = await readChannel(channelId); return channel ? publicChannel(channel) : null; },
    canView: (memberId, channelId) => access(memberId, channelId, false),
    canConnect: (memberId, channelId) => access(memberId, channelId, true),
    occupants, channelOf,
    async createVoice(parentId, name, ownerId, visibility, userLimit, operationRef) {
      validateName(name); validateLimit(userLimit); const marker = reason(operationRef), ctx = await context(), parent = await readChannel(parentId);
      if (!parent || parent.kind !== 'category') throw missing();
      if (!has(channelPermissions(ctx.self, parent, ctx, guildId), CHANNEL_MANAGEMENT | P.ManageRoles)
        || !has(guildPermissions(ctx.self, ctx, guildId), P.ViewAuditLog)) throw forbidden();
      const owner = await currentMember(ownerId, ctx); if (owner.bot) throw forbidden();
      const permission_overwrites = visibilityOverwrites(null, ctx, ownerId, visibility); assertReady();
      const created = raw(await request('post', Routes.guildChannels(guildId), { body: { name: name.trim(), type: ChannelType.GuildVoice,
        parent_id: parentId, user_limit: userLimit, permission_overwrites }, reason: marker }));
      if (created.type !== ChannelType.GuildVoice || created.guild_id !== guildId) throw new CommunityDiscordError(503, '建房结果尚未确认，需要审计对账', true);
      return id(created.id);
    },
    async findCreatedVoice(operationRef) {
      const marker = reason(operationRef);
      const check = async (): Promise<Context> => { const ctx = await context(); if (!has(guildPermissions(ctx.self, ctx, guildId), P.ViewAuditLog)) throw forbidden(); return ctx; };
      const ctx = await check(); let before: string | undefined, complete = false; const matches: string[] = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const query = new URLSearchParams({ limit: String(AUDIT_PAGE), action_type: '10', user_id: ctx.selfId, ...(before ? { before } : {}) });
        const payload = raw(await request('get', Routes.guildAuditLog(guildId), { query }));
        if (!Array.isArray(payload.audit_log_entries) || payload.audit_log_entries.length > AUDIT_PAGE) throw invalid();
        for (const value of payload.audit_log_entries) {
          const entry = raw(value), auditId = id(entry.id);
          if (before && BigInt(auditId) >= BigInt(before)) throw invalid(); before = auditId;
          if (entry.action_type === 10 && entry.user_id === ctx.selfId && entry.reason === marker) matches.push(id(entry.target_id));
        }
        if (payload.audit_log_entries.length < AUDIT_PAGE) { complete = true; break; }
      }
      if (!complete) throw new CommunityDiscordError(503, '建房审计尚未完整读取');
      await check();
      if (matches.length > 1) throw new CommunityDiscordError(409, '建房审计出现多个匹配，需要人工对账');
      if (matches.length === 0) return null;
      const found = await readChannel(matches[0]);
      if (!found || found.kind !== 'voice') throw new CommunityDiscordError(409, '建房审计与频道状态不一致，需要人工对账');
      await check(); return found.id;
    },
    async move(memberId, channelId) {
      const ctx = await context(), member = await currentMember(memberId, ctx); if (member.bot) throw forbidden();
      const sourceId = channelOf(memberId); if (sourceId === undefined) throw unavailable();
      if (sourceId === null) { if (channelId === null) return; throw new CommunityDiscordError(409, '成员尚未连接语音，不能直接移动'); }
      const source = await readChannel(sourceId); if (!source || source.kind !== 'voice' || !has(channelPermissions(ctx.self, source, ctx, guildId), P.ViewChannel | P.MoveMembers)) throw forbidden();
      if (channelId !== null) {
        const target = await readChannel(channelId); if (!target || target.kind !== 'voice') throw missing();
        if (!has(channelPermissions(ctx.self, target, ctx, guildId), ACCESS | P.MoveMembers) || !has(channelPermissions(member, target, ctx, guildId), ACCESS)) throw forbidden();
      }
      if (channelOf(memberId) !== sourceId) throw new CommunityDiscordError(409, '成员语音位置已变化，请重试');
      assertReady(); await request('patch', Routes.guildMember(guildId, memberId), { body: { channel_id: channelId }, reason: 'community room move' });
    },
    async rename(channelId, name) { validateName(name); await managedChannel(channelId); assertReady(); await request('patch', Routes.channel(channelId), { body: { name: name.trim() }, reason: 'community room rename' }); },
    async setLimit(channelId, userLimit) { validateLimit(userLimit); await managedChannel(channelId); assertReady(); await request('patch', Routes.channel(channelId), { body: { user_limit: userLimit }, reason: 'community room capacity' }); },
    async setVisibility(channelId, ownerId, visibility) {
      const { ctx, channel } = await managedChannel(channelId, CHANNEL_MANAGEMENT | P.ManageRoles);
      await currentMember(ownerId, ctx); const permission_overwrites = visibilityOverwrites(channel, ctx, ownerId, visibility);
      assertReady(); await request('patch', Routes.channel(channelId), { body: { permission_overwrites }, reason: 'community room visibility' });
    },
    async grant(channelId, memberId) {
      const { ctx, channel } = await managedChannel(channelId, CHANNEL_MANAGEMENT | P.ManageRoles); const member = await currentMember(memberId, ctx);
      if (member.bot) throw forbidden(); const old = channel.overwrites.find(o => o.type === 1 && o.id === memberId);
      assertReady(); await request('put', Routes.channelPermission(channelId, memberId), { body: { type: 1,
        allow: ((old ? BigInt(old.allow) : 0n) | ACCESS).toString(), deny: ((old ? BigInt(old.deny) : 0n) & ~ACCESS).toString() }, reason: 'community room access grant' });
    },
    async deny(channelId, memberId) {
      const { ctx, channel } = await managedChannel(channelId, CHANNEL_MANAGEMENT | P.ManageRoles); const member = await currentMember(memberId, ctx);
      if (member.bot || member.id === ctx.ownerId || (guildPermissions(member, ctx, guildId) & DANGEROUS) !== 0n) throw forbidden();
      const old = channel.overwrites.find(o => o.type === 1 && o.id === memberId);
      assertReady(); await request('put', Routes.channelPermission(channelId, memberId), { body: { type: 1,
        allow: ((old ? BigInt(old.allow) : 0n) & ~ACCESS).toString(), deny: ((old ? BigInt(old.deny) : 0n) | ACCESS).toString() }, reason: 'community room access deny' });
    },
    async delete(channelId) {
      await managedChannel(channelId); const members = occupants(channelId); if (members === null) throw unavailable();
      if (members.length > 0) throw new CommunityDiscordError(409, '房间仍有人，不能删除');
      assertReady(); await request('delete', Routes.channel(channelId), { reason: 'community empty room cleanup' });
    },
    addRole: (memberId, roleId) => roleChange(memberId, roleId, false),
    removeRole: (memberId, roleId) => roleChange(memberId, roleId, true),
    async sendText(channelId, content) {
      if (!content.trim() || content.length > 2000) throw new CommunityDiscordError(400, '社区消息须为 1–2000 字');
      await textChannel(channelId); assertReady(); const sent = raw(await request('post', Routes.channelMessages(channelId), { body: { content, allowed_mentions: { parse: [] } } })); return id(sent.id);
    },
    async sendPanel(channelId, messageId) {
      const { ctx } = await textChannel(channelId);
      const body = { content: '社区中心 · 创建与管理自己的语音房，选择兴趣身份，使用趣味工具。', allowed_mentions: { parse: [] },
        components: [{ type: 1, components: [
          { type: 2, style: 2, label: '我的房间', custom_id: 'v1:community:room' },
          { type: 2, style: 2, label: '兴趣身份', custom_id: 'v1:community:roles' },
          { type: 2, style: 2, label: '趣味工具', custom_id: 'v1:community:play' },
        ] }] };
      if (messageId) {
        validateId(messageId); const previous = raw(await request('get', Routes.channelMessage(channelId, messageId)));
        if (raw(previous.author).id !== ctx.selfId) throw new CommunityDiscordError(409, '不能覆盖其他作者的频道消息');
        assertReady(); await request('patch', Routes.channelMessage(channelId, messageId), { body }); return messageId;
      }
      assertReady(); const sent = raw(await request('post', Routes.channelMessages(channelId), { body })); return id(sent.id);
    },
  };
}
