import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { VIOLATION_MAP } from '../../shared/scoring';
import { fallbackNarrative } from '../../worker/ai/report';
import {
  computeStats,
  ensureWeeklyReport,
  getReport,
  previousWeekStart,
  regenerateReport,
} from '../../worker/report';
import { OFFSET_HOURS, noAiEnv, seedUser } from './helpers';

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

function isoInLastWeek(dayOffset = 1, hour = 20): string {
  const week = previousWeekStart(OFFSET_HOURS);
  const ms =
    Date.parse(`${week}T00:00:00Z`) -
    OFFSET_HOURS * 3_600_000 +
    dayOffset * 86_400_000 +
    hour * 3_600_000;
  return new Date(ms).toISOString();
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

  it('derives sessions, organizer and attendance rate from the session tables', async () => {
    const org = await seedUser({ id: 'org', username: '团长' });
    const a = await seedUser({ id: 'a' });
    const b = await seedUser({ id: 'b' });

    const res = await env.DB.prepare(
      `INSERT INTO game_sessions (organizer_id, title, starts_at, status, settled_at)
       VALUES (?, '周五开黑', ?, 'settled', datetime('now'))`,
    )
      .bind(org.id, isoInLastWeek(4))
      .run();
    const sid = Number(res.meta?.last_row_id);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO session_players (session_id, user_id, rsvp, attendance) VALUES (?, ?, 'going', 'on_time')",
      ).bind(sid, a.id),
      env.DB.prepare(
        "INSERT INTO session_players (session_id, user_id, rsvp, attendance) VALUES (?, ?, 'going', 'no_show')",
      ).bind(sid, b.id),
    ]);

    const s = await computeStats(env.DB, previousWeekStart(OFFSET_HOURS), OFFSET_HOURS);
    expect(s.sessionsPlayed).toBe(1);
    expect(s.topOrganizer?.name).toBe('团长');
    expect(s.attendanceRate).toBeCloseTo(0.5);
  });

  it('returns an all-empty shape for a quiet week rather than throwing', async () => {
    const s = await computeStats(env.DB, previousWeekStart(OFFSET_HOURS), OFFSET_HOURS);
    expect(s.casesFiled).toBe(0);
    expect(s.totalPenalty).toBe(0);
    expect(s.star).toBeNull();
    expect(s.pigeon).toBeNull();
    expect(s.bestTalker).toBeNull();
    expect(s.attendanceRate).toBeNull();
  });
});

describe('fallbackNarrative', () => {
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

describe('ensureWeeklyReport — idempotent per week', () => {
  /** A report is only generated for a week that actually had something happen. */
  async function seedActivity(): Promise<void> {
    const judge = await seedUser({ id: 'rjudge', judge: true });
    const a = await seedUser({ id: 'ra', username: '阿强' });
    await seedCase({ subject: a.id, reporter: judge.id, type: 'no_show', delta: -15 });
  }

  it('skips a week in which nothing happened — no card beats an empty card', async () => {
    expect(await ensureWeeklyReport(env.DB, noAiEnv(), OFFSET_HOURS)).toBeNull();
    const rows = await env.DB.prepare('SELECT COUNT(*) AS n FROM weekly_reports').first<{
      n: number;
    }>();
    expect(rows?.n).toBe(0);
  });

  it('generates last week once and reuses it thereafter', async () => {
    await seedActivity();
    const week = previousWeekStart(OFFSET_HOURS);
    const first = await ensureWeeklyReport(env.DB, noAiEnv(), OFFSET_HOURS);
    expect(first?.week_start).toBe(week);
    expect(first?.source).toBe('fallback'); // AI is off in tests

    const second = await ensureWeeklyReport(env.DB, noAiEnv(), OFFSET_HOURS);
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
      Array.from({ length: 5 }, () => ensureWeeklyReport(env.DB, noAiEnv(), OFFSET_HOURS)),
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

    const report = await ensureWeeklyReport(env.DB, noAiEnv(), OFFSET_HOURS);
    const direct = await computeStats(env.DB, previousWeekStart(OFFSET_HOURS), OFFSET_HOURS);
    // The card renders `stats`; it must equal what SQL says, not a paraphrase.
    expect(report?.stats).toEqual(direct);
  });
});

describe('regenerateReport', () => {
  it('overwrites the narrative for an existing week', async () => {
    const judge = await seedUser({ id: 'rjudge', judge: true });
    const a = await seedUser({ id: 'ra', username: '阿强' });
    await seedCase({ subject: a.id, reporter: judge.id, type: 'no_show', delta: -15 });
    const week = previousWeekStart(OFFSET_HOURS);
    await ensureWeeklyReport(env.DB, noAiEnv(), OFFSET_HOURS);
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
