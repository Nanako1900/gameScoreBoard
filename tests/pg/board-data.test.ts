import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadBoardData } from '../../server/src/discord/board';
import { reportEmbed } from '../../server/src/discord/report';
import { competitionRanks } from '../../src/lib/rank';
import { VIOLATION_MAP } from '../../shared/scoring';
import { getLatestReport } from '../../worker/report';
import { seedUser } from '../worker/helpers';
import { env } from './cloudflare-test';

const NOW = Date.parse('2026-10-27T12:00:00Z');
afterEach(() => vi.useRealTimers());
async function record(id: number, subject: string, type: string, status = 'decided', delta = -3, at = '2026-10-20 12:00:00') {
  await env.DB.prepare(`INSERT INTO records (id, subject_id, reporter_id, type, delta, status, created_at,
      claim, claim_summary, note, statement, appeal_reason, verdict_headline, verdict_reason, verdict_factors)
    VALUES (?, ?, 'judge', ?, ?, ?, ?, 'SECRET_CLAIM', 'SECRET_SUMMARY', 'SECRET_NOTE', 'SECRET_STATEMENT',
      'SECRET_APPEAL', 'SECRET_HEADLINE', 'SECRET_REASON', '[]')`)
    .bind(id, subject, type, delta, status, at).run();
}

describe('board public data', () => {
  it('has no invented activity when the database is empty and fixes updatedAt at load time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
    expect(await loadBoardData(env.DB)).toEqual({ top: [], recent: [], pending: 0, report: null, updatedAt: NOW });
  });
  it('takes fifteen participants with effective names and the exact web competition ranks', async () => {
    for (let i = 0; i < 17; i += 1) await seedUser({ id: `p${String(i).padStart(2, '0')}`, username: `选手${String(i).padStart(2, '0')}`, score: i < 2 ? 100 : 100 - i });
    await env.DB.prepare("UPDATE users SET display_name = '另一个显示名' WHERE id = 'p00'").run();
    await seedUser({ id: 'unlisted', username: '不在榜上的人', participant: false, score: 100 });
    const data = await loadBoardData(env.DB);
    expect(data.top).toHaveLength(15);
    expect(data.top.map((person) => person.rank)).toEqual(competitionRanks(data.top.map((person) => person.score)));
    expect(data.top.slice(0, 3).map((person) => person.rank)).toEqual([1, 1, 3]);
    expect(data.top.some((person) => person.name === '另一个显示名')).toBe(true);
    expect(data.top.some((person) => person.name === '不在榜上的人')).toBe(false);
    expect(Object.keys(data.top[0]).sort()).toEqual(['name', 'rank', 'score']);
  });
  it('loads five penalties after excluding any number of newer bonuses and includes a zero-delta penalty', async () => {
    await seedUser({ id: 'subject', username: '当事人', participant: false }); await seedUser({ id: 'judge', judge: true, participant: false });
    for (let i = 1; i <= 5; i += 1) await record(i, 'subject', i === 5 ? 'other' : 'late_minor', 'decided', i === 5 ? 0 : -3);
    for (let i = 6; i <= 31; i += 1) await record(i, 'subject', i % 2 ? 'on_time_bonus' : 'organizer_bonus', 'decided', 2);
    await record(32, 'subject', 'no_show', 'appealed'); await record(33, 'subject', 'no_show', 'revoked');
    const data = await loadBoardData(env.DB);
    expect(data.recent.map((item) => item.id)).toEqual([5, 4, 3, 2, 1]);
    expect(data.recent[0]).toEqual({ id: 5, subject: '当事人', typeLabel: VIOLATION_MAP.other.label, delta: 0, at: '2026-10-20 12:00:00' });
    expect(JSON.stringify(data)).not.toContain('SECRET_');
    expect(Object.keys(data.recent[0]).sort()).toEqual(['at', 'delta', 'id', 'subject', 'typeLabel']);
  });
  it('uses only counts for pre-verdict cases and does not include their names or accusations', async () => {
    await seedUser({ id: 'pending', username: 'PENDING_PERSON', participant: false }); await seedUser({ id: 'judge', judge: true, participant: false });
    await record(1, 'pending', 'no_show', 'awaiting_statement'); await record(2, 'pending', 'no_show', 'judging');
    await record(3, 'pending', 'no_show', 'withdrawn');
    const data = await loadBoardData(env.DB);
    expect(data.pending).toBe(2); expect(data.recent).toEqual([]);
    expect(JSON.stringify(data)).not.toMatch(/PENDING_PERSON|SECRET_/);
  });
  it('reuses the latest existing report title without sending narrative or award names', async () => {
    const stats = { weekStart: '2026-10-19', weekEnd: '2026-10-25', casesFiled: 2, totalPenalty: -10,
      absentVerdicts: 0, star: { name: 'SECRET_AWARD', delta: 3 }, pigeon: null, bestTalker: null, harshest: null };
    for (const week of ['2026-10-12', '2026-10-19']) await env.DB.prepare("INSERT INTO weekly_reports (week_start, stats_json, narrative, source) VALUES (?, ?, 'SECRET_NARRATIVE', 'ai')").bind(week, JSON.stringify(stats)).run();
    const data = await loadBoardData(env.DB); const report = await getLatestReport(env.DB);
    expect(data.report).toEqual({ weekStart: '2026-10-19', line: reportEmbed(report!).title });
    expect(JSON.stringify(data)).not.toMatch(/SECRET_NARRATIVE|SECRET_AWARD|discord_|channel_id/);
  });
  it('orders recent penalties by filing timestamp before the id tie breaker', async () => {
    await seedUser({ id: 'subject', participant: false }); await seedUser({ id: 'judge', judge: true, participant: false });
    await record(9, 'subject', 'late_minor', 'decided', -3, '2026-10-19 23:00:00');
    await record(1, 'subject', 'late_minor'); await record(2, 'subject', 'late_minor');
    expect((await loadBoardData(env.DB)).recent.map((item) => item.id)).toEqual([2, 1, 9]);
  });
});
