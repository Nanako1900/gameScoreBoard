import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { VIOLATION_MAP } from '../../shared/scoring';
import { buildReportMessage, DEFAULT_REPORT_PROMPT, fallbackNarrative } from '../../worker/ai/report';
import {
  computeStats,
  ensureWeeklyReport,
  getReport,
  hadActivity,
  previousWeekStart,
  regenerateReport,
  reportDue,
} from '../../worker/report';
import { OFFSET_HOURS, inThisWeek, noAiEnv, seedUser } from './helpers';

/** A sqlite-datetime inside last week, offset days from its local Monday. */
function inLastWeek(dayOffset = 1, hour = 12): string {
  const week = previousWeekStart(OFFSET_HOURS);
  const ms =
    Date.parse(`${week}T00:00:00Z`) -
    OFFSET_HOURS * 3_600_000 +
    dayOffset * 86_400_000 +
    hour * 3_600_000;
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

/** Insert a decided penalty directly so the week and delta are exact. */
async function seedCase(opts: {
  subject: string;
  reporter: string;
  type: string;
  delta: number;
  statement?: string | null;
  at?: string;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO records
       (subject_id, reporter_id, type, delta, claim, statement, status,
        verdict_source, created_at)
     VALUES (?, ?, ?, ?, '事实描述若干', ?, 'decided', 'ai', ?)`,
  )
    .bind(
      opts.subject,
      opts.reporter,
      opts.type,
      opts.delta,
      opts.statement ?? null,
      opts.at ?? inLastWeek(),
    )
    .run();
  await env.DB.prepare(
    `INSERT INTO score_events (user_id, delta, reason, resulting_score, created_at)
     VALUES (?, ?, 'record:seed', 100, ?)`,
  )
    .bind(opts.subject, opts.delta, opts.at ?? inLastWeek())
    .run();
}

describe('computeStats — every figure comes from SQL', () => {
  it('counts cases and total penalty for the reported week only', async () => {
    const judge = await seedUser({ id: 'judge', judge: true });
    const a = await seedUser({ id: 'a', username: '阿强' });

    await seedCase({ subject: a.id, reporter: judge.id, type: 'no_show', delta: -15 });
    await seedCase({ subject: a.id, reporter: judge.id, type: 'afk', delta: -8, at: inLastWeek(3) });
    // This one is in the CURRENT week and must not be counted.
    await seedCase({
      subject: a.id,
      reporter: judge.id,
      type: 'afk',
      delta: -8,
      at: new Date().toISOString().replace('T', ' ').slice(0, 19),
    });

    const s = await computeStats(env.DB, previousWeekStart(OFFSET_HOURS), OFFSET_HOURS);
    expect(s.casesFiled).toBe(2);
    expect(s.totalPenalty).toBe(-23);
  });

  it('excludes the automatic weekly heal from star / pigeon', async () => {
    const judge = await seedUser({ id: 'judge', judge: true });
    const a = await seedUser({ id: 'a', username: '阿强' });
    const b = await seedUser({ id: 'b', username: '小明' });

    await seedCase({ subject: a.id, reporter: judge.id, type: 'no_show', delta: -15 });
    // b earned points the honest way…
    await env.DB.prepare(
      `INSERT INTO score_events (user_id, delta, reason, resulting_score, created_at)
       VALUES (?, 4, 'record:seed', 100, ?)`,
    )
      .bind(b.id, inLastWeek(2))
      .run();
    // …while a also received a big automatic heal, which must NOT make them the star.
    await env.DB.prepare(
      `INSERT INTO score_events (user_id, delta, reason, resulting_score, created_at)
       VALUES (?, 15, 'weekly_heal', 100, ?)`,
    )
      .bind(a.id, inLastWeek(4))
      .run();

    const s = await computeStats(env.DB, previousWeekStart(OFFSET_HOURS), OFFSET_HOURS);
    expect(s.star?.name).toBe('小明');
    expect(s.star?.delta).toBe(4);
    expect(s.pigeon?.name).toBe('阿强');
    expect(s.pigeon?.delta).toBe(-15);
  });

  it('excludes an admin’s direct score corrections from star / pigeon', async () => {
    const judge = await seedUser({ id: 'judge', judge: true });
    const a = await seedUser({ id: 'a', username: '阿强' });
    const b = await seedUser({ id: 'b', username: '小明' });
    await seedCase({ subject: a.id, reporter: judge.id, type: 'late_minor', delta: -3 });
    // b's score was corrected by hand — that is no one's doing that week.
    await env.DB.prepare(
      `INSERT INTO score_events (user_id, delta, reason, resulting_score, created_at)
       VALUES (?, -40, 'admin_adjust', 60, ?)`,
    )
      .bind(b.id, inLastWeek(2))
      .run();
    const s = await computeStats(env.DB, previousWeekStart(OFFSET_HOURS), OFFSET_HOURS);
    expect(s.pigeon?.name).toBe('阿强');
    expect(s.pigeon?.delta).toBe(-3);
  });

  it('awards 最会说话 to the biggest gap above the anchor', async () => {
    const judge = await seedUser({ id: 'judge', judge: true });
    const a = await seedUser({ id: 'a', username: '阿强' });
    const b = await seedUser({ id: 'b', username: '小明' });

    // no_show anchors at -15. a talked it down to -9 (saved 6); b only to -12 (3).
    await seedCase({
      subject: a.id,
      reporter: judge.id,
      type: 'no_show',
      delta: -9,
      statement: '公司通宵发版',
    });
    await seedCase({
      subject: b.id,
      reporter: judge.id,
      type: 'no_show',
      delta: -12,
      statement: '堵在路上',
      at: inLastWeek(2),
    });

    const s = await computeStats(env.DB, previousWeekStart(OFFSET_HOURS), OFFSET_HOURS);
    expect(s.bestTalker?.name).toBe('阿强');
    expect(s.bestTalker?.savedBy).toBe(-9 - VIOLATION_MAP.no_show.base); // 6
    expect(s.harshest?.name).toBe('小明');
    expect(s.harshest?.delta).toBe(-12);
  });

  it('gives no 最会说话 award when nobody beat the anchor', async () => {
    const judge = await seedUser({ id: 'judge', judge: true });
    const a = await seedUser({ id: 'a', username: '阿强' });
    await seedCase({ subject: a.id, reporter: judge.id, type: 'no_show', delta: -18 });

    const s = await computeStats(env.DB, previousWeekStart(OFFSET_HOURS), OFFSET_HOURS);
    expect(s.bestTalker).toBeNull();
  });

  it('counts absent verdicts', async () => {
    const judge = await seedUser({ id: 'judge', judge: true });
    const a = await seedUser({ id: 'a' });
    await seedCase({ subject: a.id, reporter: judge.id, type: 'no_show', delta: -15 });
    await seedCase({
      subject: a.id,
      reporter: judge.id,
      type: 'afk',
      delta: -8,
      statement: '我说了',
      at: inLastWeek(2),
    });

    const s = await computeStats(env.DB, previousWeekStart(OFFSET_HOURS), OFFSET_HOURS);
    expect(s.absentVerdicts).toBe(1);
  });

  it('does not query retired session tables or include their figures in new stats', async () => {
    const queries: string[] = [];
    const db = { prepare(sql: string) { queries.push(sql); return env.DB.prepare(sql); } } as D1Database;
    const stats = await computeStats(db, previousWeekStart(OFFSET_HOURS), OFFSET_HOURS);
    expect(queries.some((sql) => /game_sessions|session_players/.test(sql))).toBe(false);
    for (const key of ['sessionsPlayed', 'sessionsCollapsed', 'attendanceRate', 'upcomingNextWeek', 'topOrganizer']) {
      expect(stats).not.toHaveProperty(key);
    }
    // An old sessions-only shape must not make a new week look active.
    expect(hadActivity({ ...stats, sessionsPlayed: 3 } as typeof stats)).toBe(false);
  });

  it('returns an all-empty shape for a quiet week rather than throwing', async () => {
    const s = await computeStats(env.DB, previousWeekStart(OFFSET_HOURS), OFFSET_HOURS);
    expect(s.casesFiled).toBe(0);
    expect(s.totalPenalty).toBe(0);
    expect(s.star).toBeNull();
    expect(s.pigeon).toBeNull();
    expect(s.bestTalker).toBeNull();
  });
});

describe('fallbackNarrative', () => {
  it('keeps retired session figures out of fallback prose and the AI message', async () => {
    const stats = { ...await computeStats(env.DB, previousWeekStart(OFFSET_HOURS), OFFSET_HOURS),
      sessionsPlayed: 3, sessionsCollapsed: 1, attendanceRate: 0.5, upcomingNextWeek: 2,
      topOrganizer: { name: '历史组织者', count: 3 } };
    expect(fallbackNarrative(stats)).not.toMatch(/开了|约局|下周已经约/);
    expect(buildReportMessage(stats)).not.toMatch(/约局|散局|出勤率|组局|历史组织者/);
    expect(DEFAULT_REPORT_PROMPT).not.toContain('开黑约局');
  });

  it('describes a quiet week without inventing anyone', async () => {
    const s = await computeStats(env.DB, previousWeekStart(OFFSET_HOURS), OFFSET_HOURS);
    const text = fallbackNarrative(s);
    expect(text.length).toBeGreaterThan(10);
    expect(text).toContain('没有');
  });

  it('names only people present in the stats', async () => {
    const judge = await seedUser({ id: 'judge', judge: true });
    const a = await seedUser({ id: 'a', username: '阿强' });
    await seedCase({ subject: a.id, reporter: judge.id, type: 'no_show', delta: -9, statement: 'x' });

    const s = await computeStats(env.DB, previousWeekStart(OFFSET_HOURS), OFFSET_HOURS);
    const text = fallbackNarrative(s);
    expect(text).toContain('阿强');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('null');
  });
});

/** Wednesday noon this week: past the report's Monday 10:30, whatever the real time. */
const REPORT_DUE = inThisWeek(2 * 24 + 12);

describe('reportDue — Monday 10:30, board time', () => {
  it('opens at 10:30 on Monday and stays open all week', () => {
    expect(reportDue(8, Date.parse('2026-10-26T02:29:59Z'))).toBe(false); // Mon 10:29:59 at UTC+8
    expect(reportDue(8, Date.parse('2026-10-26T02:30:00Z'))).toBe(true);
    expect(reportDue(8, Date.parse('2026-11-01T15:59:00Z'))).toBe(true); // Sun 23:59
    expect(reportDue(8, Date.parse('2026-11-01T16:00:00Z'))).toBe(false); // the next Monday 00:00
    expect(reportDue(-5, Date.parse('2026-10-26T15:30:00Z'))).toBe(true); // Mon 10:30 at UTC-5
  });
});

describe('ensureWeeklyReport — idempotent per week', () => {
  /** A report is only generated for a week that actually had something happen. */
  async function seedActivity(): Promise<void> {
    const judge = await seedUser({ id: 'rjudge', judge: true });
    const a = await seedUser({ id: 'ra', username: '阿强' });
    await seedCase({ subject: a.id, reporter: judge.id, type: 'no_show', delta: -15 });
  }

  it('waits for Monday 10:30', async () => {
    await seedActivity();
    expect(await ensureWeeklyReport(env.DB, noAiEnv(), OFFSET_HOURS, inThisWeek(10))).toBeNull();
    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM weekly_reports').first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });

  it('waits for last week’s cases to be judged — but not for ever', async () => {
    await seedActivity();
    // Filed late on Sunday, still waiting for its statement on Monday morning.
    await env.DB.prepare(
      `INSERT INTO records (subject_id, reporter_id, type, delta, claim, status, deadline_at, created_at)
       VALUES ('ra', 'rjudge', 'no_show', 0, '周日晚上没来', 'awaiting_statement', ?, ?)`,
    )
      .bind(inLastWeek(6, 23), inLastWeek(6, 23))
      .run();
    expect(await ensureWeeklyReport(env.DB, noAiEnv(), OFFSET_HOURS, inThisWeek(11))).toBeNull();
    // A statement window (12 h) past the week's end, plus an hour: written anyway.
    expect(await ensureWeeklyReport(env.DB, noAiEnv(), OFFSET_HOURS, inThisWeek(13.5))).not.toBeNull();
  });

  it('skips a week in which nothing happened — no card beats an empty card', async () => {
    expect(await ensureWeeklyReport(env.DB, noAiEnv(), OFFSET_HOURS, REPORT_DUE)).toBeNull();
    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM weekly_reports').first<{
      n: number;
    }>();
    expect(rows?.n).toBe(0);
  });

  it('generates last week once and reuses it thereafter', async () => {
    await seedActivity();
    const week = previousWeekStart(OFFSET_HOURS);
    const first = await ensureWeeklyReport(env.DB, noAiEnv(), OFFSET_HOURS, REPORT_DUE);
    expect(first?.week_start).toBe(week);
    expect(first?.source).toBe('fallback'); // AI is off in tests

    const second = await ensureWeeklyReport(env.DB, noAiEnv(), OFFSET_HOURS, REPORT_DUE);
    expect(second?.created_at).toBe(first?.created_at);

    const rows = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM weekly_reports WHERE week_start = ?',
    )
      .bind(week)
      .first<{ n: number }>();
    expect(rows?.n).toBe(1);
  });

  it('survives a concurrent burst with exactly one row', async () => {
    await seedActivity();
    // Monday morning: everyone opens the page at once.
    await Promise.all(
      Array.from({ length: 5 }, () => ensureWeeklyReport(env.DB, noAiEnv(), OFFSET_HOURS, REPORT_DUE)),
    );
    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM weekly_reports').first<{
      n: number;
    }>();
    expect(rows?.n).toBe(1);
  });

  it('stores the SQL-computed stats verbatim alongside the prose', async () => {
    const judge = await seedUser({ id: 'judge', judge: true });
    const a = await seedUser({ id: 'a', username: '阿强' });
    await seedCase({ subject: a.id, reporter: judge.id, type: 'no_show', delta: -15 });

    const report = await ensureWeeklyReport(env.DB, noAiEnv(), OFFSET_HOURS, REPORT_DUE);
    const direct = await computeStats(env.DB, previousWeekStart(OFFSET_HOURS), OFFSET_HOURS);
    // The card renders `stats`; it must equal what SQL says, not a paraphrase.
    expect(report?.stats).toEqual(direct);
  });
});

describe('regenerateReport — only a finished week', () => {
  it('refuses a day that is not a Monday, and a week still running', async () => {
    const last = previousWeekStart(OFFSET_HOURS);
    const tuesday = new Date(Date.parse(`${last}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const thisWeek = new Date(Date.parse(`${last}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
    await expect(regenerateReport(env.DB, noAiEnv(), tuesday, OFFSET_HOURS)).rejects.toMatchObject({ status: 400 });
    await expect(regenerateReport(env.DB, noAiEnv(), thisWeek, OFFSET_HOURS)).rejects.toMatchObject({ status: 400 });
    await expect(regenerateReport(env.DB, noAiEnv(), last, OFFSET_HOURS)).resolves.toMatchObject({ week_start: last });
  });
});

describe('regenerateReport', () => {
  it('overwrites the narrative for an existing week', async () => {
    const judge = await seedUser({ id: 'rjudge', judge: true });
    const a = await seedUser({ id: 'ra', username: '阿强' });
    await seedCase({ subject: a.id, reporter: judge.id, type: 'no_show', delta: -15 });
    const week = previousWeekStart(OFFSET_HOURS);
    await ensureWeeklyReport(env.DB, noAiEnv(), OFFSET_HOURS, REPORT_DUE);
    const again = await regenerateReport(env.DB, noAiEnv(), week, OFFSET_HOURS);

    expect(again.week_start).toBe(week);
    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM weekly_reports').first<{
      n: number;
    }>();
    expect(rows?.n).toBe(1);
  });

  // An admin asking for a report explicitly overrides the activity gate.
  it('can create a report for a week that was never generated', async () => {
    const report = await regenerateReport(env.DB, noAiEnv(), '2026-01-05', OFFSET_HOURS);
    expect(report.week_start).toBe('2026-01-05');
    expect(await getReport(env.DB, '2026-01-05')).not.toBeNull();
  });

  it('rejects a malformed week key', async () => {
    await expect(
      regenerateReport(env.DB, noAiEnv(), 'last-week', OFFSET_HOURS),
    ).rejects.toThrow(/YYYY-MM-DD/);
  });
});

describe('previousWeekStart', () => {
  it('is a Monday, one week before the current one', () => {
    const week = previousWeekStart(OFFSET_HOURS);
    expect(week).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(`${week}T00:00:00Z`).getUTCDay()).toBe(1);
    expect(Date.parse(`${week}T00:00:00Z`)).toBeLessThan(Date.now());
  });
});

// P3-7: the event that first applied a case's score determines its report week.
describe('P3-7 verdict-time report basis', () => {
  const currentWeek = (): string => new Date(Date.parse(`${previousWeekStart(OFFSET_HOURS)}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  const sqlNowWeek = (): string => new Date(inThisWeek(24)).toISOString().replace('T', ' ').slice(0, 19);

  async function judgedCase(options: { filedAt?: string; judgedAt?: string; type?: string; delta?: number; sessionId?: number } = {}): Promise<number> {
    await seedUser({ id: 'verdict-judge', judge: true });
    await seedUser({ id: 'verdict-player', username: '好好解释的人' });
    const row = await env.DB.prepare(
      `INSERT INTO records (subject_id, reporter_id, type, delta, claim, statement, status, verdict_source, created_at, session_id)
       VALUES ('verdict-player', 'verdict-judge', ?, ?, '立案经过', '提前解释', 'decided', 'ai', ?, ?)`,
    ).bind(options.type ?? 'no_show', options.delta ?? -9, options.filedAt ?? inLastWeek(), options.sessionId ?? null).run();
    const id = Number(row.meta?.last_row_id);
    if (options.judgedAt !== undefined) await scoreEvent(id, options.judgedAt, options.delta ?? -9);
    return id;
  }

  async function scoreEvent(id: number, at: string, delta: number, userId = 'verdict-player'): Promise<void> {
    await env.DB.prepare(`INSERT INTO score_events (user_id, delta, reason, resulting_score, created_at) VALUES (?, ?, ?, 91, ?)`)
      .bind(userId, delta, `record:${id}`, at).run();
  }

  it('counts a case filed last week but judged this week only in the verdict week', async () => {
    await judgedCase({ judgedAt: sqlNowWeek() });
    const previous = await computeStats(env.DB, previousWeekStart(OFFSET_HOURS), OFFSET_HOURS);
    const current = await computeStats(env.DB, currentWeek(), OFFSET_HOURS);
    expect(previous.casesFiled).toBe(0); expect(previous.totalPenalty).toBe(0); expect(previous.bestTalker).toBeNull();
    expect(current).toMatchObject({ basis: 'verdict', casesFiled: 1, totalPenalty: -9,
      bestTalker: { name: '好好解释的人', savedBy: 6 } });
  });

  it('keeps last-week verdicts in last week even when filed earlier', async () => {
    const earlier = new Date(Date.parse(inLastWeek() + 'Z') - 7 * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
    await judgedCase({ filedAt: earlier, judgedAt: inLastWeek(2) });
    expect(await computeStats(env.DB, previousWeekStart(OFFSET_HOURS), OFFSET_HOURS)).toMatchObject({ basis: 'verdict', casesFiled: 1, totalPenalty: -9 });
    expect((await computeStats(env.DB, currentWeek(), OFFSET_HOURS)).casesFiled).toBe(0);
  });

  it('falls back to filing time for zero-delta records without an exact record event', async () => {
    await judgedCase({ delta: 0 });
    await env.DB.prepare(`INSERT INTO score_events (user_id, delta, reason, resulting_score, created_at) VALUES ('verdict-player', 0, 'record:seed', 100, ?)`)
      .bind(sqlNowWeek()).run();
    expect(await computeStats(env.DB, previousWeekStart(OFFSET_HOURS), OFFSET_HOURS)).toMatchObject({ basis: 'verdict', casesFiled: 1, totalPenalty: 0 });
    expect((await computeStats(env.DB, currentWeek(), OFFSET_HOURS)).casesFiled).toBe(0);
  });

  it('uses the subject and exact record id when looking up a verdict event', async () => {
    const id = await judgedCase({ judgedAt: sqlNowWeek() });
    await scoreEvent(id, inLastWeek(), -9, 'verdict-judge');
    expect((await computeStats(env.DB, previousWeekStart(OFFSET_HOURS), OFFSET_HOURS)).casesFiled).toBe(0);
    expect((await computeStats(env.DB, currentWeek(), OFFSET_HOURS)).casesFiled).toBe(1);
  });

  it('uses the first matching event when later score corrections exist', async () => {
    const id = await judgedCase({ judgedAt: inLastWeek(3) });
    await scoreEvent(id, sqlNowWeek(), 2);
    expect((await computeStats(env.DB, previousWeekStart(OFFSET_HOURS), OFFSET_HOURS)).casesFiled).toBe(1);
    expect((await computeStats(env.DB, currentWeek(), OFFSET_HOURS)).casesFiled).toBe(0);
  });

  it('still excludes cases that have not been decided', async () => {
    const id = await judgedCase({ judgedAt: sqlNowWeek() });
    await env.DB.prepare(`UPDATE records SET status = 'awaiting_statement' WHERE id = ?`).bind(id).run();
    expect(await computeStats(env.DB, currentWeek(), OFFSET_HOURS)).toMatchObject({ casesFiled: 0, bestTalker: null });
  });

  it('persists the same verdict-basis stats returned directly by computeStats', async () => {
    await judgedCase({ judgedAt: inLastWeek(3) });
    const report = await ensureWeeklyReport(env.DB, noAiEnv(), OFFSET_HOURS, REPORT_DUE);
    const direct = await computeStats(env.DB, previousWeekStart(OFFSET_HOURS), OFFSET_HOURS);
    expect(report?.stats).toEqual(direct); expect(report?.stats).toHaveProperty('basis', 'verdict');
  });

  it('does not recalculate an existing report written without basis', async () => {
    const { basis: _newBasis, ...figures } = await computeStats(env.DB, previousWeekStart(OFFSET_HOURS), OFFSET_HOURS);
    const oldStats = { ...figures, casesFiled: 7 };
    await env.DB.prepare(`INSERT INTO weekly_reports (week_start, stats_json, narrative, source) VALUES (?, ?, '原来的周报', 'fallback')`)
      .bind(previousWeekStart(OFFSET_HOURS), JSON.stringify(oldStats)).run();
    await judgedCase({ judgedAt: inLastWeek() });
    const report = await ensureWeeklyReport(env.DB, noAiEnv(), OFFSET_HOURS, REPORT_DUE);
    expect(report?.stats).toEqual(oldStats); expect(report?.narrative).toBe('原来的周报');
  });
});
