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
    panelRef: string | null; fixedCategoryRefs?: string[]; visibility: CommunityVisibility; maxPerMember: number; maxRooms: number;
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
  kind?: 'temporary' | 'fixed'; managers?: CommunityMemberView[]; panelProblem?: string | null;
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
    rooms: { enabled: false, categoryRef: null, creatorRef: null, waitingRef: null, panelRef: null, fixedCategoryRefs: [],
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
export interface CommunitySettingsIssue { path: string; label: string; message: string }
export class CommunitySettingsValidationError extends Error {
  readonly issues: CommunitySettingsIssue[];
  constructor(issues: readonly CommunitySettingsIssue[]) {
    super('请检查标出的社区设置'); this.name = 'CommunitySettingsValidationError';
    this.issues = issues.map(issue => ({ ...issue }));
  }
}

/** Both parsing and form feedback use this decoder. Invalid values only receive
 * placeholders so independent fields can be checked; issues always reject the
 * complete document before any decoded value can be saved. */
function decodeCommunitySettings(input: unknown): { value: CommunitySettings; issues: CommunitySettingsIssue[] } {
  const defaults = defaultCommunitySettings(), issues: CommunitySettingsIssue[] = [], issuePaths = new Set<string>();
  const hasIssue = (path: string) => issuePaths.has(path);
  const add = (path: string, label: string, message: string): void => { if (!hasIssue(path)) { issuePaths.add(path); issues.push({ path, label, message }); } };
  const object = (value: unknown, fields: readonly string[], path: string, label: string): Record<string, unknown> | null => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) { add(path, label, `${label}缺少有效配置，请重新加载后再试。`); return null; }
    const out = value as Record<string, unknown>;
    // Unknown names may themselves contain secrets or identifiers. Report the
    // known parent field rather than reflecting arbitrary property names.
    if (Object.keys(out).some(key => !fields.includes(key))) add(path, label, `${label}包含不支持的字段，请重新加载后再试。`);
    return out;
  };
  const bool = (value: unknown, path: string, label: string): boolean => {
    if (typeof value === 'boolean') return value;
    add(path, label, `${label}请选择开启或关闭。`); return false;
  };
  const integer = (value: unknown, min: number, max: number, path: string, label: string): number => {
    if (typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max) return value;
    add(path, label, `${label}须为 ${min}–${max} 的整数。`); return min;
  };
  const text = (value: unknown, min: number, max: number, path: string, label: string): string => {
    if (typeof value !== 'string' || value.trim().length < min) { add(path, label, `${label}为必填项，请填写 ${min}–${max} 个字符。`); return ''; }
    if (value.includes('\u0000')) add(path, label, `${label}不能包含空字符。`);
    else if (value.length > max) add(path, label, `${label}不能超过 ${max} 个字符。`);
    return value.trim();
  };
  const ref = (value: unknown, path: string, label: string, nullable = true): string | null => {
    if (value === null && nullable || isCommunityRef(value)) return value;
    add(path, label, `${label}请选择有效的资源；未配置时请选择暂不设置。`); return null;
  };
  const array = (value: unknown, max: number | null, path: string, label: string): unknown[] => {
    if (!Array.isArray(value)) { add(path, label, `${label}须为有效的列表。`); return []; }
    if (max !== null && value.length > max) { add(path, label, `${label}最多 ${max} 项。`); return []; }
    return value;
  };
  const refs = (value: unknown, max: number, path: string, label: string): string[] => [...new Set(array(value, max, path, label)
    .map((value, index) => ref(value, `${path}.${index}`, `${label}第 ${index + 1} 项`, false)).filter((value): value is string => value !== null))];
  const c = object(input, ['enabled', 'rooms', 'welcome', 'roles', 'fun'], '', '社区设置');
  if (!c) return { value: defaults, issues };
  const r = object(c.rooms, ['enabled', 'categoryRef', 'creatorRef', 'waitingRef', 'panelRef', 'fixedCategoryRefs', 'visibility', 'maxPerMember', 'maxRooms', 'cooldownSeconds', 'emptyGraceSeconds', 'ownerGraceSeconds', 'userLimit', 'maxUserLimit'], 'rooms', '语音房间');
  const w = object(c.welcome, ['enabled', 'channelRef', 'template', 'rejoinCooldownHours'], 'welcome', '入服欢迎');
  const roles = object(c.roles, ['enabled', 'allowedRefs', 'maxChoices'], 'roles', '兴趣身份');
  const f = object(c.fun, ['enabled', 'enabledTools', 'cooldownSeconds', 'pollMaxHours', 'pollMaxOptions', 'maxParticipants', 'maxDiceCount', 'maxDiceSides', 'topics', 'ai'], 'fun', '趣味互动');
  const ai = f ? object(f.ai, ['enabled', 'userDailyLimit', 'guildDailyLimit', 'prompt'], 'fun.ai', '社区 AI') : null;
  const visibility = r && ['open', 'locked', 'hidden'].includes(String(r.visibility)) ? r.visibility as CommunityVisibility : 'open';
  if (r && !['open', 'locked', 'hidden'].includes(String(r.visibility))) add('rooms.visibility', '默认访问方式', '默认访问方式请选择公开、锁门或隐藏。');
  const tools = f ? array(f.enabledTools, null, 'fun.enabledTools', '开放的趣味工具').filter((value, index): value is CommunityTool => {
    if (COMMUNITY_TOOLS.includes(value as CommunityTool)) return true;
    add(`fun.enabledTools.${index}`, `趣味工具第 ${index + 1} 项`, '请选择受支持的趣味工具。'); return false;
  }) : [];
  const topics = f ? array(f.topics, 200, 'fun.topics', '话题题库').map((value, index): CommunityTopic => {
    const path = `fun.topics.${index}`, label = `话题 ${index + 1}`;
    const topic = object(value, ['ref', 'text', 'tags'], path, label);
    if (!topic) return { ref: '', text: '', tags: [] };
    return { ref: ref(topic.ref, `${path}.ref`, `${label}引用`, false) ?? '', text: text(topic.text, 1, 500, `${path}.text`, `${label}正文`),
      tags: array(topic.tags, 10, `${path}.tags`, `${label}标签`).map((tag, tagIndex) => text(tag, 1, 30, `${path}.tags.${tagIndex}`, `${label}标签 ${tagIndex + 1}`)) };
  }) : [];
  const template = w ? text(w.template, 1, 1500, 'welcome.template', '欢迎文案') : defaults.welcome.template;
  if (w && !hasIssue('welcome.template') && (template.match(/\{[^{}]*\}/g) ?? []).some(key => !['{name}', '{server}', '{memberCount}'].includes(key)))
    add('welcome.template', '欢迎文案', '欢迎文案仅支持 {name}、{server}、{memberCount} 占位符。');
  const value: CommunitySettings = {
    enabled: bool(c.enabled, 'enabled', '启用社区中心'),
    rooms: r ? { enabled: bool(r.enabled, 'rooms.enabled', '开放自助语音房'),
      categoryRef: ref(r.categoryRef, 'rooms.categoryRef', '临时房间分类'), creatorRef: ref(r.creatorRef, 'rooms.creatorRef', '创建房间入口'),
      waitingRef: ref(r.waitingRef, 'rooms.waitingRef', '安全等候区'), panelRef: ref(r.panelRef, 'rooms.panelRef', '旧版社区入口频道'),
      fixedCategoryRefs: refs(r.fixedCategoryRefs === undefined ? [] : r.fixedCategoryRefs, 100, 'rooms.fixedCategoryRefs', '固定房间分类'),
      visibility, maxPerMember: integer(r.maxPerMember, 1, 1, 'rooms.maxPerMember', '每人房间数'), maxRooms: integer(r.maxRooms, 1, 100, 'rooms.maxRooms', '全服临时房间上限'),
      cooldownSeconds: integer(r.cooldownSeconds, 0, 3600, 'rooms.cooldownSeconds', '创建冷却（秒）'), emptyGraceSeconds: integer(r.emptyGraceSeconds, 15, 86400, 'rooms.emptyGraceSeconds', '空房删除时间（秒）'),
      ownerGraceSeconds: integer(r.ownerGraceSeconds, 15, 86400, 'rooms.ownerGraceSeconds', '创建者离开宽限（秒）'), userLimit: integer(r.userLimit, 0, 99, 'rooms.userLimit', '默认人数上限'),
      maxUserLimit: integer(r.maxUserLimit, 1, 99, 'rooms.maxUserLimit', '允许设置的最多人数') } : defaults.rooms,
    welcome: w ? { enabled: bool(w.enabled, 'welcome.enabled', '启用入服欢迎'), channelRef: ref(w.channelRef, 'welcome.channelRef', '欢迎频道'), template,
      rejoinCooldownHours: integer(w.rejoinCooldownHours, 1, 720, 'welcome.rejoinCooldownHours', '重入欢迎冷却（小时）') } : defaults.welcome,
    roles: roles ? { enabled: bool(roles.enabled, 'roles.enabled', '启用自选兴趣身份'), allowedRefs: refs(roles.allowedRefs, 100, 'roles.allowedRefs', '兴趣身份白名单'),
      maxChoices: integer(roles.maxChoices, 1, 5, 'roles.maxChoices', '每人最多兴趣身份') } : defaults.roles,
    fun: f ? { enabled: bool(f.enabled, 'fun.enabled', '开放趣味工具'), enabledTools: [...new Set(tools)],
      cooldownSeconds: integer(f.cooldownSeconds, 0, 3600, 'fun.cooldownSeconds', '互动冷却（秒）'), pollMaxHours: integer(f.pollMaxHours, 1, 720, 'fun.pollMaxHours', '投票最长时间（小时）'),
      pollMaxOptions: integer(f.pollMaxOptions, 2, 10, 'fun.pollMaxOptions', '投票最多选项'), maxParticipants: integer(f.maxParticipants, 2, 100, 'fun.maxParticipants', '分队与抽签最多人数'),
      maxDiceCount: integer(f.maxDiceCount, 1, 100, 'fun.maxDiceCount', '一次最多骰子'), maxDiceSides: integer(f.maxDiceSides, 2, 1000000, 'fun.maxDiceSides', '骰子最多面数'), topics,
      ai: ai ? { enabled: bool(ai.enabled, 'fun.ai.enabled', '启用社区 AI'), userDailyLimit: integer(ai.userDailyLimit, 1, 1000, 'fun.ai.userDailyLimit', '每人每日 AI 配额'),
        guildDailyLimit: integer(ai.guildDailyLimit, 1, 10000, 'fun.ai.guildDailyLimit', '全服每日 AI 配额'), prompt: text(ai.prompt, 1, 4000, 'fun.ai.prompt', '社区 AI 提示词') } : defaults.fun.ai } : defaults.fun,
  };
  if (!hasIssue('rooms.userLimit') && !hasIssue('rooms.maxUserLimit') && value.rooms.userLimit > value.rooms.maxUserLimit)
    add('rooms.userLimit', '默认人数上限', '默认人数上限不能超过允许设置的最多人数。');
  if (value.rooms.waitingRef && value.rooms.waitingRef === value.rooms.creatorRef) add('rooms.waitingRef', '安全等候区', '安全等候区不能与创建房间入口相同。');
  if (value.enabled && value.rooms.enabled) {
    if (!value.rooms.categoryRef) add('rooms.categoryRef', '临时房间分类', '启用自助语音房前请选择临时房间分类。');
    if (!value.rooms.creatorRef) add('rooms.creatorRef', '创建房间入口', '启用自助语音房前请选择创建房间入口。');
  }
  if (value.enabled && value.welcome.enabled && !value.welcome.channelRef) add('welcome.channelRef', '欢迎频道', '启用入服欢迎前请选择欢迎频道。');
  return { value, issues };
}

export function communitySettingsIssues(input: unknown): CommunitySettingsIssue[] { return decodeCommunitySettings(input).issues; }
export function parseCommunitySettings(input: unknown): CommunitySettings {
  const decoded = decodeCommunitySettings(input);
  if (decoded.issues.length) throw new CommunitySettingsValidationError(decoded.issues);
  return decoded.value;
}
