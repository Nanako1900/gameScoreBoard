import { describe, expect, it } from 'vitest';
import { TIERS } from '../../shared/scoring';
import { boardMessage, type BoardData } from '../src/discord/board';
import { LIMITS } from '../src/discord/render';

const NOW = Date.parse('2026-10-27T12:00:00Z');
const ROOT = 'https://score.example';
const EVIL = '[点我](https://evil.example) @everyone <@123456789012345678>\n第二行';
function data(over: Partial<BoardData> = {}): BoardData {
  return { top: [], recent: [], pending: 0, report: null, updatedAt: NOW, ...over };
}
function total(post: ReturnType<typeof boardMessage>): number {
  return post.embeds.reduce((sum, embed) => sum + (embed.title?.length ?? 0) + (embed.description?.length ?? 0)
    + (embed.footer?.text.length ?? 0) + (embed.author?.name.length ?? 0)
    + (embed.fields ?? []).reduce((n, field) => n + field.name.length + field.value.length, 0), 0);
}

describe('public information board message', () => {
  it('keeps three embeds and renders fifteen competition ranks, including ties', () => {
    const top = Array.from({ length: 16 }, (_, i) => ({ rank: i < 2 ? 1 : i + 1, name: `选手${i + 1}`, score: i < 2 ? 100 : 100 - i }));
    const post = boardMessage(data({ top }), ROOT);
    expect(post.embeds.map((embed) => embed.title)).toEqual(['信誉榜', '最近判决', '动态']);
    const lines = post.embeds[0].description?.split('\n') ?? [];
    expect(lines).toHaveLength(15);
    expect(lines[0]).toContain('1\\. 选手1 — 100 分');
    expect(lines[1]).toContain('1\\. 选手2 — 100 分');
    expect(lines[2]).toContain('3\\. 选手3 — 98 分');
    expect(JSON.stringify(post)).not.toContain('选手16');
  });
  it.each([0, 3])('only summarizes the pending count %s without a pending person or accusation', (pending) => {
    const post = boardMessage(data({ pending }), ROOT);
    expect(post.embeds[2].description).toContain(pending === 0 ? '目前没有处理中的记录' : '目前有 3 起记录在处理中');
    expect(post.embeds[2].description).toContain(`<t:${NOW / 1000}:R>`);
  });
  it('omits the report line when no report exists', () => {
    const post = boardMessage(data(), ROOT);
    expect(post.embeds[2].description).not.toContain('周报');
    expect(post.embeds[2].description).not.toContain('/board/report');
  });
  it('links the report summary to its existing web page', () => {
    const post = boardMessage(data({ report: { weekStart: '2026-10-19', line: '📰 周报 · 2026-10-19 – 2026-10-25' } }), ROOT);
    expect(post.embeds[2].description).toContain('2026\\-10\\-19');
    expect(post.embeds[2].description).toContain('https://score.example/board/report');
  });
  it('renders only five fixed verdicts with their permanent case links and the existing date field', () => {
    const recent = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, subject: `当事人${i + 1}`, typeLabel: '小迟到', delta: i === 0 ? 0 : -3, at: '2026-10-20 12:00:00' }));
    const post = boardMessage(data({ recent }), ROOT);
    const description = post.embeds[1].description ?? '';
    expect(description.split('\n')).toHaveLength(5);
    expect(description).toContain('当事人1 · 小迟到 · 0');
    expect(description).toContain('当事人2 · 小迟到 · -3');
    expect(description).toContain(`<t:${Date.UTC(2026, 9, 20, 12) / 1000}:R>`);
    expect(description).toContain('https://score.example/?case=1');
    expect(description).not.toContain('?case=6');
  });
  it('neutralizes names and summary text, never emits tiers or caller-supplied private extras', () => {
    const input = data({ top: [{ rank: 1, name: EVIL, score: 100 }],
      recent: [{ id: 42, subject: EVIL, typeLabel: '放鸽子', delta: -15, at: '2026-10-20 12:00:00' }],
      report: { weekStart: '2026-10-19', line: EVIL } });
    const post = boardMessage({ ...input, discord_user_id: 'RAW_DISCORD_ID', claim: 'PRIVATE_CLAIM', tier: 'PRIVATE_TIER' } as BoardData, ROOT);
    const out = JSON.stringify(post);
    expect(post.allowed_mentions).toEqual({ parse: [] });
    for (const forbidden of ['<@', '@everyone', '](https://evil', 'RAW_DISCORD_ID', 'PRIVATE_CLAIM', 'PRIVATE_TIER']) expect(out).not.toContain(forbidden);
    for (const tier of TIERS) expect(out).not.toContain(tier.name);
    expect(post.embeds[0].description?.split('\n')).toHaveLength(1);
  });
  it('limits the three embeds together, even for hostile long input and a long configured URL', () => {
    const value = EVIL.repeat(1000);
    const post = boardMessage(data({ top: Array.from({ length: 15 }, (_, i) => ({ rank: i + 1, name: value, score: 100 - i })),
      recent: Array.from({ length: 5 }, (_, i) => ({ id: i + 1, subject: value, typeLabel: value, delta: -30, at: '2026-10-20 12:00:00' })),
      report: { weekStart: '2026-10-19', line: value } }), `${ROOT}/${'x'.repeat(8000)}`);
    expect(post.embeds).toHaveLength(3);
    expect(total(post)).toBeLessThanOrEqual(LIMITS.embedTotal);
    for (const embed of post.embeds) {
      expect(embed.title?.length ?? 0).toBeLessThanOrEqual(LIMITS.embedTitle);
      expect(embed.description?.length ?? 0).toBeLessThanOrEqual(LIMITS.embedDescription);
      expect(embed.description).not.toMatch(/\]\([^)]*$/);
    }
    expect(post.embeds[2].description).toContain('目前没有处理中的记录');
    expect(post.embeds[2].description).toContain('更新于');
  });
  it('puts the two private actions and the public web link on one row', () => {
    const post = boardMessage(data(), ROOT);
    expect(post.components).toHaveLength(1);
    expect(post.components[0].components).toEqual([
      { type: 2, style: 2, label: '我的情况', custom_id: 'v1:board:me' },
      { type: 2, style: 2, label: '语音记录', custom_id: 'v1:board:voice' },
      { type: 2, style: 5, label: '打开网页', url: 'https://score.example/' },
    ]);
  });
  it('has useful empty sections without making up a player or a verdict', () => {
    const post = boardMessage(data(), ROOT);
    expect(post.embeds[0].description).toBe('榜上还没有选手。');
    expect(post.embeds[1].description).toBe('最近没有已判决的扣分记录。');
  });
});
