// Shared community fun planning. No Discord, database, chat history or case
// data enters this module: callers supply explicit input and permitted members.
import { randomInt as cryptoRandomInt } from 'node:crypto';
import {
  COMMUNITY_TOOLS,
  isCommunityRef,
  type CommunityJson,
  type CommunityMemberView,
  type CommunitySettings,
  type CommunityTool,
} from '../../../shared/community';

export interface FunPlan {
  title: string;
  data: CommunityJson;
  /** Present only for polls; a server-clock ISO timestamp, never a client clock. */
  closesAt?: string;
}
export interface FunContext {
  settings: CommunitySettings;
  /** Members the caller is already permitted to select. Only explicit refs participate. */
  members?: readonly CommunityMemberView[];
  /** Uniform integer in [0, maxExclusive). Injectable for invariant tests. */
  randomInt?: (maxExclusive: number) => number;
  now?: () => number;
}
export type CommunityAiPurpose = 'room_name' | 'topic';
export interface CommunityAiTheme { theme: string; purpose: CommunityAiPurpose }

export const AI_THEME_MAX = 300;
export const AI_SUGGESTION_COUNT = 3;
const TITLE_MAX = 200;
const OPTION_MAX = 100;
const CONTROL = /[\u0000-\u001f\u007f]/;
const bad = (message: string): never => { throw new Error(message); };

function object(input: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return bad('互动参数格式无效');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !allowed.includes(key))) return bad('互动参数包含不支持的字段');
  return value;
}
function text(input: unknown, field: string, max: number): string {
  if (typeof input !== 'string' || CONTROL.test(input) || !input.trim() || input.length > max) {
    return bad(`${field}不能为空、包含控制字符或超过 ${max} 字`);
  }
  return input.trim();
}
function integer(input: unknown, field: string, min: number, max: number): number {
  if (typeof input !== 'number' || !Number.isInteger(input) || input < min || input > max) {
    return bad(`${field}需要为 ${min}–${max} 的整数`);
  }
  return input;
}
function key(input: string): string { return input.normalize('NFKC').toLocaleLowerCase('en-US'); }
function texts(input: unknown, field: string, min: number, max: number, itemMax: number): string[] {
  if (!Array.isArray(input) || input.length < min || input.length > max) return bad(`${field}数量需要为 ${min}–${max}`);
  const items = input.map(value => text(value, field, itemMax));
  if (new Set(items.map(key)).size !== items.length) return bad(`${field}不能包含重复项`);
  return items;
}
function source(context: FunContext): (max: number) => number {
  const random = context.randomInt ?? ((max: number) => cryptoRandomInt(max));
  return max => {
    const value = random(max);
    if (!Number.isInteger(value) || value < 0 || value >= max) return bad('随机数生成失败，请重试');
    return value;
  };
}
function shuffle<T>(values: readonly T[], random: (max: number) => number): T[] {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const position = random(i + 1);
    [copy[i], copy[position]] = [copy[position], copy[i]];
  }
  return copy;
}
function checkTool(kind: CommunityTool, settings: CommunitySettings): void {
  if (!settings.enabled) return bad('社区功能未启用');
  if (!settings.fun.enabled) return bad('趣味互动未启用');
  if (!COMMUNITY_TOOLS.includes(kind) || !settings.fun.enabledTools.includes(kind)) return bad('该互动工具未启用');
  if (kind === 'ai' && !settings.fun.ai.enabled) return bad('社区 AI 未启用');
}

/** Only the user's explicit theme is accepted; no arbitrary messages/context field. */
export function validateAiTheme(input: unknown): CommunityAiTheme {
  const value = object(input, ['theme', 'purpose']);
  if (value.purpose !== 'room_name' && value.purpose !== 'topic') return bad('AI 建议类型无效');
  return { theme: text(value.theme, '主题', AI_THEME_MAX), purpose: value.purpose };
}

export function planFun(kind: CommunityTool, input: unknown, context: FunContext): FunPlan {
  checkTool(kind, context.settings);
  const config = context.settings.fun;
  const random = source(context);
  switch (kind) {
    case 'poll': {
      const value = object(input, ['question', 'options', 'hours']);
      const question = text(value.question, '投票问题', TITLE_MAX);
      const options = texts(value.options, '投票选项', 2, config.pollMaxOptions, OPTION_MAX);
      const hours = integer(value.hours ?? Math.min(24, config.pollMaxHours), '投票时长', 1, config.pollMaxHours);
      const now = (context.now ?? Date.now)();
      const deadline = now + hours * 3_600_000;
      if (!Number.isFinite(now) || !Number.isFinite(deadline) || Math.abs(deadline) > 8.64e15) return bad('服务器时间无效');
      return { title: question, data: { question, options, totals: options.map(() => 0) }, closesAt: new Date(deadline).toISOString() };
    }
    case 'teams': {
      const value = object(input, ['memberRefs', 'teamCount']);
      const refs = texts(value.memberRefs, '参与成员', 2, config.maxParticipants, 36);
      if (refs.some(ref => !isCommunityRef(ref))) return bad('参与成员引用无效');
      const count = integer(value.teamCount, '队数', 2, refs.length);
      const available = new Map((context.members ?? []).map(member => [member.ref.toLowerCase(), member]));
      const selected = refs.map(ref => {
        const member = available.get(ref.toLowerCase());
        if (!member || !isCommunityRef(member.ref)) return bad('参与成员不存在或不可选择');
        return { ref: member.ref, name: text(member.name, '成员名字', 100) };
      });
      const teams: Array<{ name: string; members: Array<{ ref: string; name: string }> }> = Array.from({ length: count }, (_, index) => ({ name: `第 ${index + 1} 队`, members: [] }));
      shuffle(selected, random).forEach((member, index) => teams[index % count].members.push(member));
      return { title: '随机分队', data: { teams, teamCount: count } };
    }
    case 'draw': {
      const value = object(input, ['items', 'count']);
      const items = texts(value.items, '抽签候选', 1, config.maxParticipants, OPTION_MAX);
      const count = integer(value.count ?? 1, '抽取数量', 1, items.length);
      return { title: '抽签结果', data: { items, count, picked: shuffle(items, random).slice(0, count) } };
    }
    case 'roll': {
      const value = object(input, ['count', 'sides']);
      const count = integer(value.count ?? 1, '骰子数量', 1, config.maxDiceCount);
      const sides = integer(value.sides ?? Math.min(6, config.maxDiceSides), '骰子面数', 2, config.maxDiceSides);
      const rolls = Array.from({ length: count }, () => random(sides) + 1);
      return { title: `${count}D${sides} 骰子`, data: { count, sides, rolls, total: rolls.reduce((total, die) => total + die, 0) } };
    }
    case 'topic': {
      const value = object(input, ['tag']);
      const tag = value.tag === undefined || value.tag === '' ? null : text(value.tag, '话题标签', 30);
      const topics = config.topics.filter(topic => tag === null || topic.tags.includes(tag));
      if (!topics.length) return bad('题库中没有符合条件的话题');
      const topic = topics[random(topics.length)];
      return { title: '话题卡', data: { topicRef: topic.ref, text: topic.text, tags: [...topic.tags] } };
    }
    case 'ai': {
      const value = validateAiTheme(input);
      return { title: value.purpose === 'room_name' ? 'AI 房间名建议' : 'AI 话题建议', data: { ...value } };
    }
  }
}

function suggestionItems(input: unknown, depth = 0): unknown[] {
  if (depth > 2) return [];
  if (typeof input === 'string') {
    if (input.length > 16000) return [];
    const text = input.trim().replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '').trim();
    if (!text) return [];
    if (/^[\[{]/.test(text)) {
      try { return suggestionItems(JSON.parse(text), depth + 1); } catch { return []; }
    }
    return text.split(/\r?\n/);
  }
  if (Array.isArray(input)) return input.slice(0, 50);
  if (input && typeof input === 'object' && 'suggestions' in input) return suggestionItems((input as { suggestions: unknown }).suggestions, depth + 1);
  return [];
}

/** Validate suggestions as plain bounded text, without links, mentions or raw
 * identifiers. Callers additionally redact their provider key before this step.
 * No suggestion is an instruction: applying it is a separate authorized action. */
export function cleanAiSuggestions(input: unknown, purpose: CommunityAiPurpose = 'room_name'): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const max = purpose === 'room_name' ? 100 : 300;
  for (const raw of suggestionItems(input)) {
    if (typeof raw !== 'string') continue;
    const value = raw.trim().replace(/^(?:[-*•]\s+|\d+[.、)]\s*)/, '').replace(/^["“]|["”]$/g, '').trim();
    if (!value || value.length > max || CONTROL.test(value) || /```|@|<[@#][!&]?|[a-z][a-z0-9+.-]*:\/\/|www\.|discord\.gg\/|\[[^\]]*\]\s*\(|\d{17,20}/i.test(value)) continue;
    const canonical = key(value);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    result.push(value);
    if (result.length === AI_SUGGESTION_COUNT) break;
  }
  return result;
}
