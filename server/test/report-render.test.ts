import { describe, expect, it } from 'vitest';
import { reportEmbed, reportPost } from '../src/discord/report';
import type { WeeklyReport } from '../../worker/report';

function report(over: Partial<WeeklyReport> = {}): WeeklyReport {
  return {
    week_start: '2026-10-19',
    stats: {
      weekStart: '2026-10-19',
      weekEnd: '2026-10-25',
      sessionsPlayed: 3,
      sessionsCollapsed: 0,
      casesFiled: 2,
      totalPenalty: -18,
      absentVerdicts: 1,
      attendanceRate: 0.75,
      upcomingNextWeek: 1,
      star: { name: '小明 [点我](https://evil.example)', delta: 4 },
      pigeon: { name: '@everyone', delta: -15 },
      bestTalker: null,
      harshest: null,
      topOrganizer: null,
    },
    narrative: '本周 @here <@123456789012345678> 打得不错',
    source: 'ai',
    created_at: '2026-10-26 02:31:00',
    ...over,
  } as WeeklyReport;
}

describe('reportPost', () => {
  it('is an embed and a web link, pinging nobody, whatever names and words say', () => {
    const post = reportPost(report(), 'https://score.example');
    expect(post.allowed_mentions).toEqual({ parse: [] });
    expect('content' in post).toBe(false);
    const buttons = post.components.flatMap((row) => row.components);
    expect(buttons).toEqual([expect.objectContaining({ url: 'https://score.example/', label: '在网页查看' })]);
    const out = JSON.stringify(post.embeds);
    expect(out).toContain('周报 · 2026-10-19 – 2026-10-25');
    expect(out).not.toMatch(/@everyone|@here/);
    expect(out).not.toContain('<@123456789012345678>');
    expect(out).not.toContain('](https://evil');
  });

  it('says who wrote the words', () => {
    expect(reportEmbed(report()).footer?.text).toContain('AI');
    expect(reportEmbed(report({ source: 'fallback' })).footer?.text).toBe('数字由系统统计');
  });
});


describe('S1 report figures', () => {
  it('keeps nonzero figures in a stored legacy report', () => {
    expect(reportEmbed(report()).fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: '开局', value: '3 局' }),
      expect.objectContaining({ name: '出勤率', value: '75%' }),
    ]));
  });
  it.each(['missing', 'zero'])('omits %s session figures without breaking the rest', (shape) => {
    const old = report();
    const { sessionsPlayed, sessionsCollapsed, attendanceRate, upcomingNextWeek, topOrganizer, ...stats } = old.stats;
    const current = { ...old, stats: shape === 'zero' ? { ...stats, sessionsPlayed: 0, attendanceRate: 0 } : stats } as WeeklyReport;
    const embed = reportEmbed(current);
    const names = embed.fields?.map((field) => field.name);
    expect(names).not.toContain('开局');
    expect(names).not.toContain('出勤率');
    expect(JSON.stringify(embed)).not.toMatch(/NaN|undefined/);
    expect(embed.fields).toEqual(expect.arrayContaining([expect.objectContaining({ name: '合计扣分', value: '-18' })]));
  });
});
