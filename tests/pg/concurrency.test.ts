// Real concurrency on PostgreSQL — what D1's serialised execution could never
// produce: several transactions changing the same user at once, through the
// same adapter and pool the API uses. The invariant checked everywhere: each
// score_events row starts where the previous one for that user ended, and the
// user's score is where the last one ended. A lost update breaks the chain.

import { describe, expect, it } from 'vitest';
import { appealCase, judgeAndDecide, overrideCase, revokeCase, withdrawCase } from '../../worker/cases';
import { cancelSession, createSession, setRsvp } from '../../worker/sessions';
import { fileCase } from '../../worker/case-filing';
import { scoreMutation, weeklyHeal } from '../../worker/db';
import { WEEKLY_BONUS_CAP } from '../../shared/scoring';
import { seedUser } from '../worker/helpers';
import { env, pool } from './cloudflare-test';

const OFFSET_HOURS = 8;

/** Until `n` backends in this database are waiting on a lock (or 5 s pass). */
async function lockWaiters(n: number): Promise<void> {
  const until = Date.now() + 5_000;
  while (Date.now() < until) {
    const res = await pool.query(
      "SELECT COUNT(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
    );
    if (res.rows[0].n >= n) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`expected ${n} lock waiters`);
}

/**
 * Make an interleaving happen on purpose: hold a row lock, start each
 * contender in turn and wait until it is queued on that lock, then let go.
 * PostgreSQL hands the lock out in queue order, so the contenders run in the
 * order given — after every one of them has already read the old state.
 */
async function queuedBehind<T>(lockSql: string, params: unknown[], contenders: Array<() => Promise<T>>) {
  const holder = await pool.connect();
  try {
    await holder.query('BEGIN');
    await holder.query(lockSql, params);
    const started: Promise<T>[] = [];
    for (const run of contenders) {
      const p = run();
      p.catch(() => undefined);
      started.push(p);
      await lockWaiters(started.length);
    }
    await holder.query('COMMIT');
    return await Promise.allSettled(started);
  } finally {
    holder.release();
  }
}

const lockRecord = 'UPDATE records SET status = status WHERE id = $1';

interface Event {
  delta: number;
  resulting_score: number;
}

async function chainOf(userId: string, initial: number): Promise<{ events: Event[]; score: number }> {
  const { results } = await env.DB.prepare(
    'SELECT delta, resulting_score FROM score_events WHERE user_id = ? ORDER BY id',
  )
    .bind(userId)
    .all<Event>();
  const row = await env.DB.prepare('SELECT score FROM users WHERE id = ?').bind(userId).first<{ score: number }>();
  let at = initial;
  for (const e of results) {
    // Each change starts exactly where the previous one ended.
    expect(e.resulting_score - e.delta).toBe(at);
    at = e.resulting_score;
  }
  expect(row?.score).toBe(at);
  return { events: results, score: row?.score ?? NaN };
}

async function decidedCase(subject: string, reporter: string, delta: number, startScore: number): Promise<number> {
  const row = await env.DB.prepare(
    `INSERT INTO records (subject_id, reporter_id, type, delta, claim, status, verdict_source)
     VALUES (?, ?, 'no_show', ?, '说好八点开黑结果没来', 'decided', 'fallback')`,
  )
    .bind(subject, reporter, delta)
    .run();
  await env.DB.prepare('UPDATE users SET score = ? WHERE id = ?').bind(startScore, subject).run();
  return Number(row.meta.last_row_id);
}

describe('concurrent score changes on PostgreSQL', () => {
  it('applies 30 simultaneous changes to one user without losing any', async () => {
    await seedUser({ id: 'u', score: 50 });
    const deltas = Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? -4 : 3));
    await Promise.all(deltas.map((d, i) => env.DB.batch(scoreMutation(env.DB, 'u', d, `t:${i}`))));
    const { events, score } = await chainOf('u', 50);
    expect(events).toHaveLength(30);
    // No clamping happens in this range, so every delta lands in full.
    expect(score).toBe(50 + deltas.reduce((a, b) => a + b, 0));
  });

  it('keeps the chain consistent when clamping kicks in under contention', async () => {
    await seedUser({ id: 'u', score: 95 });
    await Promise.all(Array.from({ length: 20 }, (_, i) => env.DB.batch(scoreMutation(env.DB, 'u', 2, `t:${i}`))));
    const { score } = await chainOf('u', 95);
    expect(score).toBe(100);
  });

  it('heals the week exactly once however many heals race', async () => {
    for (const [id, score] of [['a', 40], ['b', 90], ['c', 100]] as const) await seedUser({ id, score });
    const results = await Promise.all(Array.from({ length: 6 }, () => weeklyHeal(env.DB, OFFSET_HOURS)));
    expect(results.filter((r) => !r.skipped)).toHaveLength(1);
    const ledger = await env.DB.prepare('SELECT affected, applied_at FROM weekly_heals').all<{ affected: number; applied_at: string }>();
    expect(ledger.results).toHaveLength(1);
    expect(ledger.results[0].affected).toBe(2);
    expect(ledger.results[0].applied_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect((await chainOf('a', 40)).score).toBe(55);
    expect((await chainOf('b', 90)).score).toBe(100);
    expect((await chainOf('c', 100)).events).toEqual([]);
  });

  it('keeps every verdict that lands while the week is being healed', async () => {
    await seedUser({ id: 'u', score: 60 });
    await Promise.all([
      weeklyHeal(env.DB, OFFSET_HOURS),
      ...Array.from({ length: 10 }, (_, i) => env.DB.batch(scoreMutation(env.DB, 'u', -3, `record:${i}`))),
    ]);
    const { events, score } = await chainOf('u', 60);
    expect(events).toHaveLength(11);
    expect(score).toBe(60 + 15 - 30);
  });

  it('lets only one of several simultaneous overrides of the same case apply', async () => {
    const admin = await seedUser({ id: 'admin', admin: true });
    await seedUser({ id: 'subject' });
    const id = await decidedCase('subject', 'admin', -15, 85);
    const settled = await Promise.allSettled(
      [-8, -10, -12, -20].map((d) => overrideCase(env.DB, admin, id, d, `改判为 ${d}`)),
    );
    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rec = await env.DB.prepare('SELECT delta FROM records WHERE id = ?').bind(id).first<{ delta: number }>();
    const { score } = await chainOf('subject', 85);
    // The record is worth exactly what the score moved by, relative to the case's start.
    expect(score).toBe(100 + (rec?.delta ?? NaN));
  });

  it('refunds a revoked case once, however many revokes race', async () => {
    const admin = await seedUser({ id: 'admin', admin: true });
    await seedUser({ id: 'subject' });
    // Starting at 60, so a second refund would show (85 + 15 would hide behind the 100 cap).
    const id = await decidedCase('subject', 'admin', -15, 60);
    const settled = await queuedBehind(lockRecord, [id], Array.from({ length: 4 }, () => () => revokeCase(env.DB, admin, id)));
    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const { score, events } = await chainOf('subject', 60);
    expect(score).toBe(75);
    expect(events).toHaveLength(1);
  });

  it('a revoke and an appeal of the same case: exactly one of them happens, wholly', async () => {
    const admin = await seedUser({ id: 'admin', admin: true });
    const subject = await seedUser({ id: 'subject' });
    const id = await decidedCase('subject', 'admin', -15, 60);
    // The appeal gets the case first; the revoke, having read 'decided', comes second.
    const [appeal, revoke] = await queuedBehind(lockRecord, [id], [
      () => appealCase(env.DB, subject, id, '我那天在医院'),
      () => revokeCase(env.DB, admin, id),
    ]);
    expect(appeal.status).toBe('fulfilled');
    expect(revoke).toMatchObject({ status: 'rejected', reason: { status: 409 } });
    // No refund without the revoke: the score and its events agree, at 60.
    const { score, events } = await chainOf('subject', 60);
    expect(events).toEqual([]);
    expect(score).toBe(60);
    const rec = await env.DB.prepare('SELECT status FROM records WHERE id = ?').bind(id).first<{ status: string }>();
    expect(rec?.status).toBe('appealed');
  });

  it('a revoke that read the case before an override refunds nothing, not the old amount', async () => {
    const admin = await seedUser({ id: 'admin', admin: true });
    await seedUser({ id: 'subject' });
    const id = await decidedCase('subject', 'admin', -15, 60);
    const [override, revoke] = await queuedBehind(lockRecord, [id], [
      () => overrideCase(env.DB, admin, id, -8, '情有可原'),
      () => revokeCase(env.DB, admin, id),
    ]);
    expect(override.status).toBe('fulfilled');
    expect(revoke).toMatchObject({ status: 'rejected', reason: { status: 409 } });
    expect((await chainOf('subject', 60)).score).toBe(67);
    const rec = await env.DB.prepare('SELECT status, delta FROM records WHERE id = ?').bind(id).first();
    expect(rec).toEqual({ status: 'decided', delta: -8 });
  });

  it('applies simultaneous bonuses filed for the same player without losing any', async () => {
    const judge = await seedUser({ id: 'judge', judge: true });
    await seedUser({ id: 'p', score: 50 });
    await Promise.all(
      Array.from({ length: 3 }, () =>
        fileCase(env.DB, judge, { subject_id: 'p', type: 'on_time_bonus' }, { offsetHours: OFFSET_HOURS, skipRateLimit: true }, env as never),
      ),
    );
    const { score, events } = await chainOf('p', 50);
    expect(events).toHaveLength(3);
    expect(score).toBe(56);
    const recs = await env.DB.prepare("SELECT delta FROM records WHERE subject_id = 'p'").all<{ delta: number }>();
    expect(recs.results.map((r) => r.delta)).toEqual([2, 2, 2]);
  });

  it('gives the last seat to exactly one of several players racing for it', async () => {
    const organizer = await seedUser({ id: 'org' });
    const players = await Promise.all(['p1', 'p2', 'p3', 'p4'].map((id) => seedUser({ id })));
    const session = await createSession(
      env.DB,
      organizer,
      { starts_at: new Date(Date.now() + 3_600_000).toISOString(), capacity: 2 },
      OFFSET_HOURS,
    );
    // The organizer holds one seat; one is left. All four read "1 going" first.
    const settled = await queuedBehind(
      'UPDATE game_sessions SET status = status WHERE id = $1',
      [session.id],
      players.map((p) => () => setRsvp(env.DB, p, session.id, 'going')),
    );
    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const going = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM session_players WHERE session_id = ? AND rsvp = 'going'",
    )
      .bind(session.id)
      .first<{ n: number }>();
    expect(going?.n).toBe(2);
  });

  it('withdraws a case once — a duplicate concurrent withdraw gets 409', async () => {
    const judge = await seedUser({ id: 'judge', judge: true });
    await seedUser({ id: 'p' });
    const rec = await fileCase(
      env.DB,
      judge,
      { subject_id: 'p', type: 'no_show', claim: '说好八点开黑结果没来也没说' },
      { offsetHours: OFFSET_HOURS, skipRateLimit: true },
      env as never,
    );
    // Both read 'awaiting_statement' before either writes.
    const settled = await queuedBehind(lockRecord, [rec.id], [
      () => withdrawCase(env.DB, judge, rec.id),
      () => withdrawCase(env.DB, judge, rec.id),
    ]);
    expect(settled[0].status).toBe('fulfilled');
    expect(settled[1]).toMatchObject({ status: 'rejected', reason: { status: 409 } });
  });

  it('holds the weekly bonus cap when bonuses for one player are filed at once', async () => {
    const judge = await seedUser({ id: 'judge', judge: true });
    await seedUser({ id: 'p', score: 50 });
    const settled = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        fileCase(env.DB, judge, { subject_id: 'p', type: 'on_time_bonus' }, { offsetHours: OFFSET_HOURS, skipRateLimit: true }, env as never),
      ),
    );
    const won = settled.filter((r) => r.status === 'fulfilled').length;
    const { score } = await chainOf('p', 50);
    expect(score - 50).toBeLessThanOrEqual(WEEKLY_BONUS_CAP);
    expect(score - 50).toBe(won * 2);
    // A lost race leaves no half-made record behind.
    const recs = await env.DB.prepare("SELECT COUNT(*) AS n FROM records WHERE subject_id = 'p'").first<{ n: number }>();
    expect(recs?.n).toBe(won);
  });

  it('two judges racing for one case: one verdict, one score change, one audit row', async () => {
    await seedUser({ id: 'judge', judge: true });
    await seedUser({ id: 'subject', score: 80 });
    const row = await env.DB.prepare(
      `INSERT INTO records (subject_id, reporter_id, type, claim, status, judging_started_at)
       VALUES ('subject', 'judge', 'no_show', '说好八点开黑结果没来', 'judging', datetime('now'))`,
    ).run();
    const id = Number(row.meta.last_row_id);
    const noAi = { ...env, AI_ENABLED: 'false' } as never;
    const settled = await queuedBehind(lockRecord, [id], [() => judgeAndDecide(env.DB, noAi, id), () => judgeAndDecide(env.DB, noAi, id)]);
    expect(settled.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    const { events } = await chainOf('subject', 80);
    expect(events).toHaveLength(1);
    const audits = await env.DB.prepare("SELECT COUNT(*) AS n FROM ai_verdicts WHERE record_id = ? AND kind = 'sentence'")
      .bind(id)
      .first<{ n: number }>();
    expect(audits?.n).toBe(1);
  });

  it('an RSVP that read the session before it was cancelled is refused, not written', async () => {
    const organizer = await seedUser({ id: 'org' });
    const player = await seedUser({ id: 'p1' });
    const session = await createSession(
      env.DB,
      organizer,
      { starts_at: new Date(Date.now() + 3_600_000).toISOString() },
      OFFSET_HOURS,
    );
    const [cancel, rsvp] = await queuedBehind('UPDATE game_sessions SET status = status WHERE id = $1', [session.id], [
      () => cancelSession(env.DB, organizer, session.id),
      () => setRsvp(env.DB, player, session.id, 'going'),
    ]);
    expect(cancel.status).toBe('fulfilled');
    expect(rsvp).toMatchObject({ status: 'rejected', reason: { status: 400 } });
    const row = await env.DB.prepare("SELECT rsvp FROM session_players WHERE session_id = ? AND user_id = 'p1'")
      .bind(session.id)
      .first();
    expect(row).toBeNull();
  });
});
