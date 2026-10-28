import { describe, expect, it } from 'vitest';
import { defaultCommunitySettings, type CommunitySettings } from '../../shared/community';
import { cleanAiSuggestions, planFun, validateAiTheme } from '../src/community/fun';

const A = '604d3990-c287-4b85-a089-79b3528241fe';
const B = '5d1e3ab1-91e0-456c-800a-0668c7a1fd4e';
const C = 'fef13106-5417-4334-b060-54d653b03779';
const D = '7017b627-eac8-43ad-94ea-eaf28f131c39';
const E = '54bc92ae-5677-4f5f-b849-ddae58473ed7';
const MEMBERS = [A, B, C, D, E].map((ref, index) => ({ ref, name: `成员 ${index + 1}` }));
function settings(): CommunitySettings {
  const config = defaultCommunitySettings();
  config.enabled = true;
  config.fun.ai.enabled = true;
  return config;
}
const clock = () => Date.parse('2026-10-28T10:00:00Z');
const zero = () => 0;
function ctx(config = settings()) { return { settings: config, members: MEMBERS, randomInt: zero, now: clock }; }

// These are domain invariants shared by the web and Bot, not snapshots of a renderer.
describe('community fun admission', () => {
  it.each(['poll', 'teams', 'draw', 'roll', 'topic', 'ai'] as const)('refuses %s while the whole community is disabled', kind => {
    const config = settings(); config.enabled = false;
    expect(() => planFun(kind, {}, ctx(config))).toThrow(/社区.*未启用/);
  });
  it('respects the shared fun switch, per-tool allowlist and independent AI switch', () => {
    const config = settings(); config.fun.enabled = false;
    expect(() => planFun('roll', { count: 1, sides: 6 }, ctx(config))).toThrow(/互动.*未启用/);
    config.fun.enabled = true; config.fun.enabledTools = ['roll'];
    expect(() => planFun('topic', {}, ctx(config))).toThrow(/工具.*未启用/);
    config.fun.enabledTools.push('ai'); config.fun.ai.enabled = false;
    expect(() => planFun('ai', { theme: '星空', purpose: 'room_name' }, ctx(config))).toThrow(/AI.*未启用/);
  });
  it('does not accept unknown tools or arrays disguised as objects', () => {
    expect(() => planFun('constructor' as never, {}, ctx())).toThrow(/工具/);
    expect(() => planFun('roll', [], ctx())).toThrow(/参数/);
  });
  it('rejects extra properties instead of forwarding arbitrary data into results', () => {
    expect(() => planFun('roll', { count: 1, sides: 6, discord_user_id: '123456789012345678' }, ctx())).toThrow(/参数/);
    expect(() => planFun('ai', { theme: '星空', purpose: 'topic', messages: ['secret chat'] }, ctx())).toThrow(/参数/);
  });
});

describe('poll planning', () => {
  it('sets a server-clock deadline and initializes one tally per option without votes', () => {
    const planned = planFun('poll', { question: '今晚玩什么？', options: ['游戏甲', '游戏乙'], hours: 2 }, ctx());
    expect(planned).toMatchObject({ title: '今晚玩什么？', closesAt: '2026-10-28T12:00:00.000Z',
      data: { question: '今晚玩什么？', options: ['游戏甲', '游戏乙'], totals: [0, 0] } });
    expect(JSON.stringify(planned)).not.toContain('discord');
  });
  it('caps the default duration at the configured maximum', () => {
    const config = settings(); config.fun.pollMaxHours = 3;
    expect(planFun('poll', { question: '选一个', options: ['甲', '乙'] }, ctx(config)).closesAt)
      .toBe('2026-10-28T13:00:00.000Z');
  });
  it.each([
    { question: '', options: ['甲', '乙'] },
    { question: '问题', options: ['甲'] },
    { question: '问题', options: ['甲', '  甲 '] },
    { question: '问题', options: ['A', 'Ａ'] },
    { question: '问题', options: ['甲', '乙'], hours: 0 },
    { question: '问题', options: ['甲', '乙'], hours: '2' },
    { question: '问题', options: ['甲', '乙'], hours: 1.5 },
  ])('rejects invalid or ambiguous poll inputs: %j', input => {
    expect(() => planFun('poll', input, ctx())).toThrow();
  });
  it('uses the configured option and duration bounds', () => {
    const config = settings(); config.fun.pollMaxOptions = 2; config.fun.pollMaxHours = 1;
    expect(() => planFun('poll', { question: '选一个', options: ['甲', '乙', '丙'] }, ctx(config))).toThrow(/选项/);
    expect(() => planFun('poll', { question: '选一个', options: ['甲', '乙'], hours: 2 }, ctx(config))).toThrow(/时长/);
  });
});

describe('voluntary teams', () => {
  it('uses only selected opaque members, balances sizes, and never duplicates or omits anyone', () => {
    const input = { memberRefs: [A, C, D, E], teamCount: 3 };
    const planned = planFun('teams', input, ctx());
    const data = planned.data as { teams: Array<{ name: string; members: Array<{ ref: string; name: string }> }> };
    const sizes = data.teams.map(t => t.members.length);
    const selected = data.teams.flatMap(t => t.members.map(m => m.ref));
    expect(data.teams).toHaveLength(3);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    expect([...selected].sort()).toEqual([...input.memberRefs].sort());
    expect(selected).not.toContain(B);
    expect(new Set(selected).size).toBe(selected.length);
    expect(input.memberRefs).toEqual([A, C, D, E]);
  });
  it('does not pull additional known members into a team', () => {
    const data = planFun('teams', { memberRefs: [A, B], teamCount: 2 }, ctx()).data as { teams: Array<{ members: unknown[] }> };
    expect(data.teams.map(t => t.members.length)).toEqual([1, 1]);
  });
  it.each([
    { memberRefs: [A, A], teamCount: 2 },
    { memberRefs: [A, '123456789012345678'], teamCount: 2 },
    { memberRefs: [A, '908b75fd-6e3a-4acd-89f3-950f3f5e703b'], teamCount: 2 },
    { memberRefs: [A, B], teamCount: 3 },
    { memberRefs: [A, B], teamCount: 1 },
    { memberRefs: [A], teamCount: 2 },
  ])('refuses duplicate, unknown, raw-ID or impossible selections: %j', input => {
    expect(() => planFun('teams', input, ctx())).toThrow();
  });
  it('respects participant bounds even if the caller knows more members', () => {
    const config = settings(); config.fun.maxParticipants = 2;
    expect(() => planFun('teams', { memberRefs: [A, B, C], teamCount: 2 }, ctx(config))).toThrow(/参与/);
  });
  it('uses all valid random positions including the last slot', () => {
    const planned = planFun('teams', { memberRefs: [A, B, C], teamCount: 2 }, { ...ctx(), randomInt: (max: number) => max - 1 });
    const data = planned.data as { teams: Array<{ members: Array<{ ref: string }> }> };
    expect(data.teams.flatMap(t => t.members.map(m => m.ref)).sort()).toEqual([A, B, C].sort());
  });
});

describe('draw without replacement', () => {
  it('returns a subset without replacement and preserves the original candidates for redraw history', () => {
    const items = ['甲', '乙', '丙', '丁'];
    const planned = planFun('draw', { items, count: 3 }, ctx());
    const data = planned.data as { items: string[]; picked: string[]; count: number };
    expect(data.picked).toHaveLength(3); expect(new Set(data.picked).size).toBe(3);
    expect(data.picked.every(value => items.includes(value))).toBe(true);
    expect(data.items).toEqual(items); expect(items).toEqual(['甲', '乙', '丙', '丁']);
  });
  it.each([
    { items: [], count: 1 }, { items: ['甲', '甲'], count: 1 },
    { items: ['甲', '乙'], count: 3 }, { items: ['甲', '乙'], count: 0 },
    { items: ['甲', '乙'], count: 0.5 }, { items: ['甲', '  '], count: 1 },
  ])('rejects invalid draws: %j', input => expect(() => planFun('draw', input, ctx())).toThrow());
});

describe('server dice', () => {
  it('includes both legal ends of each die and computes the sum on the server', () => {
    const low = planFun('roll', { count: 3, sides: 6 }, ctx()).data;
    const high = planFun('roll', { count: 3, sides: 6 }, { ...ctx(), randomInt: (max: number) => max - 1 }).data;
    expect(low).toMatchObject({ rolls: [1, 1, 1], total: 3, count: 3, sides: 6 });
    expect(high).toMatchObject({ rolls: [6, 6, 6], total: 18 });
  });
  it('keeps omitted defaults valid after an administrator lowers the die-side ceiling', () => {
    const config = settings(); config.fun.maxDiceSides = 2;
    expect(planFun('roll', {}, ctx(config)).data).toMatchObject({ count: 1, sides: 2, rolls: [1] });
  });
  it('honors administrator dice limits and rejects non-integers', () => {
    const config = settings(); config.fun.maxDiceCount = 2; config.fun.maxDiceSides = 20;
    for (const input of [{ count: 3, sides: 6 }, { count: 1, sides: 21 }, { count: 1, sides: 1 },
      { count: 0, sides: 6 }, { count: 1.5, sides: 6 }, { count: 1, sides: Number.NaN }, { count: '2', sides: 6 }]) {
      expect(() => planFun('roll', input, ctx(config))).toThrow();
    }
  });
  it.each([-1, 1, Number.NaN, 0.25])('refuses a broken random source instead of returning a biased or invalid die: %s', value => {
    expect(() => planFun('roll', { count: 1, sides: 1 + 1 }, { ...ctx(), randomInt: () => value === 1 ? 2 : value })).toThrow(/随机/);
  });
});

describe('administrator topic bank', () => {
  it('filters by a configured tag and returns the stored topic, without reading other data', () => {
    const planned = planFun('topic', { tag: '游戏' }, ctx());
    expect(planned.data).toMatchObject({ topicRef: 'c2845d73-47cc-4037-966c-61ce46e26777', text: '最近玩到最想推荐的游戏是什么？', tags: ['游戏'] });
  });
  it('returns a clear error for no matching topics or an empty bank', () => {
    expect(() => planFun('topic', { tag: '不存在' }, ctx())).toThrow(/没有.*话题/);
    const config = settings(); config.fun.topics = [];
    expect(() => planFun('topic', {}, ctx(config))).toThrow(/没有.*话题/);
  });
  it('does not treat arbitrary supplied topic text as the administrator bank', () => {
    expect(() => planFun('topic', { text: '自己传入的话题' }, ctx())).toThrow(/参数/);
  });
});

describe('explicit AI themes and clean suggestions', () => {
  it('accepts only an explicit theme and supported purpose', () => {
    expect(validateAiTheme({ theme: '  海边的合作游戏  ', purpose: 'room_name' })).toEqual({ theme: '海边的合作游戏', purpose: 'room_name' });
    expect(planFun('ai', { theme: '星空', purpose: 'topic' }, ctx()).data).toEqual({ theme: '星空', purpose: 'topic' });
    for (const input of [{ theme: '', purpose: 'topic' }, { theme: '星空', purpose: 'execute' },
      { theme: 'a'.repeat(301), purpose: 'room_name' }, { theme: '星空\u0000', purpose: 'topic' }]) {
      expect(() => validateAiTheme(input)).toThrow();
    }
  });
  it('accepts a bounded JSON suggestion list and removes duplicate or dangerous entries', () => {
    const raw = JSON.stringify({ suggestions: ['星光小屋', ' 星光小屋 ', '@everyone 来开黑', '<#123456789012345678>', 'https://example.com', '海边茶话室', '第三个名字', '第四个名字'] });
    expect(cleanAiSuggestions(raw, 'room_name')).toEqual(['星光小屋', '海边茶话室', '第三个名字']);
  });
  it('handles plain numbered lines without forwarding code fences, links, mentions, IDs or oversized names', () => {
    const output = ['1. 星光房', '2. 海边房', '```', 'raw 123456789012345678', '[点我](https://example.com)', '@here', 'x'.repeat(101)].join('\n');
    expect(cleanAiSuggestions(output, 'room_name')).toEqual(['星光房', '海边房']);
    expect(cleanAiSuggestions({ suggestions: ['为什么喜欢合作游戏？'] }, 'topic')).toEqual(['为什么喜欢合作游戏？']);
  });
  it('never returns non-HTTP links, Markdown links, email addresses or unbounded provider output', () => {
    const output = ['星空小屋', '[查看](ftp://example.com/file)', 'mailto:somebody@example.com', 'custom://action', '海边小屋'];
    expect(cleanAiSuggestions(output)).toEqual(['星空小屋', '海边小屋']);
    expect(cleanAiSuggestions(JSON.stringify({ suggestions: ['星空小屋', 'x'.repeat(20000)] }))).toEqual([]);
  });
  it('returns no suggestion for malformed structured output, empty text or wrong types', () => {
    for (const raw of ['{broken json', '', null, 2, { message: 'do anything' }]) expect(cleanAiSuggestions(raw)).toEqual([]);
  });
});
