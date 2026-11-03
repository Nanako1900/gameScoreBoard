import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, type APIActionRowComponent, type APIComponentInMessageActionRow, type Interaction } from 'discord.js';
import { isCommunityRef, type CommunityJson } from '../../../shared/community';
import { COMMUNITY_COMMANDS, RETIRED_COMMUNITY_COMMAND_NAMES, isRetiredCommunityComponentId } from './commands';
import { communityInteractionResponse, type CommunityInteractionMessage } from './interaction-response';
import type { CommunityDiscord } from './discord';
import type { CommunityMembershipService } from './membership';
import { canReadRoom, safeCommunityText } from './security';
import { fixedManagerRefs, isFixedRoom } from './fixed-rooms';
import { canControlRoom } from './room-policy';
import type { CommunityService } from './service';
import { CommunityStoreError, type CommunityActor, type StoredOperation, type StoredRoom } from './store';

export interface CommunityInteractionDependencies {
  guildId: string; frontendUrl: string; service: CommunityService; discord: CommunityDiscord;
  membership: CommunityMembershipService; wake?: () => Promise<void>;
  operationPolling?: { wait?: (milliseconds: number) => Promise<void> };
}
type Row = APIActionRowComponent<APIComponentInMessageActionRow>;
const row = (components: APIComponentInMessageActionRow[]): Row => ({ type: 1, components });
const button = (label: string, custom_id: string, style: 1 | 2 | 3 | 4 = 2): APIComponentInMessageActionRow => ({ type: 2, label, custom_id, style });
const clean = (value: unknown, max = 100): string => safeCommunityText(String(value ?? '')).replace(/[\r\n]/g, ' ').slice(0, max);
const object = (value: CommunityJson): { [key: string]: CommunityJson } => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
function message(content: string, components: Row[] = []): CommunityInteractionMessage { return { content: safeCommunityText(content).slice(0, 1950), components: components.slice(0, 5), allowedMentions: { parse: [] } }; }
function missing(): never { throw new CommunityStoreError(404, 'not_found', '内容不存在或已不可见'); }
function version(value: string | undefined): number { const number = Number(value); if (!Number.isSafeInteger(number) || number < 1) return missing(); return number; }
const RETIRED_NOTICE = '趣味工具及 AI 建议已下线。房间管理和兴趣身份仍可使用。';
const pendingStates = new Set(['queued', 'running', 'retry_wait']);
const operationStates: Record<string, string> = { queued: '已排队，尚未执行', running: '正在执行', retry_wait: '等待重试', succeeded: '操作已完成', failed: '操作失败', conflict: '内容或权限已变化，请刷新后重试', canceled: '操作已取消', needs_review: '执行结果需要管理员核对，请勿重复操作' };

/** At most four reads and 1.5 seconds, including a slow database read. Engine
 * wake-up is deliberately outside this budget: it owns its own durable retry. */
async function readOperationBriefly(deps: CommunityInteractionDependencies, ref: string): Promise<StoredOperation | null> {
  const deadline = Date.now() + 1500, delays = [150, 350, 500];
  const wait = deps.operationPolling?.wait ?? ((milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds)));
  let latest: StoredOperation | null = null;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (attempt > 0) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await wait(Math.min(delays[attempt - 1], remaining));
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      latest = await Promise.race([
        deps.service.store.getOperation(ref),
        new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), remaining); }),
      ]);
    } catch { latest = null; }
    finally { if (timer) clearTimeout(timer); }
    if (latest && !pendingStates.has(latest.status)) return latest;
  }
  return latest;
}
export async function handleCommunityInteraction(interaction: Interaction, deps: CommunityInteractionDependencies): Promise<boolean> {
  const command = interaction.isChatInputCommand() ? interaction.commandName : null;
  const customId = 'customId' in interaction ? interaction.customId : '';
  if (!(command && (COMMUNITY_COMMANDS.some(item => item.name === command) || RETIRED_COMMUNITY_COMMAND_NAMES.includes(command))) && !customId.startsWith('v1:community:')) return false;
  if (!interaction.isRepliable()) return true;
  const parts = customId.split(':').slice(2);
  const quietSharedModal = interaction.isModalSubmit() && parts[0] === 'panelsubmit' && ['rename', 'limit'].includes(parts[1]);
  const response = communityInteractionResponse(interaction, quietSharedModal);
  const respond = response.send;
  const backToRoom = (ref: string) => row([button('返回房间', `v1:community:room:${ref}`)]);
  if (interaction.guildId !== deps.guildId) { await response.immediate(message('请在配置的社区服务器内使用。')); return true; }
  if (command && RETIRED_COMMUNITY_COMMAND_NAMES.includes(command) || isRetiredCommunityComponentId(customId)) {
    await response.immediate(message(RETIRED_NOTICE)); return true;
  }
  // Showing a modal must be the very first interaction response. Submitted
  // values are untrusted and receive the complete authorization below.
  const panelEdit = parts[0] === 'panel' && ['rename', 'limit'].includes(parts[1]);
  if (interaction.isButton() && (panelEdit || parts[0] === 'edit')) {
    const action = parts[1];
    // Public buttons contain no expiring version. Submission checks fresh
    // ownership/version; private modals preserve their optimistic version.
    const modal = new ModalBuilder().setCustomId(panelEdit ? `v1:community:panelsubmit:${action}:${parts[2] ?? ''}` : `v1:community:submit:${action}:${parts[2] ?? ''}:${parts[3] ?? ''}`)
      .setTitle(action === 'limit' ? '房间人数上限' : action === 'create' ? '创建我的房间' : '修改房间名');
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('value')
      .setLabel(action === 'limit' ? '0–99；0 表示不限人数' : '名字（最多 100 字）').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true)));
    await interaction.showModal(modal); return true;
  }
  // ACK failures may already have reached Discord: do not retry another ACK.
  await response.defer();
  try {
    let authority = await deps.service.actorFromDiscord(interaction.user.id);
    const live = await deps.discord.member(interaction.user.id);
    if (!authority.memberAvailable || !authority.memberRef || !live || live.bot) throw new CommunityStoreError(403, 'membership_required', '需要当前社区成员身份；机器人可能尚未同步，请稍后重试。');
    const actor: CommunityActor = { source: 'discord', memberRef: authority.memberRef };
    const refreshAuthority = async (): Promise<void> => {
      const current = await deps.service.actorFromDiscord(interaction.user.id), member = await deps.discord.member(interaction.user.id);
      if (!current.memberAvailable || !current.memberRef || current.memberRef !== actor.memberRef || !member || member.bot) {
        throw new CommunityStoreError(403, 'membership_required', '成员身份已变化，请重新打开社区功能。');
      }
      authority = current;
    };
    const roomFor = async (ref: string): Promise<StoredRoom> => {
      if (!isCommunityRef(ref)) return missing(); const room = await deps.service.store.getRoom(ref);
      if (!room || room.status === 'closed' || !canReadRoom(authority, room, await deps.service.store.roomAccess(ref))) return missing();
      const channel = room.channelRef ? await deps.service.store.resource(room.channelRef, 'voice') : null;
      if (!authority.isAdmin && (!channel?.available || !await deps.discord.canView(interaction.user.id, channel.externalId))) return missing(); return room;
    };
    const showRoom = async (ref?: string, notice = ''): Promise<void> => {
      if (!ref) {
        const visible: StoredRoom[] = [];
        for (const room of await deps.service.store.listRooms()) { try { visible.push(await roomFor(room.ref)); } catch { /* Private and missing rooms have the same absence. */ } }
        const mine = visible.find(room => room.ownerRef === authority.memberRef); if (mine) return showRoom(mine.ref, notice);
        const position = deps.discord.channelOf(interaction.user.id);
        for (const room of visible) {
          const channel = room.channelRef ? await deps.service.store.resource(room.channelRef, 'voice') : null;
          if (position && channel?.externalId === position) return showRoom(room.ref, notice);
        }
        await respond(message('临时语音房\n进入服务器的「创建入口」语音频道，机器人会自动建房并把你移入。\n房内文字聊天有自动更新的控制卡；空房后会按设置时间自动删除。', [row([button('刷新房间', 'v1:community:room'), button('兴趣身份', 'v1:community:roles')])])); return;
      }
      const room = await roomFor(ref), access = await deps.service.store.roomAccess(ref), mine = room.ownerRef === authority.memberRef, fixed = isFixedRoom(room), controls = canControlRoom(authority, room);
      const channel = room.channelRef ? await deps.service.store.resource(room.channelRef, 'voice') : null;
      const occupants = channel ? deps.discord.occupants(channel.externalId) : null;
      const prefix = (action: string) => `v1:community:act:${action}:${room.ref}:${room.version}`;
      const rows: Row[] = [];
      if (controls) {
        rows.push(row([button('改名', `v1:community:edit:rename:${room.ref}:${room.version}`), button('人数', `v1:community:edit:limit:${room.ref}:${room.version}`), button('可见性', `v1:community:visibility:${room.ref}:${room.version}`)]));
        rows.push(row([button('允许成员', `v1:community:target:grant:${room.ref}:${room.version}`), button('禁止成员', `v1:community:target:deny:${room.ref}:${room.version}`), button('移出成员', `v1:community:target:kick:${room.ref}:${room.version}`), ...(!fixed ? [button('转让房主', `v1:community:target:transfer:${room.ref}:${room.version}`)] : [])]));
        if (!fixed) rows.push(row([button('解散空房间', `v1:community:confirm:dissolve:${room.ref}:${room.version}`, 4), button('移往等候区后解散', `v1:community:confirm:admin_delete:${room.ref}:${room.version}`, 4)]));
      }
      if (!fixed) {
        const actions: APIComponentInMessageActionRow[] = [];
        if (!fixed && room.transferToRef === authority.memberRef) actions.push(button('接受房主转让', prefix('accept'), 3));
        const config = (await deps.service.store.settings()).settings;
        if (!fixed && occupants?.includes(interaction.user.id) && room.ownerLeftAt && Date.now() >= Date.parse(room.ownerLeftAt) + config.rooms.ownerGraceSeconds * 1000) actions.push(button('认领房间', prefix('claim'), 3));
        if (actions.length) rows.push(row(actions));
      }
      const managers = fixed ? (await Promise.all(fixedManagerRefs(room).map(ref => deps.service.store.resource(ref, 'member')))).filter(Boolean).map(member => clean(member!.name)).join('、') : '';
      rows.push(row([button('刷新房间', `v1:community:room:${room.ref}`), button('兴趣身份', 'v1:community:roles')]));
      await respond(message(`${notice ? `${notice}\n` : ''}${clean(room.name)}\n${fixed ? `固定房 · 管理员：${managers || '尚未分配'} · 不自动删除` : mine ? '你是创建者 · 成员共用控制' : '临时房 · 成员共用控制'} · ${room.visibility === 'open' ? '开放' : room.visibility === 'locked' ? '上锁' : '隐藏'} · ${room.userLimit || '不限'} 人\n${occupants === null ? '语音状态暂不可用' : `当前 ${occupants.length} 人`} · ${access.filter(item => item.allowed).length} 位受邀成员\n状态：${room.status}${room.transferToRef ? '\n有一项待接受的房主转让。' : ''}`, rows));
    };
    const showRoles = async (page = 0, notice = ''): Promise<void> => {
      const roles = await deps.membership.readRoles(authority.memberRef!);
      page = Math.min(Math.max(0, page), Math.max(0, Math.ceil(roles.choices.length / 25) - 1));
      const entries = roles.choices.slice(page * 25, (page + 1) * 25), rows: Row[] = [];
      if (entries.length) rows.push(row([{ type: 3, custom_id: `v1:community:roles:set:${page}`, placeholder: '选择兴趣身份；取消选中即可退出', min_values: 0, max_values: Math.min(roles.maxChoices, entries.length), options: entries.map(role => ({ label: clean(role.name), value: role.ref, default: roles.selectedRefs.includes(role.ref), ...(role.available ? {} : { description: '已停止开放，可取消选中退出' }) })) }]));
      if (roles.choices.length > 25) rows.push(row([button('上一页', `v1:community:roles:page:${Math.max(0, page - 1)}`), button('下一页', `v1:community:roles:page:${Math.min(Math.ceil(roles.choices.length / 25) - 1, page + 1)}`)]));
      rows.push(row([button('刷新身份', `v1:community:roles:page:${page}`), button('我的房间', 'v1:community:room')]));
      await respond(message(`${notice ? `${notice}\n` : ''}兴趣身份\n最多选择 ${roles.maxChoices} 个。${roles.enabled ? '' : '目前停止新增，仍可退出已有选择。'}${entries.length ? '' : '\n暂时没有开放的身份。'}`, rows));
    };
    const showOperation = async (op: StoredOperation, rolesPage = 0): Promise<void> => {
      if (!authority.isAdmin && op.actor.memberRef !== authority.memberRef) return missing();
      if (!authority.isAdmin && ['settings.apply', 'resources.sync', 'panel.refresh', 'room.managers'].includes(op.kind)) return missing();
      // Operation history survives retirement, but its old result is never
      // reopened or used to rename a room through a stale AI suggestion.
      if (op.kind.startsWith('fun.')) { await respond(message(RETIRED_NOTICE)); return; }
      const result = object(op.result);
      const target = op.roomRef ?? (typeof result.roomRef === 'string' ? result.roomRef : null);
      let closed = false;
      if (target) {
        if (!isCommunityRef(target)) return missing();
        const current = await deps.service.store.getRoom(target);
        if (current?.status === 'closed') {
          if (!canReadRoom(authority, current, await deps.service.store.roomAccess(target))) return missing();
          closed = true;
        } else await roomFor(target);
      }
      const refreshId = `v1:community:op:${op.ref}${op.kind === 'roles.set' ? `:roles:${rolesPage}` : ''}`;
      const navigation = [row([button('刷新操作状态', refreshId), ...(target && isCommunityRef(target) ? [button('查看房间', `v1:community:room:${target}`)] : [button('兴趣身份', `v1:community:roles:page:${rolesPage}`)])])];
      if (op.status === 'succeeded') {
        // The shared panel synchronizer owns public renders. Successful quiet
        // submissions do not emit a new receipt or edit that shared message.
        if (response.quiet) return;
        if (op.kind === 'roles.set') {
          try { await showRoles(rolesPage, '操作已完成'); }
          catch { await respond(message('操作已完成，身份状态暂不可用，请刷新查看。', navigation)); }
          return;
        }
        if (target && isCommunityRef(target)) {
          if (closed) { await respond(message('操作已完成\n房间已关闭。', [row([button('我的房间', 'v1:community:room')])])); return; }
          // Only a fresh, authorized room view can supply current controls.
          // A transient read failure must not turn completed execution into a
          // failed action; access loss still follows the same private absence.
          try {
            await showRoom(target, '操作已完成');
          } catch (error) {
            if (error instanceof CommunityStoreError) throw error;
            await respond(message('操作已完成，房间状态暂不可用，请刷新查看。', navigation));
          }
          return;
        }
      }
      await respond(message(`${operationStates[op.status] ?? '状态未知，请刷新确认'}${op.error ? `\n${clean(op.error, 400)}` : ''}`, navigation));
    };
    const enqueue = async (kind: string, roomRef: string | null, payload: CommunityJson, expectedVersion?: number, rolesPage = 0): Promise<void> => {
      const op = await deps.service.enqueueForActor(actor, kind, roomRef, payload, `interaction:${interaction.id}`, expectedVersion);
      // The queue is durable already. A slow or failed wake must not hold the
      // interaction open or encourage the member to execute the action twice.
      try { void deps.wake?.().catch(() => undefined); } catch { /* Scheduled execution will retry. */ }
      const current = await readOperationBriefly(deps, op.ref);
      // Polling may outlive a membership/admin change. Recheck once at the
      // final read boundary, rather than repeating permissions on every poll.
      await refreshAuthority();
      if (current) await showOperation(current, rolesPage);
      else await respond(message('操作已受理，状态暂不可用，请刷新确认。', [row([button('刷新操作状态', `v1:community:op:${op.ref}${kind === 'roles.set' ? `:roles:${rolesPage}` : ''}`)])]));
    };
    if (interaction.isChatInputCommand()) {
      if (command === 'room') await showRoom();
      else if (command === 'roles') await showRoles();
    } else if (parts[0] === 'room' || parts[0] === 'rooms') await showRoom(parts[0] === 'room' ? parts[1] : undefined);
    else if (parts[0] === 'panel' && interaction.isButton()) {
      const room = await roomFor(parts[2]);
      if (room.status !== 'active') throw new CommunityStoreError(409, 'version_conflict', '房间当前暂不可操作。');
      if (parts[1] === 'more') await showRoom(room.ref);
      else if (parts[1] === 'visibility') {
        if (!canControlRoom(authority, room)) throw new CommunityStoreError(403, 'not_owner', '只有已分配的固定房管理员可以管理房间。');
        await respond(message('选择房间访问方式。', [row([{ type: 3, custom_id: `v1:community:setvisibility:${room.ref}:${room.version}`, options: [{ label: '公开：所有成员可进入', value: 'open' }, { label: '锁门：仅允许的成员可进入', value: 'locked' }, { label: '隐藏：仅允许的成员可查看', value: 'hidden' }] }]), backToRoom(room.ref)]));
      } else return missing();
    } else if (parts[0] === 'panelsubmit' && interaction.isModalSubmit() && ['rename', 'limit'].includes(parts[1])) {
      const room = await roomFor(parts[2]);
      if (room.status !== 'active') throw new CommunityStoreError(409, 'version_conflict', '房间当前暂不可操作。');
      if (!canControlRoom(authority, room)) throw new CommunityStoreError(403, 'not_owner', '只有已分配的固定房管理员可以管理房间。');
      await enqueue(`room.${parts[1]}`, room.ref, parts[1] === 'limit' ? { userLimit: Number(interaction.fields.getTextInputValue('value')) } : { name: interaction.fields.getTextInputValue('value') }, room.version);
    } else if (parts[0] === 'roles' && parts[1] !== 'set') await showRoles(parts[1] === 'page' ? Math.max(0, Number(parts[2]) || 0) : 0);
    else if (parts[0] === 'roles' && parts[1] === 'set' && interaction.isStringSelectMenu()) {
      const roles = await deps.membership.readRoles(authority.memberRef), page = Math.max(0, Number(parts[2]) || 0), choices = roles.choices.slice(page * 25, (page + 1) * 25).map(role => role.ref);
      if (interaction.values.some(ref => !choices.includes(ref))) return missing();
      await enqueue('roles.set', null, { roleRefs: [...roles.selectedRefs.filter(ref => !choices.includes(ref)), ...interaction.values] }, undefined, page);
    } else if (parts[0] === 'roomselect' && interaction.isStringSelectMenu()) await showRoom(interaction.values[0]);
    else if (parts[0] === 'submit' && interaction.isModalSubmit()) {
      if (parts[1] === 'create') await enqueue('room.create', null, { name: interaction.fields.getTextInputValue('value') });
      else { const room = await roomFor(parts[2]); await enqueue(`room.${parts[1]}`, room.ref, parts[1] === 'limit' ? { userLimit: Number(interaction.fields.getTextInputValue('value')) } : { name: interaction.fields.getTextInputValue('value') }, version(parts[3])); }
    } else if (parts[0] === 'visibility' && interaction.isButton()) {
      const room = await roomFor(parts[1]); await respond(message('选择房间可见性。', [row([{ type: 3, custom_id: `v1:community:setvisibility:${room.ref}:${version(parts[2])}`, options: [{ label: '开放：所有成员可进入', value: 'open' }, { label: '上锁：仅允许的成员可进入', value: 'locked' }, { label: '隐藏：仅允许的成员可查看', value: 'hidden' }] }]), backToRoom(room.ref)]));
    } else if (parts[0] === 'setvisibility' && interaction.isStringSelectMenu()) { await roomFor(parts[1]); await enqueue('room.visibility', parts[1], { visibility: interaction.values[0] }, version(parts[2])); }
    else if (parts[0] === 'target' && interaction.isButton()) {
      await roomFor(parts[2]); await respond(message(parts[1] === 'transfer' ? '选择接任者。对方必须已经能查看房间，并主动接受转让。' : '选择要操作的社区成员。', [row([{ type: 5, custom_id: `v1:community:settarget:${parts[1]}:${parts[2]}:${version(parts[3])}`, min_values: 1, max_values: 1 }]), backToRoom(parts[2])]));
    } else if (parts[0] === 'settarget' && interaction.isUserSelectMenu()) {
      await roomFor(parts[2]); const target = await deps.discord.member(interaction.values[0]); if (!target || target.bot) return missing();
      const stored = await deps.service.store.resourceByExternal('member', target.id); if (!stored?.available) return missing();
      await enqueue(`room.${parts[1]}`, parts[2], { memberRef: stored.ref }, version(parts[3]));
    } else if (parts[0] === 'confirm' && interaction.isButton()) {
      await roomFor(parts[2]); await respond(message(parts[1] === 'admin_delete' ? '确认把所有成员移往配置的等候区后解散？任何一步失败都会停止删除。' : '确认解散这个空房间？房间内仍有人时不会执行。', [row([button('确认解散', `v1:community:act:${parts[1]}:${parts[2]}:${version(parts[3])}`, 4), button('取消，返回房间', `v1:community:room:${parts[2]}`)])]));
    } else if (parts[0] === 'act') { await roomFor(parts[2]); await enqueue(`room.${parts[1]}`, parts[2], parts[1] === 'admin_delete' ? { confirm: true } : {}, version(parts[3])); }
    else if (parts[0] === 'op') { if (!isCommunityRef(parts[1])) return missing(); const op = await deps.service.store.getOperation(parts[1]); if (!op) return missing(); await showOperation(op, parts[2] === 'roles' ? Math.max(0, Number(parts[3]) || 0) : 0); }
    else return missing();
  } catch (error) {
    await respond(message(error instanceof CommunityStoreError ? safeCommunityText(error.message) : '社区功能暂不可用，请刷新后重试。',
      [row([button('我的房间', 'v1:community:room'), button('兴趣身份', 'v1:community:roles')])]));
  }
  return true;
}
