// Community contracts contain only opaque references. Discord identifiers stay
// inside the Node community adapter/store and never become browser DTO fields.
export type CommunityVisibility = 'open' | 'locked' | 'hidden';
export type CommunityResourceKind = 'category' | 'voice' | 'text' | 'role' | 'member';
export type CommunityTool = 'poll' | 'teams' | 'draw' | 'roll' | 'topic' | 'ai';
export const COMMUNITY_TOOLS: readonly CommunityTool[] = ['poll', 'teams', 'draw', 'roll', 'topic', 'ai'];
export interface CommunityTopic { ref: string; text: string; tags: string[] }
export interface CommunitySettings {
  enabled: boolean;
  rooms: { enabled: boolean; categoryRef: string | null; creatorRef: string | null; waitingRef: string | null;
    panelRef: string | null; visibility: CommunityVisibility; maxPerMember: number; maxRooms: number;
    cooldownSeconds: number; emptyGraceSeconds: number; ownerGraceSeconds: number; userLimit: number; maxUserLimit: number };
  welcome: { enabled: boolean; channelRef: string | null; template: string; rejoinCooldownHours: number };
  roles: { enabled: boolean; allowedRefs: string[]; maxChoices: number };
  fun: { enabled: boolean; enabledTools: CommunityTool[]; cooldownSeconds: number; pollMaxHours: number;
    pollMaxOptions: number; maxParticipants: number; maxDiceCount: number; maxDiceSides: number; topics: CommunityTopic[];
    ai: { enabled: boolean; userDailyLimit: number; guildDailyLimit: number; prompt: string } };
}
export interface CommunityResourceView { ref: string; name: string; kind: CommunityResourceKind; available: boolean; safe?: boolean }
export interface CommunityMemberView { ref: string; name: string }
export interface CommunityRoomView {
  ref: string; name: string; owner: CommunityMemberView | null; members: CommunityMemberView[];
  status: string; visibility: CommunityVisibility; userLimit: number; version: number;
  canManage: boolean; canClaim: boolean; transferTo: CommunityMemberView | null;
  cleanupAt: string | null; createdAt: string; updatedAt: string;
}
export type CommunityOperationStatus = 'queued' | 'running' | 'retry_wait' | 'succeeded' | 'failed' | 'conflict' | 'canceled' | 'needs_review';
export type CommunityJson = null | boolean | number | string | CommunityJson[] | { [key: string]: CommunityJson };
export interface CommunityOperationView { ref: string; kind: string; roomRef: string | null; status: CommunityOperationStatus;
  createdAt: string; finishedAt: string | null; error: string | null; result: CommunityJson }
export interface CommunityAuditView { ref: string; actor: string; action: string; target: string | null; outcome: string; createdAt: string }
export interface CommunityRuntimeView { ready: boolean; syncedAt: string | null; appliedVersion: number; problem: string | null }
export interface CommunityMeView { linked: boolean; member: CommunityMemberView | null; isAdmin: boolean; needsMembership: boolean }
export interface CommunityPublicSettings {
  enabled: boolean;
  rooms: Pick<CommunitySettings['rooms'], 'enabled' | 'visibility' | 'maxPerMember' | 'maxRooms' | 'cooldownSeconds' | 'emptyGraceSeconds' | 'ownerGraceSeconds' | 'userLimit' | 'maxUserLimit'>;
  roles: Pick<CommunitySettings['roles'], 'enabled' | 'maxChoices'>;
  fun: Omit<CommunitySettings['fun'], 'ai' | 'topics'> & { ai: Omit<CommunitySettings['fun']['ai'], 'prompt'>; tags: string[] };
}
export interface CommunityOverview { settings: CommunityPublicSettings; version: number; runtime: CommunityRuntimeView; me: CommunityMeView }
export interface CommunityFunView { ref: string; kind: CommunityTool; title: string; data: CommunityJson; status: 'open' | 'closed';
  roomRef: string | null; createdAt: string; closesAt: string | null; creator: CommunityMemberView | null }

export function isCommunityRef(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
}
export function defaultCommunitySettings(): CommunitySettings {
  return {
    enabled: false,
    rooms: { enabled: false, categoryRef: null, creatorRef: null, waitingRef: null, panelRef: null,
      visibility: 'open', maxPerMember: 1, maxRooms: 25, cooldownSeconds: 30,
      emptyGraceSeconds: 120, ownerGraceSeconds: 120, userLimit: 0, maxUserLimit: 99 },
    welcome: { enabled: false, channelRef: null, template: '欢迎 {name} 来到 {server}！从社区中心选择兴趣身份，也可以创建自己的语音房。', rejoinCooldownHours: 24 },
    roles: { enabled: false, allowedRefs: [], maxChoices: 5 },
    fun: { enabled: true, enabledTools: [...COMMUNITY_TOOLS], cooldownSeconds: 5, pollMaxHours: 168,
      pollMaxOptions: 10, maxParticipants: 40, maxDiceCount: 20, maxDiceSides: 1000,
      topics: [{ ref: 'c2845d73-47cc-4037-966c-61ce46e26777', text: '最近玩到最想推荐的游戏是什么？', tags: ['游戏'] },
        { ref: 'e6cc9dd1-0a22-4ed2-84f4-0723a0c10bcb', text: '如果今晚换一种玩法，你想尝试什么？', tags: ['闲聊'] }],
      ai: { enabled: false, userDailyLimit: 5, guildDailyLimit: 50,
        prompt: '根据用户主动输入的主题，给出三个简短、友好的中文房间名或讨论话题。只返回建议文本，不执行操作，不包含提及、链接或个人信息。' } },
  };
}
const fail = (field: string): never => { throw new Error(`社区设置 ${field} 格式或范围无效`); };
function object(value: unknown, fields: readonly string[], path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail(path);
  const out = value as Record<string, unknown>;
  if (Object.keys(out).some(key => !fields.includes(key))) return fail(path);
  return out;
}
function bool(value: unknown, path: string): boolean { return typeof value === 'boolean' ? value : fail(path); }
function integer(value: unknown, min: number, max: number, path: string): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fail(path);
}
function text(value: unknown, min: number, max: number, path: string): string {
  if (typeof value !== 'string' || value.includes('\u0000') || value.trim().length < min || value.length > max) return fail(path);
  return value.trim();
}
function ref(value: unknown, path: string): string | null { return value === null || isCommunityRef(value) ? value : fail(path); }
function refs(value: unknown, max: number, path: string): string[] {
  if (!Array.isArray(value) || value.length > max || value.some(v => !isCommunityRef(v))) return fail(path);
  return [...new Set(value as string[])];
}
export function parseCommunitySettings(input: unknown): CommunitySettings {
  const c = object(input, ['enabled', 'rooms', 'welcome', 'roles', 'fun'], '根');
  const r = object(c.rooms, ['enabled', 'categoryRef', 'creatorRef', 'waitingRef', 'panelRef', 'visibility', 'maxPerMember', 'maxRooms', 'cooldownSeconds', 'emptyGraceSeconds', 'ownerGraceSeconds', 'userLimit', 'maxUserLimit'], '房间');
  const w = object(c.welcome, ['enabled', 'channelRef', 'template', 'rejoinCooldownHours'], '欢迎');
  const roles = object(c.roles, ['enabled', 'allowedRefs', 'maxChoices'], '身份');
  const f = object(c.fun, ['enabled', 'enabledTools', 'cooldownSeconds', 'pollMaxHours', 'pollMaxOptions', 'maxParticipants', 'maxDiceCount', 'maxDiceSides', 'topics', 'ai'], '互动');
  const ai = object(f.ai, ['enabled', 'userDailyLimit', 'guildDailyLimit', 'prompt'], '互动 AI');
  if (!['open', 'locked', 'hidden'].includes(String(r.visibility))) return fail('房间可见性');
  if (!Array.isArray(f.enabledTools) || f.enabledTools.some(v => !COMMUNITY_TOOLS.includes(v))) return fail('互动工具');
  if (!Array.isArray(f.topics) || f.topics.length > 200) return fail('题库');
  const topics = f.topics.map((value: unknown) => {
    const t = object(value, ['ref', 'text', 'tags'], '话题');
    if (!isCommunityRef(t.ref) || !Array.isArray(t.tags) || t.tags.length > 10) return fail('话题');
    return { ref: t.ref, text: text(t.text, 1, 500, '话题正文'), tags: t.tags.map(tag => text(tag, 1, 30, '话题标签')) };
  });
  const template = text(w.template, 1, 1500, '欢迎模板');
  if ((template.match(/\{[^{}]*\}/g) ?? []).some(key => !['{name}', '{server}', '{memberCount}'].includes(key))) return fail('欢迎占位符');
  const result: CommunitySettings = {
    enabled: bool(c.enabled, '总开关'),
    rooms: { enabled: bool(r.enabled, '房间开关'), categoryRef: ref(r.categoryRef, '分类'), creatorRef: ref(r.creatorRef, '创建入口'), waitingRef: ref(r.waitingRef, '等候区'), panelRef: ref(r.panelRef, '控制面板'),
      visibility: r.visibility as CommunityVisibility, maxPerMember: integer(r.maxPerMember, 1, 1, '每人房间数'), maxRooms: integer(r.maxRooms, 1, 100, '总房间数'),
      cooldownSeconds: integer(r.cooldownSeconds, 0, 3600, '创建冷却'), emptyGraceSeconds: integer(r.emptyGraceSeconds, 15, 86400, '空房宽限'), ownerGraceSeconds: integer(r.ownerGraceSeconds, 15, 86400, '房主宽限'),
      userLimit: integer(r.userLimit, 0, 99, '默认人数'), maxUserLimit: integer(r.maxUserLimit, 1, 99, '人数上限') },
    welcome: { enabled: bool(w.enabled, '欢迎开关'), channelRef: ref(w.channelRef, '欢迎频道'), template, rejoinCooldownHours: integer(w.rejoinCooldownHours, 1, 720, '重入冷却') },
    roles: { enabled: bool(roles.enabled, '身份开关'), allowedRefs: refs(roles.allowedRefs, 100, '身份白名单'), maxChoices: integer(roles.maxChoices, 1, 20, '身份数量') },
    fun: { enabled: bool(f.enabled, '互动开关'), enabledTools: [...new Set(f.enabledTools)] as CommunityTool[], cooldownSeconds: integer(f.cooldownSeconds, 0, 3600, '互动冷却'),
      pollMaxHours: integer(f.pollMaxHours, 1, 720, '投票时长'), pollMaxOptions: integer(f.pollMaxOptions, 2, 10, '投票选项'), maxParticipants: integer(f.maxParticipants, 2, 100, '参与人数'),
      maxDiceCount: integer(f.maxDiceCount, 1, 100, '骰子数量'), maxDiceSides: integer(f.maxDiceSides, 2, 1000000, '骰子面数'), topics,
      ai: { enabled: bool(ai.enabled, 'AI 开关'), userDailyLimit: integer(ai.userDailyLimit, 1, 1000, '个人 AI 配额'), guildDailyLimit: integer(ai.guildDailyLimit, 1, 10000, '全服 AI 配额'), prompt: text(ai.prompt, 1, 4000, '社区 AI 提示词') } },
  };
  if (result.rooms.userLimit > result.rooms.maxUserLimit) return fail('默认人数');
  if (result.rooms.waitingRef && result.rooms.waitingRef === result.rooms.creatorRef) return fail('等候区不能是创建入口');
  if (result.enabled && result.rooms.enabled && (!result.rooms.categoryRef || !result.rooms.creatorRef)) return fail('启用房间需要分类和创建入口');
  if (result.enabled && result.welcome.enabled && !result.welcome.channelRef) return fail('启用欢迎需要频道');
  return result;
}
