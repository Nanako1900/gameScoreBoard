// Pins the CURRENT behaviour of the admin user editor (POST /api/admin/users/:id
// → adminUpdateUser) on D1, so the PostgreSQL port has to reproduce it: role
// flags read back as real booleans, `score` is an absolute value clamped and
// rounded into 0..100 with an `admin_adjust` audit row carrying the delta that
// actually landed, and `delete` wipes the user plus everything hanging off them.

import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { describe, expect, it } from 'vitest';
import {
  adminUpdateUser,
  getLeaderboard,
  getUserById,
  getUserProfile,
  toUser,
} from '../../worker/db';
import { ApiError } from '../../worker/errors';
import { registerAdminRoutes } from '../../worker/routes-admin';
import type { AppEnv, User, UserRow } from '../../worker/types';
import { scoreEventCount, scoreOf, seedUser } from './helpers';

const SQLITE_DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const LONG_AGO = '2000-01-01 00:00:00';
const CLAIM = '说好八点五排，等到八点四十还没上线，微信也不回，最后四缺一散了。';

// --- local fixtures ------------------------------------------------------------

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

async function count(sql: string, ...binds: unknown[]): Promise<number> {
  const row = await env.DB.prepare(sql).bind(...binds).first<{ n: number }>();
  return row?.n ?? -1;
}

async function rowOf(id: string): Promise<UserRow> {
  const row = await getUserById(env.DB, id);
  if (!row) throw new Error(`fixture user ${id} vanished`);
  return row;
}

async function userOf(id: string): Promise<User> {
  return toUser(await rowOf(id));
}

async function backdate(id: string): Promise<void> {
  await env.DB.prepare('UPDATE users SET updated_at = ? WHERE id = ?').bind(LONG_AGO, id).run();
}

async function insertRecord(
  subjectId: string,
  reporterId: string,
): Promise<number> {
  const res = await env.DB.prepare(
    `INSERT INTO records (subject_id, reporter_id, type, claim, status)
     VALUES (?, ?, 'no_show', ?, 'awaiting_statement')`,
  )
    .bind(subjectId, reporterId, CLAIM)
    .run();
  return Number(res.meta.last_row_id);
}

async function insertVerdict(recordId: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO ai_verdicts (record_id, kind, provider, model, prompt_version, applied_delta)
     VALUES (?, 'sentence', 'example.test', 'test-model', 'v1', -5)`,
  )
    .bind(recordId)
    .run();
}

async function insertEvent(userId: string, delta: number, reason: string, resulting: number): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO score_events (user_id, delta, reason, resulting_score) VALUES (?, ?, ?, ?)',
  )
    .bind(userId, delta, reason, resulting)
    .run();
}

// --- lookup and no-op patches ----------------------------------------------------

describe('adminUpdateUser — lookup and empty patches', () => {
  it('rejects an unknown id with 404 用户不存在', async () => {
    const attempt = adminUpdateUser(env.DB, 'ghost', { is_judge: true });
    await expect(attempt).rejects.toBeInstanceOf(ApiError);
    await expect(adminUpdateUser(env.DB, 'ghost', { score: 50 })).rejects.toMatchObject({
      status: 404,
      message: '用户不存在',
    });
    // Not an upsert: a port using INSERT … ON CONFLICT must not conjure the user.
    expect(await getUserById(env.DB, 'ghost')).toBeNull();
    expect(await count('SELECT COUNT(*) AS n FROM users')).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM score_events')).toBe(0);
  });

  it('checks existence before the empty-patch short-circuit: {} on an unknown id is still 404', async () => {
    await expect(adminUpdateUser(env.DB, 'ghost', {})).rejects.toMatchObject({
      status: 404,
      message: '用户不存在',
    });
    await expect(adminUpdateUser(env.DB, 'ghost', { delete: false })).rejects.toMatchObject({
      status: 404,
    });
  });

  it('rejects deleting an unknown id with the same 404, touching nobody', async () => {
    const bystander = await seedUser({ id: 'bystander' });
    await insertEvent(bystander.id, -5, 'weekly_heal', 95);

    await expect(adminUpdateUser(env.DB, 'ghost', { delete: true })).rejects.toMatchObject({
      status: 404,
      message: '用户不存在',
    });
    expect(await count('SELECT COUNT(*) AS n FROM users')).toBe(1);
    expect(await scoreEventCount(bystander.id)).toBe(1);
  });

  it('treats an empty patch as a no-op: resolves undefined and leaves the row byte-identical', async () => {
    await seedUser({ id: 'u', judge: true, score: 64 });
    await backdate('u');
    const before = await rowOf('u');

    await expect(adminUpdateUser(env.DB, 'u', {})).resolves.toBeUndefined();

    expect(await rowOf('u')).toEqual(before);
    expect(before.updated_at).toBe(LONG_AGO);
    expect(await scoreEventCount('u')).toBe(0);
  });

  it('treats delete:false with every other field undefined as a no-op too', async () => {
    await seedUser({ id: 'u', score: 77 });
    await backdate('u');
    const before = await rowOf('u');

    await adminUpdateUser(env.DB, 'u', {
      delete: false,
      is_participant: undefined,
      is_judge: undefined,
      is_admin: undefined,
      score: undefined,
    });

    expect(await rowOf('u')).toEqual(before);
    expect(await scoreEventCount('u')).toBe(0);
  });
});

// --- roles -----------------------------------------------------------------------

describe('adminUpdateUser — roles', () => {
  it('grants a single role without touching the others or the score', async () => {
    await seedUser({ id: 'u', score: 81 });

    await adminUpdateUser(env.DB, 'u', { is_judge: true });

    const user = await userOf('u');
    expect(user.is_judge).toBe(true);
    expect(user.is_participant).toBe(true);
    expect(user.is_admin).toBe(false);
    expect(user.score).toBe(81);
    expect(await scoreEventCount('u')).toBe(0);
  });

  it('revokes roles, reading back as strict false', async () => {
    await seedUser({ id: 'u', judge: true, admin: true, score: 55 });

    await adminUpdateUser(env.DB, 'u', { is_admin: false, is_participant: false });

    const user = await userOf('u');
    expect(user.is_admin).toBe(false);
    expect(user.is_participant).toBe(false);
    expect(user.is_judge).toBe(true);
    // Leaving the board keeps the score; it is not reset or zeroed.
    expect(user.score).toBe(55);
    expect(await scoreEventCount('u')).toBe(0);
  });

  it('sets all three flags in one call', async () => {
    await seedUser({ id: 'u', participant: false });

    await adminUpdateUser(env.DB, 'u', { is_participant: true, is_judge: true, is_admin: true });

    const user = await userOf('u');
    expect([user.is_participant, user.is_judge, user.is_admin]).toEqual([true, true, true]);
  });

  it('accepts setting a flag to the value it already has, and still stamps updated_at', async () => {
    await seedUser({ id: 'u', judge: true, score: 66 });
    await backdate('u');
    const before = await rowOf('u');

    // Resolves undefined (not the updated user), twice in a row.
    await expect(adminUpdateUser(env.DB, 'u', { is_judge: true })).resolves.toBeUndefined();
    await expect(adminUpdateUser(env.DB, 'u', { is_judge: true })).resolves.toBeUndefined();

    // No "only write what changed" optimisation: a provided field always counts
    // as a write, so updated_at moves even though is_judge was already 1.
    const after = await rowOf('u');
    expect(after.updated_at).toMatch(SQLITE_DATETIME);
    expect(after.updated_at).not.toBe(LONG_AGO);
    expect(after).toEqual({ ...before, updated_at: after.updated_at });
    expect((await userOf('u')).is_judge).toBe(true);
    expect(await scoreEventCount('u')).toBe(0);
  });

  it('stamps updated_at with the current UTC time in SQLite datetime format, and nothing else', async () => {
    await seedUser({ id: 'u', judge: true });
    await env.DB.prepare(
      "UPDATE users SET display_name = '小七', avatar_url = 'https://img.example/u.png', email = 'u@example.test' WHERE id = 'u'",
    ).run();
    await backdate('u');
    const before = await rowOf('u');

    await adminUpdateUser(env.DB, 'u', { is_judge: false });

    const after = await rowOf('u');
    expect(after.updated_at).toMatch(SQLITE_DATETIME);
    expect(after.updated_at).not.toBe(LONG_AGO);
    // datetime('now') is UTC: parsing it as UTC must land within a minute of now.
    const stampedAt = Date.parse(`${after.updated_at.replace(' ', 'T')}Z`);
    expect(Math.abs(stampedAt - Date.now())).toBeLessThan(60_000);
    expect(after).toEqual({ ...before, is_judge: 0, updated_at: after.updated_at });
  });

  it('drops a user off the leaderboard and puts them back with their old score', async () => {
    await seedUser({ id: 'a', score: 90 });
    await seedUser({ id: 'b', score: 40 });

    await adminUpdateUser(env.DB, 'a', { is_participant: false });
    expect((await getLeaderboard(env.DB)).map((u) => u.id)).toEqual(['b']);

    await adminUpdateUser(env.DB, 'a', { is_participant: true });
    const board = await getLeaderboard(env.DB);
    expect(board.map((u) => [u.id, u.score, u.is_participant])).toEqual([
      ['a', 90, true],
      ['b', 40, true],
    ]);
  });
});

// --- score -----------------------------------------------------------------------

describe('adminUpdateUser — score', () => {
  it('sets an absolute score and logs one admin_adjust event with the applied delta', async () => {
    await seedUser({ id: 'u', judge: true, score: 72 });
    await backdate('u');
    const before = await rowOf('u');

    await expect(adminUpdateUser(env.DB, 'u', { score: 85 })).resolves.toBeUndefined();

    expect(await scoreOf('u')).toBe(85);
    // A score-only patch touches score + updated_at and nothing else (roles intact).
    const after = await rowOf('u');
    expect(after.updated_at).toMatch(SQLITE_DATETIME);
    expect(after.updated_at).not.toBe(LONG_AGO);
    expect(after).toEqual({ ...before, score: 85, updated_at: after.updated_at });

    const events = await eventsOf('u');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      user_id: 'u',
      delta: 13,
      reason: 'admin_adjust',
      resulting_score: 85,
    });
    expect(typeof events[0].delta).toBe('number');
    expect(typeof events[0].resulting_score).toBe('number');
    expect(events[0].created_at).toMatch(SQLITE_DATETIME);
    // Same UTC basis as updated_at (a timestamptz port must not shift or reformat it).
    const loggedAt = Date.parse(`${events[0].created_at.replace(' ', 'T')}Z`);
    expect(Math.abs(loggedAt - Date.now())).toBeLessThan(60_000);
  });

  it('is a target value, not a delta: lowering 90 → 40 logs −50', async () => {
    await seedUser({ id: 'u', score: 90 });
    await adminUpdateUser(env.DB, 'u', { score: 40 });
    expect(await scoreOf('u')).toBe(40);
    expect(await eventsOf('u')).toMatchObject([{ delta: -50, resulting_score: 40 }]);
  });

  it('clamps above 100 and logs only the delta that actually landed', async () => {
    await seedUser({ id: 'u', score: 70 });
    await adminUpdateUser(env.DB, 'u', { score: 150 });
    expect(await scoreOf('u')).toBe(100);
    expect(await eventsOf('u')).toMatchObject([
      { delta: 30, reason: 'admin_adjust', resulting_score: 100 },
    ]);
  });

  it('clamps below 0 and logs only the delta that actually landed', async () => {
    await seedUser({ id: 'u', score: 30 });
    await adminUpdateUser(env.DB, 'u', { score: -20 });
    expect(await scoreOf('u')).toBe(0);
    expect(await eventsOf('u')).toMatchObject([
      { delta: -30, reason: 'admin_adjust', resulting_score: 0 },
    ]);
  });

  it('rounds fractional input to an integer (Math.round) before storing', async () => {
    await seedUser({ id: 'up', score: 50 });
    await seedUser({ id: 'down', score: 50 });
    await seedUser({ id: 'neg', score: 50 });

    await adminUpdateUser(env.DB, 'up', { score: 62.5 });
    await adminUpdateUser(env.DB, 'down', { score: 62.4 });
    await adminUpdateUser(env.DB, 'neg', { score: -0.4 });

    expect(await scoreOf('up')).toBe(63);
    expect(await scoreOf('down')).toBe(62);
    expect(await scoreOf('neg')).toBe(0);
    expect(await eventsOf('up')).toMatchObject([{ delta: 13, resulting_score: 63 }]);
    expect(await eventsOf('down')).toMatchObject([{ delta: 12, resulting_score: 62 }]);
    expect(await eventsOf('neg')).toMatchObject([{ delta: -50, resulting_score: 0 }]);
    // Stored as an integer, not a REAL.
    const type = await env.DB.prepare("SELECT typeof(score) AS t FROM users WHERE id = 'up'")
      .first<{ t: string }>();
    expect(type?.t).toBe('integer');
  });

  it('still logs a zero-delta event when the target equals (or clamps to) the current score', async () => {
    await seedUser({ id: 'u', score: 100 });

    await adminUpdateUser(env.DB, 'u', { score: 100 });
    await adminUpdateUser(env.DB, 'u', { score: 250 });

    expect(await scoreOf('u')).toBe(100);
    expect(await eventsOf('u')).toMatchObject([
      { delta: 0, reason: 'admin_adjust', resulting_score: 100 },
      { delta: 0, reason: 'admin_adjust', resulting_score: 100 },
    ]);
  });

  it('adjusts a non-participant too, without putting them on the board', async () => {
    await seedUser({ id: 'guest', participant: false, score: 100 });

    await adminUpdateUser(env.DB, 'guest', { score: 20 });

    expect(await scoreOf('guest')).toBe(20);
    expect(await eventsOf('guest')).toMatchObject([{ delta: -80, resulting_score: 20 }]);
    expect(await getLeaderboard(env.DB)).toEqual([]);
  });

  it('logs one event per adjustment, each delta relative to the score at that moment', async () => {
    await seedUser({ id: 'u', score: 100 });

    await adminUpdateUser(env.DB, 'u', { score: 60 });
    await adminUpdateUser(env.DB, 'u', { score: 75 });
    await adminUpdateUser(env.DB, 'u', { score: 75 });
    await adminUpdateUser(env.DB, 'u', { score: 10 });

    const events = await eventsOf('u');
    expect(events.map((e) => [e.delta, e.resulting_score])).toEqual([
      [-40, 60],
      [15, 75],
      [0, 75],
      [-65, 10],
    ]);
    expect(events.reduce((sum, e) => sum + e.delta, 0)).toBe(10 - 100);
    expect(events.every((e) => e.reason === 'admin_adjust')).toBe(true);
  });

  it('applies roles and score together in one call, with a single event', async () => {
    await seedUser({ id: 'u', score: 88 });
    await backdate('u');

    await adminUpdateUser(env.DB, 'u', { is_judge: true, is_admin: true, score: 33 });

    const user = await userOf('u');
    expect(user).toMatchObject({ is_judge: true, is_admin: true, is_participant: true, score: 33 });
    expect((await rowOf('u')).updated_at).not.toBe(LONG_AGO);
    expect(await eventsOf('u')).toMatchObject([{ delta: -55, resulting_score: 33 }]);
  });

  it('shows up as the last point of the profile history', async () => {
    await seedUser({ id: 'u', score: 100 });
    await adminUpdateUser(env.DB, 'u', { score: 47 });

    const profile = await getUserProfile(env.DB, 'u');
    expect(profile.user.score).toBe(47);
    expect(profile.history.map((p) => p.score)).toEqual([100, 47]);
    expect(profile.history[1].at).toMatch(SQLITE_DATETIME);
  });
});

// --- delete ----------------------------------------------------------------------

describe('adminUpdateUser — delete', () => {
  /**
   * `victim` is wired into case tables: subject and reporter of cases (with AI
   * audit rows) and score history. `a` and `b` have their own, unrelated
   * data that must survive.
   */
  async function wiredVictim() {
    await seedUser({ id: 'victim', judge: true, score: 70 });
    await seedUser({ id: 'a', judge: true, score: 90 });
    await seedUser({ id: 'b', score: 80 });

    const againstVictim = await insertRecord('victim', 'a');
    const byVictim = await insertRecord('b', 'victim');
    const unrelated = await insertRecord('b', 'a');
    await insertVerdict(againstVictim);
    await insertVerdict(byVictim);
    await insertVerdict(unrelated);

    await insertEvent('victim', -30, `record:${againstVictim}`, 70);
    await insertEvent('victim', 0, 'admin_adjust', 70);
    await insertEvent('a', -10, 'admin_adjust', 90);
    await insertEvent('b', -20, `record:${unrelated}`, 80);

    return { againstVictim, byVictim, unrelated };
  }

  it('removes the user and every row that references them', async () => {
    const ids = await wiredVictim();

    // D1 enforces FOREIGN KEYs, so this only succeeds because the batch deletes
    // children (events, verdicts, records) before the user row.
    await expect(adminUpdateUser(env.DB, 'victim', { delete: true })).resolves.toBeUndefined();

    expect(await getUserById(env.DB, 'victim')).toBeNull();
    expect(await scoreEventCount('victim')).toBe(0);
    expect(
      await count(
        'SELECT COUNT(*) AS n FROM records WHERE subject_id = ? OR reporter_id = ?',
        'victim',
        'victim',
      ),
    ).toBe(0);
    expect(
      await count(
        'SELECT COUNT(*) AS n FROM ai_verdicts WHERE record_id IN (?, ?)',
        ids.againstVictim,
        ids.byVictim,
      ),
    ).toBe(0);
  });

  // Only rows that never reference the victim are pinned here. The case the
  // victim filed against `b` is deleted (FK on reporter_id), but `b` has no score
  // event for it in this fixture, so the leftover-score problem in the first
  // it.todo below is deliberately NOT pinned as correct.
  it('leaves rows that do not reference the user exactly as they were', async () => {
    const ids = await wiredVictim();

    await adminUpdateUser(env.DB, 'victim', { delete: true });

    expect(await scoreOf('a')).toBe(90);
    expect(await scoreOf('b')).toBe(80);
    expect((await eventsOf('a')).map((e) => [e.delta, e.reason])).toEqual([[-10, 'admin_adjust']]);
    expect((await eventsOf('b')).map((e) => [e.delta, e.reason])).toEqual([
      [-20, `record:${ids.unrelated}`],
    ]);
    // The case between two other people, and its AI audit row, survive.
    const left = await env.DB.prepare('SELECT id FROM records ORDER BY id').all<{ id: number }>();
    expect(left.results.map((r) => r.id)).toEqual([ids.unrelated]);
    expect(
      await count('SELECT COUNT(*) AS n FROM ai_verdicts WHERE record_id = ?', ids.unrelated),
    ).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM users')).toBe(2);
  });

  it('wins over every other field in the same patch', async () => {
    await seedUser({ id: 'u', score: 50 });

    await adminUpdateUser(env.DB, 'u', { delete: true, score: 0, is_admin: true, is_judge: true });

    expect(await getUserById(env.DB, 'u')).toBeNull();
    expect(await count('SELECT COUNT(*) AS n FROM score_events')).toBe(0);
  });

  it('is not idempotent: deleting again is a 404', async () => {
    await seedUser({ id: 'u' });
    await adminUpdateUser(env.DB, 'u', { delete: true });
    await expect(adminUpdateUser(env.DB, 'u', { delete: true })).rejects.toMatchObject({
      status: 404,
      message: '用户不存在',
    });
  });

  it('makes the user disappear from the leaderboard and their profile 404', async () => {
    await seedUser({ id: 'u', score: 99 });
    await seedUser({ id: 'keep', score: 10 });

    await adminUpdateUser(env.DB, 'u', { delete: true });

    expect((await getLeaderboard(env.DB)).map((u) => u.id)).toEqual(['keep']);
    await expect(getUserProfile(env.DB, 'u')).rejects.toMatchObject({ status: 404 });
  });

  it('only deletes on delete:true — delete:false applies the rest of the patch', async () => {
    await seedUser({ id: 'u', score: 50 });

    await adminUpdateUser(env.DB, 'u', { delete: false, is_judge: true, score: 60 });

    expect(await userOf('u')).toMatchObject({ is_judge: true, score: 60 });
    expect(await eventsOf('u')).toMatchObject([{ delta: 10, reason: 'admin_adjust' }]);
  });

  it.todo(
    'BUG: deleting a judge deletes the cases they filed against others (worker/db.ts:309) but ' +
      'keeps those players’ score changes and their `record:<id>` score_events, so a victim’s ' +
      'score/history no longer matches any visible record and the events point at a missing record',
  );
});

// --- the HTTP route that calls it ------------------------------------------------

/** The real admin routes behind a stub auth layer, with index.ts's ApiError mapping. */
function adminApp(caller: User | null): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('user', caller);
    await next();
  });
  registerAdminRoutes(app);
  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json({ error: err.message }, err.status as ContentfulStatusCode);
    }
    throw err;
  });
  return app;
}

async function postUser(caller: User | null, id: string, body: unknown): Promise<Response> {
  return adminApp(caller).request(
    `/api/admin/users/${id}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    env,
  );
}

describe('POST /api/admin/users/:id', () => {
  it('refuses anonymous (401) and non-admin (403) callers before touching the user', async () => {
    const judge = await seedUser({ id: 'judge', judge: true });
    await seedUser({ id: 'u', score: 50 });

    const anon = await postUser(null, 'u', { score: 0, is_admin: true });
    expect(anon.status).toBe(401);
    expect(await anon.json()).toEqual({ error: '未登录' });

    const nonAdmin = await postUser(judge, 'u', { delete: true });
    expect(nonAdmin.status).toBe(403);
    expect(await nonAdmin.json()).toEqual({ error: '需要管理员权限' });

    expect(await userOf('u')).toMatchObject({ score: 50, is_admin: false });
    expect(await scoreEventCount('u')).toBe(0);
  });

  it('applies a well-typed patch and answers { ok: true }', async () => {
    const admin = await seedUser({ id: 'admin', admin: true });
    await seedUser({ id: 'u', score: 50 });

    const res = await postUser(admin, 'u', { is_judge: true, is_participant: false, score: 42.6 });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await userOf('u')).toMatchObject({ is_judge: true, is_participant: false, score: 43 });
    expect(await eventsOf('u')).toMatchObject([{ delta: -7, reason: 'admin_adjust', resulting_score: 43 }]);
  });

  it('deletes through the route, then 404s with { error } on a second try', async () => {
    const admin = await seedUser({ id: 'admin', admin: true });
    await seedUser({ id: 'u' });

    const first = await postUser(admin, 'u', { delete: true });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true });
    expect(await getUserById(env.DB, 'u')).toBeNull();

    const second = await postUser(admin, 'u', { delete: true });
    expect(second.status).toBe(404);
    expect(await second.json()).toEqual({ error: '用户不存在' });
  });

  it('matches :id as an exact, decoded TEXT key (long numeric and percent-encoded subject ids)', async () => {
    const admin = await seedUser({ id: 'admin', admin: true });
    // Past Number.MAX_SAFE_INTEGER: any Number()/BIGINT coercion would miss the row.
    const numericId = '1100000000000000001';
    const pipedId = 'oauth|42';
    await seedUser({ id: numericId, score: 50 });
    await seedUser({ id: '1100000000000000000', score: 50 });
    await seedUser({ id: pipedId, score: 50 });

    const numeric = await postUser(admin, numericId, { score: 20 });
    expect(numeric.status).toBe(200);
    const piped = await postUser(admin, encodeURIComponent(pipedId), { is_judge: true });
    expect(piped.status).toBe(200);

    expect(await scoreOf(numericId)).toBe(20);
    expect(await scoreOf('1100000000000000000')).toBe(50);
    expect(await eventsOf(numericId)).toMatchObject([
      { user_id: numericId, delta: -30, reason: 'admin_adjust', resulting_score: 20 },
    ]);
    expect(await scoreEventCount('1100000000000000000')).toBe(0);
    expect((await userOf(pipedId)).is_judge).toBe(true);
  });

  it('lets an admin demote themselves (no self-protection in this endpoint)', async () => {
    const admin = await seedUser({ id: 'admin', admin: true });
    const res = await postUser(admin, 'admin', { is_admin: false });
    expect(res.status).toBe(200);
    expect((await userOf('admin')).is_admin).toBe(false);
  });

  it.todo(
    'BUG: wrongly-typed fields are silently dropped (worker/routes-admin.ts:50-56, optBool/optNumber) — ' +
      '{ score: "50" }, { delete: "true" } or a non-JSON body answer 200 { ok: true } and change ' +
      'nothing, where POST /api/admin/ai-config rejects a non-boolean `enabled` with 400',
  );
});
