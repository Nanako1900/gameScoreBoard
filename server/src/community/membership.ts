import type { CommunityResourceView } from '../../../shared/community';
import { isCommunityRef } from '../../../shared/community';
import { CommunityDiscordError, type CommunityDiscord } from './discord';
import { CommunityStoreError, type CommunityStore, type StoredOperation } from './store';
import { safeCommunityText } from './security';

const reject = (code: string, message: string, status = 400): never => { throw new CommunityStoreError(status, code, message); };
const uncertain = (): never => { throw new CommunityDiscordError(409, '操作结果需要管理员核对，请勿重复执行', true); };
const timestamp = (value: unknown): number | null => {
  if (!(typeof value === 'string' || value instanceof Date)) return null;
  const parsed = new Date(value).getTime(); return Number.isFinite(parsed) ? parsed : null;
};

/** The API process reads only stored opaque references; it needs no Discord client. */
export async function readCommunityRoles(store: CommunityStore, memberRef: string) {
  const member = await store.resource(memberRef, 'member');
  if (!member?.available) return reject('not_found', '成员不存在', 404);
  const { settings } = await store.settings();
  const rows = await store.pool.query('SELECT role_ref FROM community_role_choices WHERE guild_id=$1 AND member_ref=$2', [store.guildId, memberRef]);
  const roles = await store.storedResources('role');
  const storedRefs = new Set(roles.map(role => role.ref));
  const selectedRefs = rows.rows.map(row => String(row.role_ref)).filter(ref => storedRefs.has(ref));
  const choices: CommunityResourceView[] = roles.filter(role => settings.roles.allowedRefs.includes(role.ref) || selectedRefs.includes(role.ref))
    .map(role => ({ ref: role.ref, name: safeCommunityText(role.name), kind: 'role',
      available: settings.enabled && settings.roles.enabled && role.available && role.safe === true && settings.roles.allowedRefs.includes(role.ref), safe: role.safe }));
  return { choices, selectedRefs, maxChoices: Math.min(settings.roles.maxChoices, 5), enabled: settings.enabled && settings.roles.enabled };
}

export class CommunityMembershipService {
  constructor(private readonly store: CommunityStore, private readonly discord: CommunityDiscord) {}

  readRoles(memberRef: string) { return readCommunityRoles(this.store, memberRef); }

  /** A stale worker may not initiate a new external side effect. */
  private async renew(op: StoredOperation): Promise<void> {
    const current = await this.store.getOperation(op.ref);
    if (!op.claimToken || current?.status !== 'running' || current.claimToken !== op.claimToken ||
      (current.expiresAt !== null && (timestamp(current.expiresAt) ?? 0) <= Date.now()) ||
      !await this.store.renew(op.ref, op.claimToken)) uncertain();
  }

  async setRoles(memberRef: string, refs: string[], op?: StoredOperation, beforeEffect?: () => Promise<void>) {
    const { settings, version } = await this.store.settings();
    if (!Array.isArray(refs) || refs.length > 5 || refs.some(ref => !isCommunityRef(ref)) || new Set(refs).size !== refs.length)
      return reject('invalid_input', '身份选择无效');
    if (op && (op.kind !== 'roles.set' || op.actor.memberRef !== memberRef)) return reject('invalid_input', '身份操作目标无效');
    const resource = await this.store.resource(memberRef, 'member');
    const member = resource?.available ? await this.discord.member(resource.externalId) : null;
    if (!resource || !member || member.bot) return reject('membership_required', '需要当前服务器成员身份', 403);
    const snapshot = await this.discord.snapshot();
    if (!snapshot.ready) return reject('bot_offline', '机器人暂未就绪', 503);
    const checkSettings = async () => {
      if ((await this.store.settings()).version !== version) return reject('version_conflict', '身份配置已变化，请重新选择', 409);
    };
    await checkSettings();
    const previous = (await this.store.pool.query('SELECT role_ref FROM community_role_choices WHERE guild_id=$1 AND member_ref=$2', [this.store.guildId, memberRef])).rows.map(row => String(row.role_ref));
    const onlyRemoves = refs.length < previous.length && refs.every(ref => previous.includes(ref));
    if (refs.length > settings.roles.maxChoices && !onlyRemoves) return reject('invalid_input', '所选身份数量超出上限');
    const additions: { ref: string; externalId: string }[] = [];
    const removals: { ref: string; externalId: string | null; held: boolean }[] = [];
    // Keeping a previous selection is allowed even if its allowlist entry was
    // revoked. Exiting must also work while either feature switch is disabled.
    for (const ref of refs.filter(ref => !previous.includes(ref))) {
      if (!settings.enabled || !settings.roles.enabled) return reject('feature_disabled', '自选身份已停用', 409);
      const role = await this.store.resource(ref, 'role');
      const live = role && snapshot.resources.find(item => item.kind === 'role' && item.id === role.externalId);
      if (!role || !settings.roles.allowedRefs.includes(ref) || !live?.available || live.safe !== true)
        return reject('invalid_input', '该身份已不在安全白名单内');
      // A pre-existing moderator role never becomes owned by this module.
      if (!member.roleIds.includes(role.externalId)) additions.push(role);
    }
    // Preflight every removal before making any mutation. A role that became
    // managed or privileged requires administrator intervention, even on exit.
    for (const ref of previous.filter(ref => !refs.includes(ref))) {
      const role = await this.store.resource(ref, 'role');
      const held = !!role && member.roleIds.includes(role.externalId);
      const live = role && snapshot.resources.find(item => item.kind === 'role' && item.id === role.externalId);
      if (held && (!live?.available || live.safe !== true)) return reject('invalid_input', '该身份权限已变化，请管理员处理退出', 409);
      removals.push({ ref, externalId: role?.externalId ?? null, held });
    }
    let changedExternally = false;
    try {
      for (const role of removals) {
        await checkSettings();
        if (op) await this.renew(op);
        await beforeEffect?.();
        if (role.held && role.externalId) {
          await this.discord.removeRole(resource.externalId, role.externalId);
          changedExternally = true;
        }
        await this.store.pool.query('DELETE FROM community_role_choices WHERE guild_id=$1 AND member_ref=$2 AND role_ref=$3', [this.store.guildId, memberRef, role.ref]);
      }
      for (const role of additions) {
        await checkSettings();
        if (op) await this.renew(op);
        await beforeEffect?.();
        await this.discord.addRole(resource.externalId, role.externalId);
        changedExternally = true;
        await this.store.pool.query('INSERT INTO community_role_choices(guild_id,member_ref,role_ref) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [this.store.guildId, memberRef, role.ref]);
      }
    } catch (error) {
      // Neither replay partial changes nor infer success after a lost response.
      if (changedExternally || (error instanceof CommunityDiscordError ? error.uncertain : !(error instanceof CommunityStoreError))) return uncertain();
      throw error;
    }
    const selectedRefs = previous.filter(ref => refs.includes(ref)).concat(additions.map(role => role.ref));
    return { selectedRefs };
  }

  /** Called only by a fresh GuildMemberAdd event, never by the startup census. */
  async welcome(memberId: string): Promise<void> {
    const { settings } = await this.store.settings();
    if (!settings.enabled || !settings.welcome.enabled || !settings.welcome.channelRef) return;
    const member = await this.discord.member(memberId);
    if (!member || member.bot || timestamp(member.joinedAt) === null) return;
    const resource = await this.store.upsertResource('member', memberId, safeCommunityText(member.name), { metadata: { bot: false } });
    await this.store.enqueueWelcome(resource.ref, member.joinedAt, settings.welcome.rejoinCooldownHours);
  }

  async sendWelcome(op: StoredOperation) {
    const memberRef = op.actor.memberRef;
    if (op.kind !== 'welcome.send' || !memberRef) return reject('invalid_input', '欢迎目标无效');
    await this.renew(op);
    const { settings } = await this.store.settings();
    const slots = await this.store.pool.query('SELECT pending_ref,joined_at FROM community_welcomes WHERE guild_id=$1 AND member_ref=$2', [this.store.guildId, memberRef]);
    if (String(slots.rows[0]?.pending_ref) !== op.ref) return { sent: false };
    const cancel = async () => {
      await this.store.pool.query('UPDATE community_welcomes SET pending_ref=NULL WHERE guild_id=$1 AND member_ref=$2 AND pending_ref=$3', [this.store.guildId, memberRef, op.ref]);
      return { sent: false };
    };
    const resource = await this.store.resource(memberRef, 'member');
    const member = resource?.available ? await this.discord.member(resource.externalId) : null;
    if (!settings.enabled || !settings.welcome.enabled || !member || member.bot) return cancel();
    const expected = timestamp(slots.rows[0]?.joined_at);
    const payload = op.payload as { joinedAt?: unknown };
    // Slot, original event and fresh membership must agree. A later rejoin may
    // update the slot while the old event is still queued; it cannot reuse it.
    if (expected === null || expected !== timestamp(payload.joinedAt) || expected !== timestamp(member.joinedAt)) return cancel();
    const channel = settings.welcome.channelRef ? await this.store.resource(settings.welcome.channelRef, 'text') : null;
    if (!channel?.available) return reject('resource_missing', '欢迎频道不可用', 409);
    const [snapshot, currentChannel] = await Promise.all([this.discord.snapshot(), this.discord.channel(channel.externalId)]);
    if (!snapshot.ready) return reject('bot_offline', '机器人暂未就绪', 503);
    const live = snapshot.resources.find(item => item.kind === 'text' && item.id === channel.externalId);
    if (currentChannel?.kind !== 'text' || !live?.available || live.metadata?.publicView !== true)
      return reject('resource_missing', '欢迎频道必须是公开可见的文字频道', 409);
    // Snapshot enumeration can take time on a large guild. Recheck the member
    // and switches afterwards so a departure or administrator stop takes effect
    // before this event creates a public message.
    const [currentMember, latest] = await Promise.all([this.discord.member(resource!.externalId), this.store.settings()]);
    if (!latest.settings.enabled || !latest.settings.welcome.enabled || !currentMember || currentMember.bot || timestamp(currentMember.joinedAt) !== expected)
      return cancel();
    if (latest.settings.welcome.channelRef !== channel.ref) return reject('version_conflict', '欢迎频道配置已变化，请重新核对', 409);
    const currentSlot = (await this.store.pool.query('SELECT pending_ref,joined_at FROM community_welcomes WHERE guild_id=$1 AND member_ref=$2', [this.store.guildId, memberRef])).rows[0];
    if (String(currentSlot?.pending_ref) !== op.ref || timestamp(currentSlot.joined_at) !== expected) return cancel();
    const content = safeCommunityText(latest.settings.welcome.template.replaceAll('{name}', currentMember.name).replaceAll('{server}', snapshot.guildName)
      .replaceAll('{memberCount}', String(snapshot.members.filter(item => !item.bot).length)));
    await this.renew(op);
    try {
      await this.discord.sendText(channel.externalId, content);
    } catch (error) {
      if (!(error instanceof CommunityDiscordError) || error.uncertain) return uncertain();
      throw error;
    }
    try {
      const saved = await this.store.pool.query(`UPDATE community_welcomes SET last_sent_at=now(),pending_ref=NULL
        WHERE guild_id=$1 AND member_ref=$2 AND pending_ref=$3 AND joined_at=$4`, [this.store.guildId, memberRef, op.ref, new Date(expected).toISOString()]);
      if (saved.rowCount !== 1) return uncertain();
    } catch { return uncertain(); }
    return { sent: true };
  }
}
