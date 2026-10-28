import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, type APIActionRowComponent, type APIComponentInMessageActionRow, type Interaction, type RepliableInteraction } from 'discord.js';
import { isCommunityRef, type CommunityFunView, type CommunityJson } from '../../../shared/community';
import { COMMUNITY_COMMANDS } from './commands';
import type { CommunityDiscord } from './discord';
import type { CommunityFunService } from './fun-service';
import type { CommunityMembershipService } from './membership';
import { canReadRoom, safeCommunityText } from './security';
import type { CommunityService } from './service';
import { CommunityStoreError, type CommunityActor, type StoredOperation, type StoredRoom } from './store';

export interface CommunityInteractionDependencies {
  guildId: string; frontendUrl: string; service: CommunityService; discord: CommunityDiscord;
  membership: CommunityMembershipService; fun: CommunityFunService; wake?: () => Promise<void>;
}
type Row = APIActionRowComponent<APIComponentInMessageActionRow>;
interface Message { content: string; components: Row[]; allowedMentions: { parse: [] } }
const row = (components: APIComponentInMessageActionRow[]): Row => ({ type: 1, components });
const button = (label: string, custom_id: string, style: 1 | 2 | 3 | 4 = 2): APIComponentInMessageActionRow => ({ type: 2, label, custom_id, style });
const clean = (value: unknown, max = 100): string => safeCommunityText(String(value ?? '')).replace(/[\r\n]/g, ' ').slice(0, max);
const object = (value: CommunityJson): { [key: string]: CommunityJson } => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
function message(content: string, components: Row[] = []): Message { return { content: safeCommunityText(content).slice(0, 1950), components: components.slice(0, 5), allowedMentions: { parse: [] } }; }
function missing(): never { throw new CommunityStoreError(404, 'not_found', '内容不存在或已不可见'); }
function version(value: string | undefined): number { const number = Number(value); if (!Number.isSafeInteger(number) || number < 1) return missing(); return number; }
const splitItems = (text: string): string[] => text.split(/[;；\n]/).map(item => item.trim()).filter(Boolean);

/** Native results remain usable without a website account. Every custom id
 * carries only an opaque reference; every follow-up reads permissions again. */
export function renderCommunityFun(item: CommunityFunView): Message {
  const value = object(item.data), lines: string[] = [clean(item.title, 200)], rows: Row[] = [];
  if (item.kind === 'poll') {
    const options = Array.isArray(value.options) ? value.options : [], totals = Array.isArray(value.totals) ? value.totals : [];
    options.slice(0, 10).forEach((option, index) => lines.push(`${index + 1}. ${clean(option)} · ${Number(totals[index] ?? 0)} 票${value.myChoice === index ? '（你的选择）' : ''}`));
    lines.push(item.status === 'open' ? '截止前可重复点击改票。' : '投票已结束。');
    if (item.closesAt) lines.push(`截止：${clean(item.closesAt, 30)}`);
    if (item.status === 'open') {
      for (let offset = 0; offset < options.length; offset += 5) rows.push(row(options.slice(offset, offset + 5).map((option, index) => button(`${offset + index + 1}. ${clean(option, 65)}`, `v1:community:vote:${item.ref}:${offset + index}`, 1))));
      rows.push(row([button('结束投票（发起者 / 管理员）', `v1:community:close:${item.ref}`, 4)]));
    }
  } else if (item.kind === 'teams') {
    if (Array.isArray(value.teams)) for (const raw of value.teams) { const team = object(raw); lines.push(`${clean(team.name)}：${Array.isArray(team.members) ? team.members.map(member => clean(object(member).name)).join('、') : ''}`); }
  } else if (item.kind === 'draw') {
    lines.push(`抽中：${Array.isArray(value.picked) ? value.picked.map(item => clean(item)).join('、') : ''}`);
    if (typeof value.previousRef === 'string') lines.push('这是新的一轮，原抽签结果仍保留。');
    rows.push(row([button('重新抽签（保留原结果）', `v1:community:redraw:${item.ref}`)]));
  } else if (item.kind === 'roll') lines.push(`${Array.isArray(value.rolls) ? value.rolls.join(' + ') : ''} = ${Number(value.total ?? 0)}`);
  else if (item.kind === 'topic') lines.push(clean(value.text, 1200));
  else if (item.kind === 'ai') {
    const suggestions = Array.isArray(value.suggestions) ? value.suggestions.slice(0, 3) : [];
    suggestions.forEach((text, index) => lines.push(`${index + 1}. ${clean(text, 300)}`));
    if (value.source === 'fallback') lines.push('AI 暂不可用，以上为备用建议。');
    if (value.purpose === 'room_name' && suggestions.length) {
      lines.push('建议只是一段文字；点击确认后才会修改你拥有的房间。');
      rows.push(row(suggestions.map((_, index) => button(`确认用建议 ${index + 1} 命名`, `v1:community:aiapply:${item.ref}:${index}`, 3))));
    }
  }
  rows.push(row([button('刷新结果', `v1:community:fun:${item.ref}`), button('社区互动', 'v1:community:play')]));
  return message(lines.join('\n'), rows);
}

export async function handleCommunityInteraction(interaction: Interaction, deps: CommunityInteractionDependencies): Promise<boolean> {
  const command = interaction.isChatInputCommand() ? interaction.commandName : null;
  const customId = 'customId' in interaction ? interaction.customId : '';
  if (!(command && COMMUNITY_COMMANDS.some(item => item.name === command)) && !customId.startsWith('v1:community:')) return false;
  if (!interaction.isRepliable()) return true;
  const input: RepliableInteraction = interaction;
  const respond = async (out: Message): Promise<void> => { if (input.deferred || input.replied) await input.editReply(out); else await input.reply({ ...out, flags: 64 }); };
  if (interaction.guildId !== deps.guildId) { await respond(message('请在配置的社区服务器内使用。')); return true; }
  const parts = customId.split(':').slice(2);
  // Showing a modal must be the very first interaction response. Submitted
  // values are untrusted and receive the complete authorization below.
  if (interaction.isButton() && (parts[0] === 'edit' || parts[0] === 'tool' && ['poll', 'draw', 'ai'].includes(parts[1]))) {
    const action = parts[1], edit = parts[0] === 'edit';
    const modal = new ModalBuilder().setCustomId(edit ? `v1:community:submit:${action}:${parts[2] ?? ''}:${parts[3] ?? ''}` : `v1:community:toolsubmit:${action}`).setTitle(edit ? action === 'limit' ? '房间人数上限' : action === 'create' ? '创建我的房间' : '修改房间名' : action === 'poll' ? '发起投票' : action === 'draw' ? '抽签' : 'AI 房间名建议');
    const add = (id: string, label: string, max: number, paragraph = false) => modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short).setMaxLength(max).setRequired(true)));
    if (edit) add('value', action === 'limit' ? '0–99；0 表示不限人数' : '名字（最多 100 字）', 100);
    else if (action === 'poll') { add('question', '问题', 200); add('options', '每行一个选项，至少两个', 1100, true); }
    else if (action === 'draw') { add('items', '每行一个候选内容', 3000, true); add('count', '抽取数量', 3); }
    else add('theme', '本次主动提供的主题（不读取聊天）', 300, true);
    await interaction.showModal(modal); return true;
  }
  await input.deferReply({ flags: 64 });
  try {
    const authority = await deps.service.actorFromDiscord(interaction.user.id);
    const live = await deps.discord.member(interaction.user.id);
    if (!authority.memberAvailable || !authority.memberRef || !live || live.bot) throw new CommunityStoreError(403, 'membership_required', '需要当前社区成员身份；机器人可能尚未同步，请稍后重试。');
    const actor: CommunityActor = { source: 'discord', memberRef: authority.memberRef };
    const roomFor = async (ref: string): Promise<StoredRoom> => {
      if (!isCommunityRef(ref)) return missing(); const room = await deps.service.store.getRoom(ref);
      if (!room || room.status === 'closed' || !canReadRoom(authority, room, await deps.service.store.roomAccess(ref))) return missing();
      const channel = room.channelRef ? await deps.service.store.resource(room.channelRef, 'voice') : null;
      if (!authority.isAdmin && (!channel?.available || !await deps.discord.canView(interaction.user.id, channel.externalId))) return missing(); return room;
    };
    const funFor = async (ref: string): Promise<CommunityFunView> => { const item = await deps.fun.get(ref, authority.memberRef, authority.isAdmin); if (item.roomRef) await roomFor(item.roomRef); return item; };
    const showRoom = async (ref?: string, page = 0): Promise<void> => {
      if (!ref) {
        const visible: StoredRoom[] = [];
        for (const room of await deps.service.store.listRooms()) { try { visible.push(await roomFor(room.ref)); } catch { /* Private and missing rooms have the same absence. */ } }
        const mine = visible.find(room => room.ownerRef === authority.memberRef); if (mine) return showRoom(mine.ref);
        const entries = visible.slice(page * 25, (page + 1) * 25), rows: Row[] = [row([button('创建我的房间', 'v1:community:edit:create', 3), button('刷新', `v1:community:rooms:${page}`)])];
        if (entries.length) rows.push(row([{ type: 3, custom_id: 'v1:community:roomselect', placeholder: '选择可以查看的房间', options: entries.map(room => ({ label: clean(room.name), value: room.ref })) }]));
        if (visible.length > 25) rows.push(row([button('上一页', `v1:community:rooms:${Math.max(0, page - 1)}`), button('下一页', `v1:community:rooms:${Math.min(Math.ceil(visible.length / 25) - 1, page + 1)}`)]));
        await respond(message(`社区语音房\n先进入任一语音频道，再创建或加入房间。\n当前可查看 ${visible.length} 个房间。`, rows)); return;
      }
      const room = await roomFor(ref), access = await deps.service.store.roomAccess(ref), mine = room.ownerRef === authority.memberRef;
      const channel = room.channelRef ? await deps.service.store.resource(room.channelRef, 'voice') : null;
      const occupants = channel ? deps.discord.occupants(channel.externalId) : null;
      const prefix = (action: string) => `v1:community:act:${action}:${room.ref}:${room.version}`;
      const rows: Row[] = [row([button('加入房间', prefix('join'), 3), button('刷新房间', `v1:community:room:${room.ref}`), button('房间列表', 'v1:community:rooms:0')])];
      if (mine || authority.isAdmin) {
        rows.push(row([button('改名', `v1:community:edit:rename:${room.ref}:${room.version}`), button('人数', `v1:community:edit:limit:${room.ref}:${room.version}`), button('可见性', `v1:community:visibility:${room.ref}:${room.version}`)]));
        rows.push(row([button('允许成员', `v1:community:target:grant:${room.ref}:${room.version}`), button('禁止成员', `v1:community:target:deny:${room.ref}:${room.version}`), button('移出成员', `v1:community:target:kick:${room.ref}:${room.version}`), button('转让房主', `v1:community:target:transfer:${room.ref}:${room.version}`)]));
        rows.push(row([button('解散空房间', `v1:community:confirm:dissolve:${room.ref}:${room.version}`, 4), ...(authority.isAdmin ? [button('管理员移往等候区后解散', `v1:community:confirm:admin_delete:${room.ref}:${room.version}`, 4)] : [])]));
      } else {
        const actions: APIComponentInMessageActionRow[] = [];
        if (room.transferToRef === authority.memberRef) actions.push(button('接受房主转让', prefix('accept'), 3));
        const config = (await deps.service.store.settings()).settings;
        if (occupants?.includes(interaction.user.id) && room.ownerLeftAt && Date.now() >= Date.parse(room.ownerLeftAt) + config.rooms.ownerGraceSeconds * 1000) actions.push(button('认领房间', prefix('claim'), 3));
        if (actions.length) rows.push(row(actions));
      }
      await respond(message(`${clean(room.name)}\n${mine ? '你是房主' : '社区房间'} · ${room.visibility === 'open' ? '开放' : room.visibility === 'locked' ? '上锁' : '隐藏'} · ${room.userLimit || '不限'} 人\n${occupants === null ? '语音状态暂不可用' : `当前 ${occupants.length} 人`} · ${access.filter(item => item.allowed).length} 位受邀成员\n状态：${room.status}${room.transferToRef ? '\n有一项待接受的房主转让。' : ''}`, rows));
    };
    const showRoles = async (page = 0): Promise<void> => {
      const roles = await deps.membership.readRoles(authority.memberRef!); const entries = roles.choices.slice(page * 25, (page + 1) * 25), rows: Row[] = [];
      if (entries.length) rows.push(row([{ type: 3, custom_id: `v1:community:roles:set:${page}`, placeholder: '选择兴趣身份；取消选中即可退出', min_values: 0, max_values: Math.min(roles.maxChoices, entries.length), options: entries.map(role => ({ label: clean(role.name), value: role.ref, default: roles.selectedRefs.includes(role.ref), ...(role.available ? {} : { description: '已停止开放，可取消选中退出' }) })) }]));
      if (roles.choices.length > 25) rows.push(row([button('上一页', `v1:community:roles:page:${Math.max(0, page - 1)}`), button('下一页', `v1:community:roles:page:${Math.min(Math.ceil(roles.choices.length / 25) - 1, page + 1)}`)]));
      await respond(message(`兴趣身份\n最多选择 ${roles.maxChoices} 个。${roles.enabled ? '' : '目前停止新增，仍可退出已有选择。'}${entries.length ? '' : '\n暂时没有开放的身份。'}`, rows));
    };
    const showPlay = async (): Promise<void> => {
      const available = (await deps.service.store.settings()).settings.fun.enabledTools;
      const labels: Record<string, string> = { poll: '发起投票', teams: '随机分队', draw: '抽签', roll: '掷骰', topic: '话题卡', ai: 'AI 建议' };
      const buttons = available.map(tool => button(labels[tool], `v1:community:tool:${tool}`)); const rows: Row[] = [];
      for (let n = 0; n < buttons.length; n += 5) rows.push(row(buttons.slice(n, n + 5)));
      const items: CommunityFunView[] = []; for (const item of await deps.fun.list(authority.memberRef, authority.isAdmin)) { try { if (item.roomRef) await roomFor(item.roomRef); items.push(item); } catch { /* same privacy as room lists */ } if (items.length >= 25) break; }
      if (items.length) rows.push(row([{ type: 3, custom_id: 'v1:community:funselect', placeholder: '查看近期结果或参与投票', options: items.map(item => ({ label: clean(item.title), value: item.ref, description: item.kind === 'poll' ? item.status === 'open' ? '可投票或改票' : '已结束' : '查看结果' })) }]));
      await respond(message('社区互动\n主动选择工具即可参与。无需绑定网页账号。\n所有结果可从这里重新打开，投票截止前可以改票。', rows));
    };
    const showOperation = async (op: StoredOperation): Promise<void> => {
      if (!authority.isAdmin && op.actor.memberRef !== authority.memberRef) return missing();
      if (!authority.isAdmin && ['settings.apply', 'resources.sync', 'panel.refresh', 'room.admin_delete'].includes(op.kind)) return missing();
      if (op.roomRef) {
        const storedRoom = await deps.service.store.getRoom(op.roomRef);
        if (storedRoom?.status === 'closed') {
          if (!canReadRoom(authority, storedRoom, await deps.service.store.roomAccess(storedRoom.ref))) return missing();
          await respond(message(`${op.status === 'succeeded' ? '操作已完成' : op.error ? clean(op.error, 400) : '操作已结束'}\n房间已关闭。`, [row([button('刷新操作状态', `v1:community:op:${op.ref}`), button('我的房间', 'v1:community:room')])]));
          return;
        }
        await roomFor(op.roomRef);
      }
      const result = object(op.result);
      if (op.status === 'succeeded' && result.item && typeof result.item === 'object' && !Array.isArray(result.item) && typeof result.item.ref === 'string') { await respond(renderCommunityFun(await funFor(result.item.ref))); return; }
      const states: Record<string, string> = { queued: '已排队，尚未执行', running: '正在执行', retry_wait: '等待重试', succeeded: '操作已完成', failed: '操作失败', conflict: '内容或权限已变化，请刷新后重试', canceled: '操作已取消', needs_review: '执行结果需要管理员核对，请勿重复操作' };
      const target = typeof result.roomRef === 'string' ? result.roomRef : op.roomRef;
      await respond(message(`${states[op.status] ?? '状态未知'}${op.error ? `\n${clean(op.error, 400)}` : ''}`, [row([button('刷新操作状态', `v1:community:op:${op.ref}`), ...(target && isCommunityRef(target) ? [button('查看房间', `v1:community:room:${target}`)] : [])])]));
    };
    const enqueue = async (kind: string, roomRef: string | null, payload: CommunityJson, expectedVersion?: number): Promise<void> => {
      const op = await deps.service.enqueueForActor(actor, kind, roomRef, payload, `interaction:${interaction.id}`, expectedVersion);
      await deps.wake?.(); await showOperation(await deps.service.store.getOperation(op.ref) ?? op);
    };
    const createFun = async (kind: string, payload: CommunityJson): Promise<void> => {
      let roomRef: string | null = null;
      if (kind === 'ai' && object(payload).purpose === 'room_name') roomRef = (await deps.service.store.listRooms()).find(room => room.ownerRef === authority.memberRef && room.status === 'active')?.ref ?? null;
      await enqueue('fun.create', roomRef, { kind, input: payload, ...(roomRef ? { roomRef } : {}) });
    };
    if (interaction.isChatInputCommand()) {
      if (command === 'room') await showRoom();
      else if (command === 'roles') await showRoles();
      else if (command === 'poll') await createFun('poll', { question: interaction.options.getString('question', true), options: splitItems(interaction.options.getString('options', true)), hours: interaction.options.getInteger('hours') ?? 24 });
      else if (command === 'draw') await createFun('draw', { items: splitItems(interaction.options.getString('items', true)), count: interaction.options.getInteger('count') ?? 1 });
      else if (command === 'roll') await createFun('roll', { count: interaction.options.getInteger('count') ?? 1, sides: interaction.options.getInteger('sides') ?? 6 });
      else if (command === 'topic') await createFun('topic', { tag: interaction.options.getString('tag') ?? '' });
      else if (command === 'room_ai') await createFun('ai', { theme: interaction.options.getString('theme', true), purpose: interaction.options.getString('purpose') ?? 'room_name' });
      else if (command === 'teams') await respond(message('请选择明确参与分队的成员（最多 25 位）。', [row([{ type: 5, custom_id: `v1:community:teams:${interaction.options.getInteger('count') ?? 2}`, min_values: 2, max_values: Math.min(25, (await deps.service.store.settings()).settings.fun.maxParticipants) }])]));
    } else if (parts[0] === 'room' || parts[0] === 'rooms') await showRoom(parts[0] === 'room' ? parts[1] : undefined, parts[0] === 'rooms' ? Math.max(0, Number(parts[1]) || 0) : 0);
    else if (parts[0] === 'roles' && parts[1] !== 'set') await showRoles(parts[1] === 'page' ? Math.max(0, Number(parts[2]) || 0) : 0);
    else if (parts[0] === 'roles' && parts[1] === 'set' && interaction.isStringSelectMenu()) {
      const roles = await deps.membership.readRoles(authority.memberRef), page = Math.max(0, Number(parts[2]) || 0), choices = roles.choices.slice(page * 25, (page + 1) * 25).map(role => role.ref);
      if (interaction.values.some(ref => !choices.includes(ref))) return missing();
      await enqueue('roles.set', null, { roleRefs: [...roles.selectedRefs.filter(ref => !choices.includes(ref)), ...interaction.values] });
    } else if (parts[0] === 'roomselect' && interaction.isStringSelectMenu()) await showRoom(interaction.values[0]);
    else if (parts[0] === 'submit' && interaction.isModalSubmit()) {
      if (parts[1] === 'create') await enqueue('room.create', null, { name: interaction.fields.getTextInputValue('value') });
      else { const room = await roomFor(parts[2]); await enqueue(`room.${parts[1]}`, room.ref, parts[1] === 'limit' ? { userLimit: Number(interaction.fields.getTextInputValue('value')) } : { name: interaction.fields.getTextInputValue('value') }, version(parts[3])); }
    } else if (parts[0] === 'visibility' && interaction.isButton()) {
      const room = await roomFor(parts[1]); await respond(message('选择房间可见性。', [row([{ type: 3, custom_id: `v1:community:setvisibility:${room.ref}:${version(parts[2])}`, options: [{ label: '开放：所有成员可进入', value: 'open' }, { label: '上锁：仅允许的成员可进入', value: 'locked' }, { label: '隐藏：仅允许的成员可查看', value: 'hidden' }] }])]));
    } else if (parts[0] === 'setvisibility' && interaction.isStringSelectMenu()) { await roomFor(parts[1]); await enqueue('room.visibility', parts[1], { visibility: interaction.values[0] }, version(parts[2])); }
    else if (parts[0] === 'target' && interaction.isButton()) {
      await roomFor(parts[2]); await respond(message(parts[1] === 'transfer' ? '选择接任者。对方必须已经能查看房间，并主动接受转让。' : '选择要操作的社区成员。', [row([{ type: 5, custom_id: `v1:community:settarget:${parts[1]}:${parts[2]}:${version(parts[3])}`, min_values: 1, max_values: 1 }])]));
    } else if (parts[0] === 'settarget' && interaction.isUserSelectMenu()) {
      await roomFor(parts[2]); const target = await deps.discord.member(interaction.values[0]); if (!target || target.bot) return missing();
      const stored = await deps.service.store.resourceByExternal('member', target.id); if (!stored?.available) return missing();
      await enqueue(`room.${parts[1]}`, parts[2], { memberRef: stored.ref }, version(parts[3]));
    } else if (parts[0] === 'confirm' && interaction.isButton()) {
      await roomFor(parts[2]); await respond(message(parts[1] === 'admin_delete' ? '确认把所有成员移往配置的等候区后解散？任何一步失败都会停止删除。' : '确认解散这个空房间？房间内仍有人时不会执行。', [row([button('确认解散', `v1:community:act:${parts[1]}:${parts[2]}:${version(parts[3])}`, 4)])]));
    } else if (parts[0] === 'act') { await roomFor(parts[2]); await enqueue(`room.${parts[1]}`, parts[2], parts[1] === 'admin_delete' ? { confirm: true } : {}, version(parts[3])); }
    else if (parts[0] === 'op') { if (!isCommunityRef(parts[1])) return missing(); const op = await deps.service.store.getOperation(parts[1]); if (!op) return missing(); await showOperation(op); }
    else if (parts[0] === 'play') await showPlay();
    else if (parts[0] === 'fun' || parts[0] === 'funselect' && interaction.isStringSelectMenu()) await respond(renderCommunityFun(await funFor(parts[0] === 'fun' ? parts[1] : interaction.isStringSelectMenu() ? interaction.values[0] : '')));
    else if (parts[0] === 'vote') { const item = await funFor(parts[1]); await enqueue('fun.vote', item.roomRef, { ref: item.ref, choice: Number(parts[2]) }); }
    else if (parts[0] === 'close' || parts[0] === 'redraw') { const item = await funFor(parts[1]); await enqueue(`fun.${parts[0]}`, item.roomRef, { ref: item.ref }); }
    else if (parts[0] === 'aiapply') {
      const item = await funFor(parts[1]), value = object(item.data), index = Number(parts[2]);
      if (item.kind !== 'ai' || value.purpose !== 'room_name' || !Array.isArray(value.suggestions) || !Number.isInteger(index) || index < 0 || index >= value.suggestions.length) return missing();
      const room = item.roomRef ? await roomFor(item.roomRef) : (await deps.service.store.listRooms()).find(room => room.status === 'active' && room.ownerRef === authority.memberRef);
      if (!room || room.ownerRef !== authority.memberRef) throw new CommunityStoreError(403, 'not_owner', '只有当前房主可以确认应用建议。');
      await enqueue('room.rename', room.ref, { name: clean(value.suggestions[index]) }, room.version);
    } else if (parts[0] === 'tool') {
      if (parts[1] === 'teams') await respond(message('选择明确参与分队的成员（默认分成 2 队）。', [row([{ type: 5, custom_id: 'v1:community:teams:2', min_values: 2, max_values: Math.min(25, (await deps.service.store.settings()).settings.fun.maxParticipants) }])]));
      else if (parts[1] === 'roll') await createFun('roll', { count: 1, sides: 6 });
      else if (parts[1] === 'topic') await createFun('topic', {}); else return missing();
    } else if (parts[0] === 'teams' && interaction.isUserSelectMenu()) {
      const refs: string[] = []; for (const id of interaction.values) { const member = await deps.discord.member(id); const resource = member && !member.bot ? await deps.service.store.resourceByExternal('member', id) : null; if (!resource?.available) return missing(); refs.push(resource.ref); }
      await createFun('teams', { memberRefs: refs, teamCount: Number(parts[1]) });
    } else if (parts[0] === 'toolsubmit' && interaction.isModalSubmit()) {
      if (parts[1] === 'poll') await createFun('poll', { question: interaction.fields.getTextInputValue('question'), options: splitItems(interaction.fields.getTextInputValue('options')), hours: 24 });
      else if (parts[1] === 'draw') await createFun('draw', { items: splitItems(interaction.fields.getTextInputValue('items')), count: Number(interaction.fields.getTextInputValue('count')) });
      else if (parts[1] === 'ai') await createFun('ai', { theme: interaction.fields.getTextInputValue('theme'), purpose: 'room_name' }); else return missing();
    } else return missing();
  } catch (error) {
    await respond(message(error instanceof CommunityStoreError ? safeCommunityText(error.message) : '社区功能暂不可用，请刷新后重试。'));
  }
  return true;
}
