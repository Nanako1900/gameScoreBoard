// Pins the observable behaviour of the weekly credit heal (worker/db.ts
// weeklyHeal) and the cron entrypoint that drives it (worker/index.ts
// scheduled), so the D1 -> PostgreSQL port cannot silently change it.
//
// What callers observe: the returned { week_start, affected, skipped }, the
// users.score values, the score_events audit rows, and the weekly_heals ledger
// row whose primary key is the local Monday under RESET_TZ_OFFSET.
//
// Only `Date` is faked — D1 I/O still needs real timers, and SQLite's own
// datetime('now') (applied_at / created_at) is unaffected by the fake clock.

import { createExecutionContext, createScheduledController, env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_SCORE, WEEKLY_HEAL } from '../../shared/scoring';
import { fileCase } from '../../worker/cases';
import { weeklyHeal } from '../../worker/db';
import worker from '../../worker/index';
import { weekStartLocal } from '../../worker/time';
import type { Env } from '../../worker/types';
import {
  OFFSET_HOURS,
  expireDeadline,
  noAiEnv,
  scoreEventCount,
  scoreOf,
  seedUser,
  statusOf,
} from './helpers';

const SQL_SHAPE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

// Calendar anchors (2026-10-26 is a Monday).
/** Wednesday noon in UTC+8, mid-week in every offset used here. */
const WED_MID_WEEK = '2026-10-28T04:00:00.000Z';
/** Exactly Monday 2026-10-26 00:00:00 in UTC+8 (still Sunday 16:00 in UTC). */
const MONDAY_MIDNIGHT_CST = '2026-10-25T16:00:00.000Z';
/** One millisecond earlier: Sunday 23:59:59.999 in UTC+8. */
const SUNDAY_LAST_MS_CST = '2026-10-25T15:59:59.999Z';
/** Sunday 2026-11-01 23:59:00 in UTC+8 — the last minute of the same local week. */
const SUNDAY_LATE_SAME_WEEK_CST = '2026-11-01T15:59:00.000Z';

const THIS_MONDAY = '2026-10-26';
const PREV_MONDAY = '2026-10-19';
const NEXT_MONDAY = '2026-11-02';

function freezeAt(iso: string): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

interface HealRow {
  week_start: string;
  affected: number;
  applied_at: string;
}

async function healLedger(): Promise<HealRow[]> {
  const rows = await env.DB.prepare(
    'SELECT week_start, affected, applied_at FROM weekly_heals ORDER BY week_start ASC',
  ).all<HealRow>();
  return rows.results;
}

interface EventRow {
  user_id: string;
  delta: number;
  reason: string;
  resulting_score: number;
  created_at: string;
}

async function eventsOf(userId: string): Promise<EventRow[]> {
  const rows = await env.DB.prepare(
    `SELECT user_id, delta, reason, resulting_score, created_at
       FROM score_events WHERE user_id = ? ORDER BY id ASC`,
  )
    .bind(userId)
    .all<EventRow>();
  return rows.results;
}

async function totalEvents(): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM score_events').first<{ n: number }>();
  return row?.n ?? -1;
}

describe('weeklyHeal — who gets healed and by how much', () => {
  it('adds WEEKLY_HEAL to a participant with room below the cap', async () => {
    freezeAt(WED_MID_WEEK);
    await seedUser({ id: 'mid', score: 50 });

    const result = await weeklyHeal(env.DB, OFFSET_HOURS);

    expect(WEEKLY_HEAL).toBe(15);
    expect(result).toEqual({ week_start: THIS_MONDAY, affected: 1, skipped: false });
    expect(await scoreOf('mid')).toBe(65);
  });

  it('caps at MAX_SCORE and logs only the delta that actually landed', async () => {
    freezeAt(WED_MID_WEEK);
    await seedUser({ id: 'at85', score: 85 }); // exactly +15 -> 100
    await seedUser({ id: 'at86', score: 86 }); // +14, capped
    await seedUser({ id: 'at99', score: 99 }); // +1, capped

    const result = await weeklyHeal(env.DB, OFFSET_HOURS);

    expect(result.affected).toBe(3);
    for (const id of ['at85', 'at86', 'at99']) {
      expect(await scoreOf(id)).toBe(MAX_SCORE);
    }
    expect((await eventsOf('at85')).map((e) => e.delta)).toEqual([15]);
    expect((await eventsOf('at86')).map((e) => e.delta)).toEqual([14]);
    expect((await eventsOf('at99')).map((e) => e.delta)).toEqual([1]);
  });

  it('heals a participant sitting at zero', async () => {
    freezeAt(WED_MID_WEEK);
    await seedUser({ id: 'broke', score: 0 });

    await weeklyHeal(env.DB, OFFSET_HOURS);

    expect(await scoreOf('broke')).toBe(15);
  });

  it('leaves participants already at MAX_SCORE untouched — no event, not counted', async () => {
    freezeAt(WED_MID_WEEK);
    await seedUser({ id: 'full', score: 100 });
    await seedUser({ id: 'low', score: 40 });

    const result = await weeklyHeal(env.DB, OFFSET_HOURS);

    expect(result).toEqual({ week_start: THIS_MONDAY, affected: 1, skipped: false });
    expect(await scoreOf('full')).toBe(100);
    expect(await scoreEventCount('full')).toBe(0);
    expect(await scoreOf('low')).toBe(55);
  });

  it('never touches non-participants, even with a low score', async () => {
    freezeAt(WED_MID_WEEK);
    await seedUser({ id: 'spectator', participant: false, score: 10 });
    await seedUser({ id: 'judge-only', participant: false, judge: true, score: 30 });
    await seedUser({ id: 'player', score: 10 });

    const result = await weeklyHeal(env.DB, OFFSET_HOURS);

    expect(result.affected).toBe(1);
    expect(await scoreOf('spectator')).toBe(10);
    expect(await scoreOf('judge-only')).toBe(30);
    expect(await scoreEventCount('spectator')).toBe(0);
    expect(await scoreEventCount('judge-only')).toBe(0);
    expect(await scoreOf('player')).toBe(25);
  });

  it('heals judges and admins who are also participants', async () => {
    freezeAt(WED_MID_WEEK);
    await seedUser({ id: 'ref', judge: true, score: 60 });
    await seedUser({ id: 'boss', admin: true, score: 70 });

    const result = await weeklyHeal(env.DB, OFFSET_HOURS);

    expect(result.affected).toBe(2);
    expect(await scoreOf('ref')).toBe(75);
    expect(await scoreOf('boss')).toBe(85);
  });

  it('returns a plain number for affected and a real boolean for skipped', async () => {
    freezeAt(WED_MID_WEEK);
    await seedUser({ id: 'a', score: 10 });
    await seedUser({ id: 'b', score: 20 });

    const result = await weeklyHeal(env.DB, OFFSET_HOURS);

    expect(typeof result.affected).toBe('number');
    expect(result.affected).toBe(2);
    expect(result.skipped).toBe(false);
    expect(typeof result.week_start).toBe('string');
  });
});

describe('weeklyHeal — audit trail', () => {
  it("writes one 'weekly_heal' score_event per healed user with the applied delta and resulting score", async () => {
    freezeAt(WED_MID_WEEK);
    await seedUser({ id: 'u1', score: 50 });
    await seedUser({ id: 'u2', score: 92 });

    await weeklyHeal(env.DB, OFFSET_HOURS);

    const u1 = await eventsOf('u1');
    const u2 = await eventsOf('u2');
    expect(u1).toHaveLength(1);
    expect(u2).toHaveLength(1);
    expect(u1[0]).toMatchObject({ user_id: 'u1', delta: 15, reason: 'weekly_heal', resulting_score: 65 });
    expect(u2[0]).toMatchObject({ user_id: 'u2', delta: 8, reason: 'weekly_heal', resulting_score: 100 });
    expect(u1[0].created_at).toMatch(SQL_SHAPE);
    expect(await totalEvents()).toBe(2);
  });

  it('keeps resulting_score equal to the stored users.score', async () => {
    freezeAt(WED_MID_WEEK);
    await seedUser({ id: 'x', score: 33 });

    await weeklyHeal(env.DB, OFFSET_HOURS);

    const [event] = await eventsOf('x');
    expect(event.resulting_score).toBe(await scoreOf('x'));
    expect(event.resulting_score).toBe(48);
  });

  it("refreshes updated_at only for users whose score moved", async () => {
    freezeAt(WED_MID_WEEK);
    await seedUser({ id: 'moved', score: 50 });
    await seedUser({ id: 'still', score: 100 });
    await env.DB.prepare("UPDATE users SET updated_at = '2000-01-01 00:00:00'").run();

    await weeklyHeal(env.DB, OFFSET_HOURS);

    const rows = await env.DB.prepare('SELECT id, updated_at FROM users ORDER BY id ASC').all<{
      id: string;
      updated_at: string;
    }>();
    const byId = Object.fromEntries(rows.results.map((r) => [r.id, r.updated_at]));
    expect(byId.still).toBe('2000-01-01 00:00:00');
    expect(byId.moved).not.toBe('2000-01-01 00:00:00');
    expect(byId.moved).toMatch(SQL_SHAPE);
  });
});

describe('weeklyHeal — idempotency ledger', () => {
  it('records the week in weekly_heals with the affected count', async () => {
    freezeAt(WED_MID_WEEK);
    await seedUser({ id: 'a', score: 10 });
    await seedUser({ id: 'b', score: 95 });
    await seedUser({ id: 'c', score: 100 }); // not counted
    await seedUser({ id: 'd', participant: false, score: 10 }); // not counted

    await weeklyHeal(env.DB, OFFSET_HOURS);

    const ledger = await healLedger();
    expect(ledger).toHaveLength(1);
    expect(ledger[0].week_start).toBe(THIS_MONDAY);
    expect(ledger[0].affected).toBe(2);
    expect(typeof ledger[0].affected).toBe('number');
    expect(ledger[0].applied_at).toMatch(SQL_SHAPE);
  });

  it('is a no-op on a second call in the same week', async () => {
    freezeAt(WED_MID_WEEK);
    await seedUser({ id: 'a', score: 40 });

    const first = await weeklyHeal(env.DB, OFFSET_HOURS);
    const second = await weeklyHeal(env.DB, OFFSET_HOURS);

    expect(first).toEqual({ week_start: THIS_MONDAY, affected: 1, skipped: false });
    // The skipped result reports 0, not the count stored in the ledger.
    expect(second).toEqual({ week_start: THIS_MONDAY, affected: 0, skipped: true });
    expect(await scoreOf('a')).toBe(55);
    expect(await scoreEventCount('a')).toBe(1);
    const ledger = await healLedger();
    expect(ledger).toHaveLength(1);
    expect(ledger[0].affected).toBe(1);
  });

  it('stays a no-op for the rest of the local week, up to Sunday 23:59', async () => {
    freezeAt(MONDAY_MIDNIGHT_CST);
    await seedUser({ id: 'a', score: 40 });
    await weeklyHeal(env.DB, OFFSET_HOURS);

    vi.setSystemTime(new Date(SUNDAY_LATE_SAME_WEEK_CST));
    const late = await weeklyHeal(env.DB, OFFSET_HOURS);

    expect(late).toEqual({ week_start: THIS_MONDAY, affected: 0, skipped: true });
    expect(await scoreOf('a')).toBe(55);
  });

  it('records a ledger row even when nobody needed healing, which closes the week', async () => {
    freezeAt(WED_MID_WEEK);
    await seedUser({ id: 'full', score: 100 });

    const first = await weeklyHeal(env.DB, OFFSET_HOURS);
    expect(first).toEqual({ week_start: THIS_MONDAY, affected: 0, skipped: false });
    expect(await healLedger()).toEqual([
      expect.objectContaining({ week_start: THIS_MONDAY, affected: 0 }),
    ]);

    // Someone who drops below the cap later the same week is not healed until next week.
    await env.DB.prepare('UPDATE users SET score = 70 WHERE id = ?').bind('full').run();
    const second = await weeklyHeal(env.DB, OFFSET_HOURS);
    expect(second.skipped).toBe(true);
    expect(await scoreOf('full')).toBe(70);
  });

  it('closes the week even with no users at all', async () => {
    freezeAt(WED_MID_WEEK);

    const result = await weeklyHeal(env.DB, OFFSET_HOURS);

    expect(result).toEqual({ week_start: THIS_MONDAY, affected: 0, skipped: false });
    expect(await healLedger()).toHaveLength(1);
    expect(await totalEvents()).toBe(0);
  });

  it('does not heal a participant who joined after this week was already healed', async () => {
    freezeAt(WED_MID_WEEK);
    await seedUser({ id: 'early', score: 50 });
    await weeklyHeal(env.DB, OFFSET_HOURS);

    await seedUser({ id: 'late', score: 50 });
    const again = await weeklyHeal(env.DB, OFFSET_HOURS);

    expect(again.skipped).toBe(true);
    expect(await scoreOf('early')).toBe(65);
    expect(await scoreOf('late')).toBe(50);
  });

  it('heals again the following week and keeps one ledger row per week', async () => {
    freezeAt(WED_MID_WEEK);
    await seedUser({ id: 'a', score: 50 });
    await seedUser({ id: 'b', score: 90 });

    const week1 = await weeklyHeal(env.DB, OFFSET_HOURS);
    vi.setSystemTime(new Date(Date.parse(WED_MID_WEEK) + 7 * 86_400_000));
    const week2 = await weeklyHeal(env.DB, OFFSET_HOURS);

    expect(week1).toEqual({ week_start: THIS_MONDAY, affected: 2, skipped: false });
    // b reached 100 in week 1, so only a is affected in week 2.
    expect(week2).toEqual({ week_start: NEXT_MONDAY, affected: 1, skipped: false });
    expect(await scoreOf('a')).toBe(80);
    expect(await scoreOf('b')).toBe(100);
    expect((await eventsOf('a')).map((e) => [e.delta, e.resulting_score])).toEqual([
      [15, 65],
      [15, 80],
    ]);
    expect((await healLedger()).map((r) => [r.week_start, r.affected])).toEqual([
      [THIS_MONDAY, 2],
      [NEXT_MONDAY, 1],
    ]);
  });

  it('applies exactly once when two heals race in the same week', async () => {
    freezeAt(WED_MID_WEEK);
    await seedUser({ id: 'a', score: 40 });
    await seedUser({ id: 'b', score: 70 });

    const settled = await Promise.allSettled([
      weeklyHeal(env.DB, OFFSET_HOURS),
      weeklyHeal(env.DB, OFFSET_HOURS),
    ]);

    // One call wins. The loser either saw the ledger row (skipped) or lost the
    // primary-key race and had its whole batch rolled back (rejected) — never a
    // second +15. The PG port must keep the score writes and the ledger insert
    // in one transaction for this to hold.
    // On D1 today the loser is the rejected kind (UNIQUE constraint on
    // weekly_heals.week_start); the /api/config caller catches and logs it.
    const applied = settled.filter(
      (s) => s.status === 'fulfilled' && s.value.skipped === false,
    );
    expect(applied).toHaveLength(1);
    for (const s of settled) {
      if (s.status === 'fulfilled' && s.value.skipped) {
        expect(s.value).toEqual({ week_start: THIS_MONDAY, affected: 0, skipped: true });
      }
      if (s.status === 'rejected') {
        expect(s.reason).toBeInstanceOf(Error);
      }
    }
    expect(await scoreOf('a')).toBe(55);
    expect(await scoreOf('b')).toBe(85);
    expect(await scoreEventCount('a')).toBe(1);
    expect(await scoreEventCount('b')).toBe(1);
    expect(await healLedger()).toEqual([
      expect.objectContaining({ week_start: THIS_MONDAY, affected: 2 }),
    ]);
  });

  it('rolls back every score write when the ledger insert collides with a week committed meanwhile', async () => {
    // Deterministic version of the race above: a concurrent winner commits this
    // week's ledger row after this call's "already healed?" check but before its
    // batch. The score UPDATEs run first in the batch and the ledger INSERT last,
    // so only an all-or-nothing transaction keeps them from landing. A PG port
    // using ON CONFLICT DO NOTHING inside the same transaction would double-heal;
    // ON CONFLICT DO UPDATE would also clobber the winner's ledger row.
    freezeAt(WED_MID_WEEK);
    await seedUser({ id: 'a', score: 40 });
    await seedUser({ id: 'b', score: 90 });
    const racedDb = new Proxy(env.DB, {
      get(target, prop) {
        if (prop === 'batch') {
          return async (statements: D1PreparedStatement[]) => {
            await target
              .prepare('INSERT INTO weekly_heals (week_start, affected) VALUES (?, ?)')
              .bind(THIS_MONDAY, 9)
              .run();
            return target.batch(statements);
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    // Both D1's and PostgreSQL's unique-violation messages name the table.
    await expect(weeklyHeal(racedDb, OFFSET_HOURS)).rejects.toThrow(/weekly_heals/);

    expect(await scoreOf('a')).toBe(40);
    expect(await scoreOf('b')).toBe(90);
    expect(await totalEvents()).toBe(0);
    expect((await healLedger()).map((r) => [r.week_start, r.affected])).toEqual([[THIS_MONDAY, 9]]);
  });

  it('treats a ledger row already stored for this week (e.g. carried over by the data migration) as done', async () => {
    // Pins the stored key format: a week_start written as TEXT 'YYYY-MM-DD'
    // must still match the lookup after the port, or the cutover week heals twice.
    freezeAt(WED_MID_WEEK);
    await seedUser({ id: 'a', score: 40 });
    await env.DB.prepare(
      "INSERT INTO weekly_heals (week_start, applied_at, affected) VALUES ('2026-10-26', '2026-10-25 16:00:05', 4)",
    ).run();

    const result = await weeklyHeal(env.DB, OFFSET_HOURS);

    expect(result).toEqual({ week_start: THIS_MONDAY, affected: 0, skipped: true });
    expect(await scoreOf('a')).toBe(40);
    expect(await scoreEventCount('a')).toBe(0);
    expect(await healLedger()).toEqual([
      { week_start: THIS_MONDAY, affected: 4, applied_at: '2026-10-25 16:00:05' },
    ]);
  });

  // weeklyHeal reads every participant's score, then writes an absolute
  // `SET score = ?` computed from that read in a later batch. GET /api/config
  // launches weeklyHeal and sweepDueCases concurrently (worker/routes.ts
  // waitUntil), so a verdict landing between the read and the batch is
  // overwritten: score 80, verdict -10 -> 70, heal then stores 95 (not 85), and
  // score_events shows -10 -> 70 followed by +15 -> 95, which no longer adds up.
  it.todo(
    'BUG: weeklyHeal lost update — a score change between its participant SELECT and its batch is overwritten (worker/db.ts:384-415); heal should be relative, e.g. SET score = MIN(100, score + 15)',
  );
});

describe('weeklyHeal — week key is the local Monday under the reset offset', () => {
  it('matches weekStartLocal for the offset it was given', async () => {
    freezeAt(WED_MID_WEEK);
    const result = await weeklyHeal(env.DB, OFFSET_HOURS);
    expect(result.week_start).toBe(weekStartLocal(OFFSET_HOURS));
    expect(result.week_start).toBe(THIS_MONDAY);
  });

  it('rolls over exactly at local Monday 00:00, not at UTC Monday', async () => {
    freezeAt(SUNDAY_LAST_MS_CST);
    await seedUser({ id: 'a', score: 10 });

    const sunday = await weeklyHeal(env.DB, 8);
    vi.setSystemTime(new Date(MONDAY_MIDNIGHT_CST));
    const monday = await weeklyHeal(env.DB, 8);

    expect(sunday).toEqual({ week_start: PREV_MONDAY, affected: 1, skipped: false });
    expect(monday).toEqual({ week_start: THIS_MONDAY, affected: 1, skipped: false });
    expect(await scoreOf('a')).toBe(40);
  });

  it('keys the same instant to a different week under a different offset', async () => {
    // Sunday 16:00 UTC is already Monday in UTC+8 but still Sunday in UTC.
    freezeAt(MONDAY_MIDNIGHT_CST);
    await seedUser({ id: 'a', score: 10 });

    const cst = await weeklyHeal(env.DB, 8);
    const utc = await weeklyHeal(env.DB, 0);

    expect(cst.week_start).toBe(THIS_MONDAY);
    expect(utc.week_start).toBe(PREV_MONDAY);
    // Distinct keys, so both count as fresh weeks — changing RESET_TZ_OFFSET
    // mid-week can heal twice.
    expect(utc.skipped).toBe(false);
    expect(await scoreOf('a')).toBe(40);
    expect((await healLedger()).map((r) => r.week_start)).toEqual([PREV_MONDAY, THIS_MONDAY]);
  });

  it('handles negative offsets (Monday 03:00 UTC is still Sunday in UTC-5)', async () => {
    freezeAt('2026-10-26T03:00:00.000Z');
    const result = await weeklyHeal(env.DB, -5);
    expect(result.week_start).toBe(PREV_MONDAY);
  });

  it('handles fractional offsets (UTC+5:30)', async () => {
    freezeAt('2026-10-25T18:30:00.000Z'); // Monday 00:00 in UTC+5:30
    expect((await weeklyHeal(env.DB, 5.5)).week_start).toBe(THIS_MONDAY);
  });

  it('keys a week that spans New Year by its Monday, in the old year', async () => {
    freezeAt('2027-01-01T12:00:00.000Z'); // Friday
    const result = await weeklyHeal(env.DB, 8);
    expect(result.week_start).toBe('2026-12-28');
    expect((await healLedger())[0].week_start).toBe('2026-12-28');
  });
});

describe('scheduled() — the cron entrypoint', () => {
  function cronEnv(overrides: Partial<Env> = {}): Env {
    return noAiEnv(overrides);
  }

  async function runCron(e: Env): Promise<void> {
    await worker.scheduled(
      createScheduledController({ scheduledTime: Date.now(), cron: '0 16 * * SUN' }),
      e,
      createExecutionContext(),
    );
  }

  it('runs the weekly heal with the default UTC+8 week key', async () => {
    freezeAt(MONDAY_MIDNIGHT_CST);
    await seedUser({ id: 'a', score: 50 });
    await seedUser({ id: 'out', participant: false, score: 50 });

    await runCron(cronEnv());

    expect(await scoreOf('a')).toBe(65);
    expect(await scoreOf('out')).toBe(50);
    expect(await healLedger()).toEqual([
      expect.objectContaining({ week_start: THIS_MONDAY, affected: 1 }),
    ]);
  });

  it('honours RESET_TZ_OFFSET and falls back to 8 for junk', async () => {
    freezeAt(MONDAY_MIDNIGHT_CST);

    await runCron(cronEnv({ RESET_TZ_OFFSET: '0' }));
    expect((await healLedger()).map((r) => r.week_start)).toEqual([PREV_MONDAY]);

    await runCron(cronEnv({ RESET_TZ_OFFSET: 'not-a-number' }));
    expect((await healLedger()).map((r) => r.week_start)).toEqual([PREV_MONDAY, THIS_MONDAY]);
  });

  it("treats a blank RESET_TZ_OFFSET as unset, not as 0 (Number('') === 0)", async () => {
    // docker-compose / Coolify pass a declared-but-empty variable as ''.
    freezeAt(MONDAY_MIDNIGHT_CST);
    await runCron(cronEnv({ RESET_TZ_OFFSET: '' }));
    await runCron(cronEnv({ RESET_TZ_OFFSET: '   ' }));
    expect((await healLedger()).map((r) => r.week_start)).toEqual([THIS_MONDAY]);
  });

  it('is idempotent across repeated cron firings in the same week', async () => {
    freezeAt(WED_MID_WEEK);
    await seedUser({ id: 'a', score: 50 });

    await runCron(cronEnv());
    await runCron(cronEnv());

    expect(await scoreOf('a')).toBe(65);
    expect(await scoreEventCount('a')).toBe(1);
    expect(await healLedger()).toHaveLength(1);
  });

  it('writes nothing in READ_ONLY maintenance mode', async () => {
    freezeAt(WED_MID_WEEK);
    await seedUser({ id: 'a', score: 50 });

    await runCron(cronEnv({ READ_ONLY: 'true' }));

    expect(await scoreOf('a')).toBe(50);
    expect(await scoreEventCount('a')).toBe(0);
    expect(await healLedger()).toHaveLength(0);
  });

  it('logs a failed heal and still runs the case sweep', async () => {
    // Real clock here: the case deadline is compared against JS time.
    const judge = await seedUser({ id: 'judge', judge: true });
    const subject = await seedUser({ id: 'subject', score: 100 });
    const filed = await fileCase(
      env.DB,
      judge,
      {
        subject_id: subject.id,
        type: 'no_show',
        claim: '说好八点五排，等到八点四十还没上线，微信也不回，最后四缺一散了。',
      },
      { offsetHours: OFFSET_HOURS },
      noAiEnv(),
    );
    await expireDeadline(filed.id);

    const realDb = env.DB;
    const failingHealDb = new Proxy(realDb, {
      get(target, prop) {
        if (prop === 'prepare') {
          return (sql: string) => {
            if (sql.includes('weekly_heals')) throw new Error('heal ledger unavailable');
            return target.prepare(sql);
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(runCron(cronEnv({ DB: failingHealDb }))).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith('weekly heal failed', expect.any(Error));
    expect(await healLedger()).toHaveLength(0);
    expect(await statusOf(filed.id)).toBe('decided');
  });
});
