// Pins the CURRENT observable behaviour of updateSession (PATCH /api/sessions/:id)
// and of the app_settings round trip behind the admin AI panel, so the planned
// D1 → PostgreSQL port cannot silently change it: who may edit, which fields move,
// validation messages, status refusals, what happens to the roster, and how
// writeSetting / readSettings / loadAiConfig store and resolve values.

import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { SESSION_GAME_MAX, SESSION_NOTE_MAX, SESSION_TITLE_MAX } from '../../shared/attendance';
import {
  AI_SETTING_KEYS,
  DEFAULT_TEMPERATURE,
  loadAiConfig,
  readSettings,
  shortHash,
  writeSetting,
  type AiEnvSlice,
} from '../../worker/ai/config';
import { DEFAULT_CLASSIFY_PROMPT } from '../../worker/ai/classify';
import { DEFAULT_SYSTEM_PROMPT } from '../../worker/ai/prompt';
import { DEFAULT_REPORT_PROMPT } from '../../worker/ai/report';
import { ApiError } from '../../worker/errors';
import {
  cancelSession,
  createSession,
  listMyInvites,
  listSessions,
  rollCall,
  setRsvp,
  settleSession,
  updateSession,
  type CreateSessionInput,
} from '../../worker/sessions';
import { parseSqlUtc } from '../../worker/time';
import type { SessionDetail, User } from '../../worker/types';
import { OFFSET_HOURS, noAiEnv, scoreEventCount, scoreOf, seedUser } from './helpers';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Whole-minute instant `hours` from now, so ISO round-trips are exact. */
function minuteFromNow(hours: number): number {
  return Math.floor((Date.now() + hours * HOUR_MS) / 60_000) * 60_000;
}

const FUTURE = new Date(minuteFromNow(3)).toISOString();
const PAST = new Date(minuteFromNow(-3)).toISOString();

const NOT_ORGANIZER = '只有组织者可以操作这个约局';
const NOT_EDITABLE = '已取消 / 已结算的约局不能再修改';

interface GameSessionRow {
  id: number;
  organizer_id: string;
  title: string;
  game: string | null;
  starts_at: string;
  duration_min: number | null;
  capacity: number | null;
  note: string | null;
  status: string;
  settled_at: string | null;
  settled_by: string | null;
  created_at: string;
}

interface PlayerRow {
  user_id: string;
  rsvp: string;
  rsvp_at: string;
  attendance: string | null;
  late_minutes: number | null;
  attendance_note: string | null;
  record_id: number | null;
}

async function cast(): Promise<{ organizer: User; a: User; b: User; c: User; d: User }> {
  return {
    organizer: await seedUser({ id: 'org' }),
    a: await seedUser({ id: 'a' }),
    b: await seedUser({ id: 'b' }),
    c: await seedUser({ id: 'c' }),
    d: await seedUser({ id: 'd' }),
  };
}

async function openSession(
  organizer: User,
  extra: Partial<CreateSessionInput> = {},
): Promise<SessionDetail> {
  return createSession(
    env.DB,
    organizer,
    { title: '周五五排', starts_at: FUTURE, ...extra },
    OFFSET_HOURS,
  );
}

async function sessionRow(id: number): Promise<GameSessionRow | null> {
  return env.DB.prepare('SELECT * FROM game_sessions WHERE id = ?')
    .bind(id)
    .first<GameSessionRow>();
}

async function playerRows(sessionId: number): Promise<PlayerRow[]> {
  const rows = await env.DB.prepare(
    `SELECT user_id, rsvp, rsvp_at, attendance, late_minutes, attendance_note, record_id
       FROM session_players WHERE session_id = ? ORDER BY user_id`,
  )
    .bind(sessionId)
    .all<PlayerRow>();
  return rows.results;
}

async function tableCount(table: 'records' | 'score_events' | 'session_players'): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? -1;
}

// ---------------------------------------------------------------------------
// updateSession
// ---------------------------------------------------------------------------

describe('updateSession — who may edit', () => {
  it('lets the organizer edit and returns the refreshed detail from their point of view', async () => {
    const { organizer } = await cast();
    const session = await openSession(organizer);

    const out = await updateSession(env.DB, organizer, session.id, { title: '改成周六' });

    expect(out.id).toBe(session.id);
    expect(out.title).toBe('改成周六');
    expect(out.my_rsvp).toBe('going');
    expect(out.organizer).toEqual({ id: 'org', username: 'org', avatar_url: null });
    expect(out.status).toBe('open');
    expect((await sessionRow(session.id))?.title).toBe('改成周六');
  });

  it('lets an admin who is not the organizer edit; my_rsvp is the admin’s own (null)', async () => {
    const { organizer } = await cast();
    const admin = await seedUser({ id: 'admin', admin: true });
    const session = await openSession(organizer);

    const out = await updateSession(env.DB, admin, session.id, { note: '管理员补充' });

    expect(out.note).toBe('管理员补充');
    expect(out.my_rsvp).toBeNull();
    // Editing does not hand the session over to the admin.
    expect(out.organizer.id).toBe('org');
    const row = await sessionRow(session.id);
    expect(row?.organizer_id).toBe('org');
    expect(row?.note).toBe('管理员补充');
  });

  it('refuses a judge or a signed-up player who is not the organizer with 403', async () => {
    const { organizer, a } = await cast();
    const judge = await seedUser({ id: 'judge', judge: true });
    const session = await openSession(organizer);
    await setRsvp(env.DB, a, session.id, 'going');

    await expect(
      updateSession(env.DB, judge, session.id, { title: '裁判改的' }),
    ).rejects.toMatchObject({ status: 403, message: NOT_ORGANIZER });
    await expect(
      updateSession(env.DB, a, session.id, { title: '玩家改的' }),
    ).rejects.toMatchObject({ status: 403, message: NOT_ORGANIZER });
    await expect(updateSession(env.DB, a, session.id, { title: 'x' })).rejects.toThrow(ApiError);

    expect((await sessionRow(session.id))?.title).toBe('周五五排');
  });

  it('404s on a session that does not exist', async () => {
    const { organizer } = await cast();
    await expect(
      updateSession(env.DB, organizer, 999_999, { title: 'x' }),
    ).rejects.toMatchObject({ status: 404, message: '约局不存在' });
  });
});

describe('updateSession — which fields move', () => {
  it('writes all six editable fields in one call', async () => {
    const { organizer } = await cast();
    const session = await openSession(organizer);
    const newStart = new Date(minuteFromNow(48)).toISOString();

    const out = await updateSession(env.DB, organizer, session.id, {
      title: '周六三排',
      starts_at: newStart,
      game: '英雄联盟',
      note: '八点准时',
      duration_min: 90,
      capacity: 3,
    });

    expect(out).toMatchObject({
      title: '周六三排',
      starts_at: newStart,
      game: '英雄联盟',
      note: '八点准时',
      duration_min: 90,
      capacity: 3,
      status: 'open',
      settled_at: null,
    });
    const row = await sessionRow(session.id);
    expect(row).toMatchObject({
      organizer_id: 'org',
      title: '周六三排',
      starts_at: newStart,
      game: '英雄联盟',
      note: '八点准时',
      duration_min: 90,
      capacity: 3,
      status: 'open',
      settled_at: null,
      settled_by: null,
    });
    expect(typeof row?.duration_min).toBe('number');
    expect(typeof row?.capacity).toBe('number');
  });

  it('touches only the fields present in the patch', async () => {
    const { organizer } = await cast();
    const session = await openSession(organizer, {
      game: '王者荣耀',
      note: '老地方',
      duration_min: 60,
      capacity: 5,
    });
    const before = await sessionRow(session.id);

    await updateSession(env.DB, organizer, session.id, { capacity: 8 });

    expect(await sessionRow(session.id)).toEqual({ ...before, capacity: 8 });
  });

  it('treats an empty patch as a no-op and still returns the detail', async () => {
    const { organizer } = await cast();
    const session = await openSession(organizer, { game: '王者荣耀', capacity: 5 });
    const before = await sessionRow(session.id);

    const out = await updateSession(env.DB, organizer, session.id, {});

    expect(await sessionRow(session.id)).toEqual(before);
    expect(out).toEqual(session);
  });

  it('ignores fields it does not own: status, organizer, settlement columns, invites', async () => {
    const { organizer, a } = await cast();
    const session = await openSession(organizer);
    const before = await sessionRow(session.id);
    // The route passes the raw JSON body straight through.
    const tampered = {
      id: 42,
      status: 'settled',
      organizer_id: a.id,
      settled_at: '2020-01-01 00:00:00',
      settled_by: a.id,
      created_at: '2020-01-01 00:00:00',
      invite: [a.id],
    } as unknown as Partial<CreateSessionInput>;

    const out = await updateSession(env.DB, organizer, session.id, tampered);

    expect(await sessionRow(session.id)).toEqual(before);
    expect(out.status).toBe('open');
    expect(out.organizer.id).toBe('org');
    // `invite` is a create-time field only: nobody new lands on the roster.
    expect((await playerRows(session.id)).map((p) => p.user_id)).toEqual(['org']);
  });

  it('trims and truncates the title to SESSION_TITLE_MAX', async () => {
    const { organizer } = await cast();
    const session = await openSession(organizer);

    let out = await updateSession(env.DB, organizer, session.id, { title: '  周日开黑  ' });
    expect(out.title).toBe('周日开黑');

    const long = '长'.repeat(SESSION_TITLE_MAX + 25);
    out = await updateSession(env.DB, organizer, session.id, { title: long });
    expect(out.title).toBe('长'.repeat(SESSION_TITLE_MAX));
    expect((await sessionRow(session.id))?.title).toHaveLength(SESSION_TITLE_MAX);
  });

  it('trims and truncates game / note, and clears them on blank, null or a non-string', async () => {
    const { organizer } = await cast();
    const session = await openSession(organizer, { game: '王者荣耀', note: '老地方' });

    let out = await updateSession(env.DB, organizer, session.id, {
      game: `  ${'g'.repeat(SESSION_GAME_MAX + 10)}  `,
      note: `  ${'n'.repeat(SESSION_NOTE_MAX + 10)}  `,
    });
    expect(out.game).toBe('g'.repeat(SESSION_GAME_MAX));
    expect(out.note).toBe('n'.repeat(SESSION_NOTE_MAX));

    out = await updateSession(env.DB, organizer, session.id, { game: '   ', note: '' });
    expect(out.game).toBeNull();
    expect(out.note).toBeNull();

    await updateSession(env.DB, organizer, session.id, { game: '恢复', note: '恢复' });
    out = await updateSession(env.DB, organizer, session.id, { game: null, note: null });
    expect(out.game).toBeNull();
    expect(out.note).toBeNull();

    await updateSession(env.DB, organizer, session.id, { game: '恢复', note: '恢复' });
    out = await updateSession(env.DB, organizer, session.id, { game: 42, note: { x: 1 } });
    expect(out.game).toBeNull();
    expect(out.note).toBeNull();
    const row = await sessionRow(session.id);
    expect(row?.game).toBeNull();
    expect(row?.note).toBeNull();
  });

  it('clears capacity and duration back to NULL (= 不限) when sent null', async () => {
    const { organizer } = await cast();
    const session = await openSession(organizer, { capacity: 5, duration_min: 60 });

    const out = await updateSession(env.DB, organizer, session.id, {
      capacity: null,
      duration_min: null,
    });

    expect(out.capacity).toBeNull();
    expect(out.duration_min).toBeNull();
    const row = await sessionRow(session.id);
    expect(row?.capacity).toBeNull();
    expect(row?.duration_min).toBeNull();
  });

  it('stores starts_at as canonical ISO UTC whatever offset the client sent', async () => {
    const { organizer } = await cast();
    const session = await openSession(organizer);
    const ms = minuteFromNow(30);
    // Same instant written as Beijing wall-clock time.
    const beijing = `${new Date(ms + OFFSET_HOURS * HOUR_MS).toISOString().slice(0, 19)}+08:00`;

    const out = await updateSession(env.DB, organizer, session.id, { starts_at: beijing });

    const expected = new Date(ms).toISOString();
    expect(out.starts_at).toBe(expected);
    const stored = (await sessionRow(session.id))?.starts_at;
    expect(stored).toBe(expected);
    // Stored as TEXT in exactly toISOString() shape — not a sqlite datetime, not a Date.
    expect(stored).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('keeps sub-second precision and reads a zone-less time as UTC', async () => {
    const { organizer } = await cast();
    const session = await openSession(organizer);
    const ms = minuteFromNow(5) + 789;
    const iso = new Date(ms).toISOString();

    let out = await updateSession(env.DB, organizer, session.id, { starts_at: iso });
    expect(out.starts_at).toBe(iso);
    expect(iso.endsWith('.789Z')).toBe(true);

    // 'YYYY-MM-DD HH:MM:SS.mmm' with no zone: Date.parse reads it as *local* time,
    // which is UTC in the Workers runtime. A Node host with TZ set elsewhere would
    // shift it — the port must keep reading it as UTC.
    const zoneless = iso.replace('T', ' ').replace('Z', '');
    out = await updateSession(env.DB, organizer, session.id, { starts_at: zoneless });
    expect(out.starts_at).toBe(iso);
    expect((await sessionRow(session.id))?.starts_at).toBe(iso);
  });

  it('lands concurrent patches to different fields — no lost update', async () => {
    const { organizer } = await cast();
    const session = await openSession(organizer, { game: '王者荣耀' });
    const before = await sessionRow(session.id);

    await Promise.all([
      updateSession(env.DB, organizer, session.id, { title: '并发标题' }),
      updateSession(env.DB, organizer, session.id, { capacity: 9 }),
      updateSession(env.DB, organizer, session.id, { note: '并发备注' }),
    ]);

    // Each patch only SETs its own columns, so none overwrites another's write.
    expect(await sessionRow(session.id)).toEqual({
      ...before,
      title: '并发标题',
      capacity: 9,
      note: '并发备注',
    });
  });

  it('re-sorts the upcoming list by the new start time', async () => {
    const { organizer } = await cast();
    const early = await openSession(organizer, { title: '早场', starts_at: FUTURE });
    const late = await openSession(organizer, {
      title: '晚场',
      starts_at: new Date(minuteFromNow(5)).toISOString(),
    });
    const titles = async (): Promise<string[]> =>
      (await listSessions(env.DB, 'upcoming', organizer.id)).map((s) => s.title);
    expect(await titles()).toEqual(['早场', '晚场']);

    // Push the early one past the late one, written with a +08:00 offset. The
    // list compares starts_at as strings, so this only works because the value is
    // re-serialised as canonical UTC ISO before it is stored.
    const ms = minuteFromNow(7);
    const beijing = `${new Date(ms + OFFSET_HOURS * HOUR_MS).toISOString().slice(0, 19)}+08:00`;
    await updateSession(env.DB, organizer, early.id, { starts_at: beijing });

    expect(await titles()).toEqual(['晚场', '早场']);
    expect((await sessionRow(early.id))?.starts_at).toBe(new Date(ms).toISOString());
    expect((await sessionRow(late.id))?.title).toBe('晚场');
  });

  it.todo(
    'BUG: title / game / note are cut with String#slice (worker/sessions.ts:211, :217), which ' +
      'counts UTF-16 code units, so an emoji straddling the limit is split. Reproduced: a title of ' +
      '59 × "a" + "😀" stores a lone surrogate (bytes ED A0 BD, not valid UTF-8) and reads back ' +
      'as 62 characters ending in three U+FFFD — longer than SESSION_TITLE_MAX. createSession ' +
      'shares the same normalisers',
  );
});

describe('updateSession — validation', () => {
  it('rejects a blank title with 标题不能为空 and a missing / non-string one with 缺少标题', async () => {
    const { organizer } = await cast();
    const session = await openSession(organizer);

    for (const title of ['', '    ']) {
      await expect(
        updateSession(env.DB, organizer, session.id, { title }),
      ).rejects.toMatchObject({ status: 400, message: '标题不能为空' });
    }
    // Unlike createSession, an update does not re-synthesise the title.
    for (const title of [null, 42]) {
      await expect(
        updateSession(env.DB, organizer, session.id, { title }),
      ).rejects.toMatchObject({ status: 400, message: '缺少标题' });
    }
    expect((await sessionRow(session.id))?.title).toBe('周五五排');
  });

  it('rejects an unparseable, missing or too-distant start time', async () => {
    const { organizer } = await cast();
    const session = await openSession(organizer);

    await expect(
      updateSession(env.DB, organizer, session.id, { starts_at: 'next friday-ish' }),
    ).rejects.toMatchObject({ status: 400, message: '开始时间格式无效' });
    for (const starts_at of [null, Date.now() + HOUR_MS]) {
      await expect(
        updateSession(env.DB, organizer, session.id, { starts_at }),
      ).rejects.toMatchObject({ status: 400, message: '缺少开始时间' });
    }
    await expect(
      updateSession(env.DB, organizer, session.id, {
        starts_at: new Date(Date.now() + 91 * DAY_MS).toISOString(),
      }),
    ).rejects.toMatchObject({ status: 400, message: '开始时间太远了（最多 90 天）' });

    // 89 days out is still fine.
    const near = new Date(minuteFromNow(89 * 24)).toISOString();
    await expect(
      updateSession(env.DB, organizer, session.id, { starts_at: near }),
    ).resolves.toMatchObject({ starts_at: near });
  });

  it('enforces capacity 2–50 inclusive, rounding before the range check', async () => {
    const { organizer } = await cast();
    const session = await openSession(organizer);
    const range = { status: 400, message: '人数上限需在 2–50 之间' };

    for (const capacity of [1, 51, 0, -3, '', 1.4, 50.5]) {
      await expect(
        updateSession(env.DB, organizer, session.id, { capacity }),
      ).rejects.toMatchObject(range);
    }
    await expect(
      updateSession(env.DB, organizer, session.id, { capacity: 'lots' }),
    ).rejects.toMatchObject({ status: 400, message: '人数上限必须是数字' });

    const accepted: Array<[unknown, number]> = [
      [2, 2],
      [50, 50],
      ['7', 7],
      [2.4, 2],
      [1.5, 2],
      [49.6, 50],
    ];
    for (const [input, stored] of accepted) {
      const out = await updateSession(env.DB, organizer, session.id, { capacity: input });
      expect(out.capacity).toBe(stored);
      expect((await sessionRow(session.id))?.capacity).toBe(stored);
    }
  });

  it('enforces duration 15–1440 minutes inclusive, rounding before the range check', async () => {
    const { organizer } = await cast();
    const session = await openSession(organizer);
    const range = { status: 400, message: '时长需在 15–1440 之间' };

    for (const duration_min of [14, 1441, 0, 14.4, 1440.5]) {
      await expect(
        updateSession(env.DB, organizer, session.id, { duration_min }),
      ).rejects.toMatchObject(range);
    }
    await expect(
      updateSession(env.DB, organizer, session.id, { duration_min: 'an hour' }),
    ).rejects.toMatchObject({ status: 400, message: '时长必须是数字' });

    const accepted: Array<[unknown, number]> = [
      [15, 15],
      [1440, 1440],
      ['120', 120],
      [14.5, 15],
      [89.6, 90],
    ];
    for (const [input, stored] of accepted) {
      const out = await updateSession(env.DB, organizer, session.id, { duration_min: input });
      expect(out.duration_min).toBe(stored);
      expect((await sessionRow(session.id))?.duration_min).toBe(stored);
    }
  });

  it('applies nothing when any one field is invalid — no partial patch', async () => {
    const { organizer } = await cast();
    const session = await openSession(organizer, { game: '王者荣耀', capacity: 5 });
    const before = await sessionRow(session.id);

    await expect(
      updateSession(env.DB, organizer, session.id, {
        title: '新标题',
        game: '新游戏',
        note: '新备注',
        capacity: 99,
      }),
    ).rejects.toMatchObject({ status: 400, message: '人数上限需在 2–50 之间' });
    await expect(
      updateSession(env.DB, organizer, session.id, {
        title: '新标题',
        duration_min: 5,
      }),
    ).rejects.toMatchObject({ status: 400, message: '时长需在 15–1440 之间' });
    await expect(
      updateSession(env.DB, organizer, session.id, {
        capacity: 10,
        starts_at: 'garbage',
      }),
    ).rejects.toMatchObject({ status: 400, message: '开始时间格式无效' });

    expect(await sessionRow(session.id)).toEqual(before);
  });
});

describe('updateSession — session status', () => {
  it('refuses a cancelled session with 400 and leaves it untouched', async () => {
    const { organizer } = await cast();
    const session = await openSession(organizer);
    await cancelSession(env.DB, organizer, session.id);
    const before = await sessionRow(session.id);

    await expect(
      updateSession(env.DB, organizer, session.id, { title: '复活' }),
    ).rejects.toMatchObject({ status: 400, message: NOT_EDITABLE });
    // Even an admin cannot edit it, and even an empty patch is refused.
    const admin = await seedUser({ id: 'admin', admin: true });
    await expect(updateSession(env.DB, admin, session.id, {})).rejects.toMatchObject({
      status: 400,
      message: NOT_EDITABLE,
    });
    expect(await sessionRow(session.id)).toEqual(before);
    expect(before?.status).toBe('cancelled');
  });

  it('refuses a settled session with 400 and leaves it untouched', async () => {
    const { organizer, a } = await cast();
    const session = await openSession(organizer);
    await setRsvp(env.DB, a, session.id, 'going');
    await env.DB.prepare('UPDATE game_sessions SET starts_at = ? WHERE id = ?')
      .bind(PAST, session.id)
      .run();
    await rollCall(
      env.DB,
      organizer,
      session.id,
      [{ user_id: a.id, attendance: 'on_time' }],
      OFFSET_HOURS,
    );
    await settleSession(env.DB, organizer, session.id, [], true, noAiEnv(), OFFSET_HOURS);
    const before = await sessionRow(session.id);
    expect(before?.status).toBe('settled');

    await expect(
      updateSession(env.DB, organizer, session.id, { note: '补一句' }),
    ).rejects.toMatchObject({ status: 400, message: NOT_EDITABLE });
    await expect(updateSession(env.DB, organizer, session.id, {})).rejects.toMatchObject({
      status: 400,
      message: NOT_EDITABLE,
    });
    expect(await sessionRow(session.id)).toEqual(before);
  });

  it('checks the caller before the status: a stranger on a cancelled session gets 403', async () => {
    const { organizer, a } = await cast();
    const session = await openSession(organizer);
    await cancelSession(env.DB, organizer, session.id);

    await expect(
      updateSession(env.DB, a, session.id, { title: 'x' }),
    ).rejects.toMatchObject({ status: 403, message: NOT_ORGANIZER });
  });

  it.todo(
    'BUG: updateSession does not refuse a session that has already started — it only checks ' +
      "status !== 'open' (worker/sessions.ts:357). Reproduced: after roll call marks a player " +
      'no_show, the organizer can move starts_at back into the future; setRsvp (sessions.ts:422) ' +
      "only checks starts_at, so the player can then switch to 'out' while attendance stays " +
      'no_show. The organizer can also retitle the session the settle-time claims quote',
  );

  it.todo(
    'BUG: updateSession accepts a starts_at in the past — normalizeStartsAt has an upper bound ' +
      'only (worker/sessions.ts:220-226). An organizer can pull a future session whose players ' +
      'said "going" behind now, which freezes their RSVPs and unlocks roll call + settlement ' +
      'against them immediately (reproduced: rollCall then returns a no_show draft). ' +
      'createSession accepts a past starts_at the same way',
  );
});

describe('updateSession — effect on the roster', () => {
  it('reschedules without touching anybody’s rsvp, rsvp_at or attendance', async () => {
    const { organizer, a, b, c, d } = await cast();
    const session = await openSession(organizer, { invite: [a.id, b.id, c.id] });
    await setRsvp(env.DB, a, session.id, 'going');
    await setRsvp(env.DB, b, session.id, 'maybe');
    await setRsvp(env.DB, d, session.id, 'out');
    const before = await playerRows(session.id);
    expect(before.map((p) => [p.user_id, p.rsvp])).toEqual([
      ['a', 'going'],
      ['b', 'maybe'],
      ['c', 'invited'],
      ['d', 'out'],
      ['org', 'going'],
    ]);

    const newStart = new Date(minuteFromNow(26)).toISOString();
    const out = await updateSession(env.DB, organizer, session.id, {
      starts_at: newStart,
      title: '改期了',
      capacity: 10,
    });

    expect(await playerRows(session.id)).toEqual(before);
    expect(out.counts).toEqual({ invited: 1, going: 2, maybe: 1, out: 1 });
    expect(out.players).toHaveLength(5);
    expect(out.players.every((p) => p.attendance === null && p.record_id === null)).toBe(true);
  });

  it('keeps a still-invited player’s invite alive at the new time', async () => {
    const { organizer, c } = await cast();
    const session = await openSession(organizer, { invite: [c.id] });
    const newStart = new Date(minuteFromNow(50)).toISOString();

    await updateSession(env.DB, organizer, session.id, { starts_at: newStart, title: '改期' });

    const invites = await listMyInvites(env.DB, c.id);
    expect(invites.map((s) => [s.id, s.title, s.starts_at, s.my_rsvp])).toEqual([
      [session.id, '改期', newStart, 'invited'],
    ]);
  });

  it('lowering capacity below the going count kicks nobody, but blocks new seats', async () => {
    const { organizer, a, b, c } = await cast();
    const session = await openSession(organizer, { capacity: 5 });
    await setRsvp(env.DB, a, session.id, 'going');
    await setRsvp(env.DB, b, session.id, 'going'); // 3 going incl. organizer

    const out = await updateSession(env.DB, organizer, session.id, { capacity: 2 });

    expect(out.capacity).toBe(2);
    expect(out.counts.going).toBe(3);
    expect((await playerRows(session.id)).filter((p) => p.rsvp === 'going')).toHaveLength(3);
    await expect(setRsvp(env.DB, c, session.id, 'going')).rejects.toMatchObject({
      status: 400,
      message: '人数已满',
    });
    // An existing seat-holder may re-confirm…
    await expect(setRsvp(env.DB, a, session.id, 'going')).resolves.toMatchObject({
      counts: { going: 3 },
    });
    // …but once they step out, the seat is gone under the new cap.
    await setRsvp(env.DB, a, session.id, 'out');
    await expect(setRsvp(env.DB, a, session.id, 'going')).rejects.toThrow(/人数已满/);
  });

  it('raising capacity frees seats for players who were turned away', async () => {
    const { organizer, a, b } = await cast();
    const session = await openSession(organizer, { capacity: 2 });
    await setRsvp(env.DB, a, session.id, 'going');
    await expect(setRsvp(env.DB, b, session.id, 'going')).rejects.toThrow(/人数已满/);

    await updateSession(env.DB, organizer, session.id, { capacity: 3 });

    const out = await setRsvp(env.DB, b, session.id, 'going');
    expect(out.counts.going).toBe(3);
  });

  it('clearing capacity makes the session unlimited', async () => {
    const { organizer, a, b } = await cast();
    const session = await openSession(organizer, { capacity: 2 });
    await setRsvp(env.DB, a, session.id, 'going');

    await updateSession(env.DB, organizer, session.id, { capacity: null });

    await expect(setRsvp(env.DB, b, session.id, 'going')).resolves.toMatchObject({
      capacity: null,
      counts: { going: 3 },
    });
  });

  it('never moves a point, files a record or writes a score event', async () => {
    const { organizer, a } = await cast();
    const session = await openSession(organizer);
    await setRsvp(env.DB, a, session.id, 'going');
    const playersBefore = await tableCount('session_players');

    await updateSession(env.DB, organizer, session.id, {
      title: '改',
      starts_at: new Date(minuteFromNow(10)).toISOString(),
      capacity: 2,
      duration_min: 30,
    });

    expect(await scoreOf(organizer.id)).toBe(100);
    expect(await scoreOf(a.id)).toBe(100);
    expect(await scoreEventCount(organizer.id)).toBe(0);
    expect(await scoreEventCount(a.id)).toBe(0);
    expect(await tableCount('records')).toBe(0);
    expect(await tableCount('score_events')).toBe(0);
    expect(await tableCount('session_players')).toBe(playersBefore);
  });
});

// ---------------------------------------------------------------------------
// app_settings: writeSetting / readSettings / loadAiConfig
// ---------------------------------------------------------------------------

interface SettingRow {
  key: string;
  value: string;
  updated_by: string | null;
  updated_at: string;
}

async function settingRows(): Promise<SettingRow[]> {
  const rows = await env.DB.prepare(
    'SELECT key, value, updated_by, updated_at FROM app_settings ORDER BY key',
  ).all<SettingRow>();
  return rows.results;
}

const SQLITE_DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function expectRecent(sqlTime: string): void {
  expect(sqlTime).toMatch(SQLITE_DATETIME);
  expect(Math.abs(parseSqlUtc(sqlTime) - Date.now())).toBeLessThan(5 * 60_000);
}

const FULL_ENV: AiEnvSlice = {
  AI_BASE_URL: 'https://env.example.com/v1',
  AI_MODEL: 'env-model',
  AI_API_KEY: 'sk-env',
};

describe('writeSetting / readSettings', () => {
  it('reads an empty table as an empty Map', async () => {
    const settings = await readSettings(env.DB);
    expect(settings).toBeInstanceOf(Map);
    expect(settings.size).toBe(0);
  });

  it('stores value, updated_by and a sqlite-format updated_at, and reads it back', async () => {
    await writeSetting(env.DB, AI_SETTING_KEYS.model, 'gpt-x', 'admin-1');

    const rows = await settingRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 'ai.model', value: 'gpt-x', updated_by: 'admin-1' });
    expectRecent(rows[0].updated_at);

    expect([...(await readSettings(env.DB)).entries()]).toEqual([['ai.model', 'gpt-x']]);
  });

  it('upserts: a second write to the same key replaces value, updated_by and updated_at', async () => {
    await writeSetting(env.DB, AI_SETTING_KEYS.temperature, '0.3', 'admin-1');
    await env.DB.prepare("UPDATE app_settings SET updated_at = '2000-01-01 00:00:00'").run();

    await writeSetting(env.DB, AI_SETTING_KEYS.temperature, '0.8', 'admin-2');

    const rows = await settingRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: 'ai.temperature',
      value: '0.8',
      updated_by: 'admin-2',
    });
    expect(rows[0].updated_at).not.toBe('2000-01-01 00:00:00');
    expectRecent(rows[0].updated_at);
    expect((await readSettings(env.DB)).get('ai.temperature')).toBe('0.8');
  });

  it('rewriting the identical value still records who wrote it last', async () => {
    await writeSetting(env.DB, AI_SETTING_KEYS.enabled, 'true', 'admin-1');
    await writeSetting(env.DB, AI_SETTING_KEYS.enabled, 'true', 'admin-2');

    expect(await settingRows()).toMatchObject([
      { key: 'ai.enabled', value: 'true', updated_by: 'admin-2' },
    ]);
  });

  it('keeps keys independent and returns every row, known key or not', async () => {
    await writeSetting(env.DB, AI_SETTING_KEYS.model, 'm1', 'admin');
    await writeSetting(env.DB, AI_SETTING_KEYS.baseUrl, 'https://a.example/v1', 'admin');
    await writeSetting(env.DB, 'custom.flag', 'on', 'admin');
    await writeSetting(env.DB, AI_SETTING_KEYS.model, 'm2', 'admin');
    // Keys are compared exactly: case matters.
    await writeSetting(env.DB, 'AI.MODEL', 'upper', 'admin');

    const settings = await readSettings(env.DB);
    expect(Object.fromEntries(settings)).toEqual({
      'ai.model': 'm2',
      'ai.base_url': 'https://a.example/v1',
      'custom.flag': 'on',
      'AI.MODEL': 'upper',
    });
    expect(await settingRows()).toHaveLength(4);
    expect((await loadAiConfig(env.DB, {})).model).toBe('m2');
  });

  it('round-trips values byte-for-byte as strings — no trimming, no type coercion', async () => {
    const prompt = `第一行「引号」'single' "double"\n\t第二行 \\ 反斜杠 ${'字'.repeat(7_950)}  `;
    await writeSetting(env.DB, AI_SETTING_KEYS.prompt, prompt, 'admin');
    await writeSetting(env.DB, AI_SETTING_KEYS.temperature, '0.70', 'admin');
    await writeSetting(env.DB, AI_SETTING_KEYS.enabled, 'false', 'admin');
    await writeSetting(env.DB, AI_SETTING_KEYS.model, '', 'admin');

    const settings = await readSettings(env.DB);
    expect(settings.get('ai.prompt')).toBe(prompt);
    expect(settings.get('ai.temperature')).toBe('0.70');
    expect(settings.get('ai.enabled')).toBe('false');
    // An empty string is stored as a row, not dropped and not NULL.
    expect(settings.has('ai.model')).toBe(true);
    expect(settings.get('ai.model')).toBe('');
    for (const value of settings.values()) expect(typeof value).toBe('string');
  });

  it('drops a U+0000 inside a value — and stores the rest intact', async () => {
    // PostgreSQL `text` rejects U+0000 outright, and the admin route does not strip
    // it from prompts — so the port handles it explicitly: writeSetting drops NULs
    // on every engine, so D1 and PostgreSQL store the same prompt.
    await writeSetting(env.DB, AI_SETTING_KEYS.prompt, 'before\u0000after', 'admin');

    const got = (await readSettings(env.DB)).get('ai.prompt');
    expect(got).toBe('beforeafter');
    expect((await loadAiConfig(env.DB, {})).prompt).toBe('beforeafter');
  });

  it('lands every write when several keys are written concurrently, like the admin route does', async () => {
    await Promise.all([
      writeSetting(env.DB, AI_SETTING_KEYS.enabled, 'true', 'admin'),
      writeSetting(env.DB, AI_SETTING_KEYS.baseUrl, 'https://c.example/v1', 'admin'),
      writeSetting(env.DB, AI_SETTING_KEYS.model, 'c-model', 'admin'),
      writeSetting(env.DB, AI_SETTING_KEYS.temperature, '1', 'admin'),
      writeSetting(env.DB, AI_SETTING_KEYS.prompt, 'p', 'admin'),
      writeSetting(env.DB, AI_SETTING_KEYS.classifyPrompt, 'cp', 'admin'),
      writeSetting(env.DB, AI_SETTING_KEYS.reportPrompt, 'rp', 'admin'),
    ]);

    expect(Object.fromEntries(await readSettings(env.DB))).toEqual({
      'ai.enabled': 'true',
      'ai.base_url': 'https://c.example/v1',
      'ai.model': 'c-model',
      'ai.temperature': '1',
      'ai.prompt': 'p',
      'ai.classify_prompt': 'cp',
      'ai.report_prompt': 'rp',
    });
  });
});

describe('loadAiConfig — app_settings > env > default', () => {
  it('falls back to built-in defaults with no rows and no env', async () => {
    const cfg = await loadAiConfig(env.DB, {});
    expect(cfg).toEqual({
      enabled: false,
      baseUrl: '',
      model: '',
      apiKey: '',
      temperature: DEFAULT_TEMPERATURE,
      prompt: DEFAULT_SYSTEM_PROMPT,
      classifyPrompt: DEFAULT_CLASSIFY_PROMPT,
      reportPrompt: DEFAULT_REPORT_PROMPT,
      promptVersion: shortHash(
        `${DEFAULT_SYSTEM_PROMPT}\u0000${DEFAULT_CLASSIFY_PROMPT}\u0000${DEFAULT_REPORT_PROMPT}`,
      ),
    });
  });

  it('uses env when no row exists', async () => {
    const cfg = await loadAiConfig(env.DB, {
      ...FULL_ENV,
      AI_TEMPERATURE: '0.5',
      AI_SYSTEM_PROMPT: 'env 提示词',
    });
    expect(cfg).toMatchObject({
      enabled: true,
      baseUrl: 'https://env.example.com/v1',
      model: 'env-model',
      apiKey: 'sk-env',
      temperature: 0.5,
      prompt: 'env 提示词',
      classifyPrompt: DEFAULT_CLASSIFY_PROMPT,
      reportPrompt: DEFAULT_REPORT_PROMPT,
    });
  });

  it('lets stored rows override env, normalising the base url and parsing temperature', async () => {
    await writeSetting(env.DB, AI_SETTING_KEYS.baseUrl, '  https://db.example.com/v1//  ', 'admin');
    await writeSetting(env.DB, AI_SETTING_KEYS.model, 'db-model', 'admin');
    await writeSetting(env.DB, AI_SETTING_KEYS.temperature, '0.9', 'admin');
    await writeSetting(env.DB, AI_SETTING_KEYS.prompt, '数据库提示词', 'admin');

    const cfg = await loadAiConfig(env.DB, {
      ...FULL_ENV,
      AI_TEMPERATURE: '0.1',
      AI_SYSTEM_PROMPT: 'env 提示词',
    });

    expect(cfg.baseUrl).toBe('https://db.example.com/v1');
    expect(cfg.model).toBe('db-model');
    expect(cfg.temperature).toBe(0.9);
    expect(cfg.prompt).toBe('数据库提示词');
    expect(cfg.apiKey).toBe('sk-env');
    expect(cfg.enabled).toBe(true);
    // The raw row is untouched — normalisation happens on read only.
    expect((await readSettings(env.DB)).get('ai.base_url')).toBe('  https://db.example.com/v1//  ');
  });

  it('treats an empty row as absent: falls through to env, then to the default', async () => {
    await writeSetting(env.DB, AI_SETTING_KEYS.model, '', 'admin');
    await writeSetting(env.DB, AI_SETTING_KEYS.prompt, '', 'admin');
    await writeSetting(env.DB, AI_SETTING_KEYS.temperature, '', 'admin');

    const withEnv = await loadAiConfig(env.DB, {
      ...FULL_ENV,
      AI_SYSTEM_PROMPT: 'env 提示词',
      AI_TEMPERATURE: '0.4',
    });
    expect(withEnv.model).toBe('env-model');
    expect(withEnv.prompt).toBe('env 提示词');
    expect(withEnv.temperature).toBe(0.4);

    const bare = await loadAiConfig(env.DB, {});
    expect(bare.model).toBe('');
    expect(bare.prompt).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(bare.temperature).toBe(DEFAULT_TEMPERATURE);
  });

  it('takes the classify and report prompts from rows only — there is no env fallback', async () => {
    // Env vars a port might be tempted to honour; today they are ignored.
    const envWithPrompts = {
      ...FULL_ENV,
      AI_CLASSIFY_PROMPT: 'env 分类',
      AI_REPORT_PROMPT: 'env 周报',
    } as AiEnvSlice;
    const before = await loadAiConfig(env.DB, envWithPrompts);
    expect(before.classifyPrompt).toBe(DEFAULT_CLASSIFY_PROMPT);
    expect(before.reportPrompt).toBe(DEFAULT_REPORT_PROMPT);

    await writeSetting(env.DB, AI_SETTING_KEYS.classifyPrompt, '分类提示词', 'admin');
    await writeSetting(env.DB, AI_SETTING_KEYS.reportPrompt, '周报提示词', 'admin');

    const after = await loadAiConfig(env.DB, envWithPrompts);
    expect(after.classifyPrompt).toBe('分类提示词');
    expect(after.reportPrompt).toBe('周报提示词');
    expect(after.prompt).toBe(DEFAULT_SYSTEM_PROMPT);
  });

  it('lets the stored switch win over AI_ENABLED in both directions', async () => {
    await writeSetting(env.DB, AI_SETTING_KEYS.enabled, 'true', 'admin');
    expect((await loadAiConfig(env.DB, { ...FULL_ENV, AI_ENABLED: 'false' })).enabled).toBe(true);

    await writeSetting(env.DB, AI_SETTING_KEYS.enabled, 'false', 'admin');
    expect((await loadAiConfig(env.DB, { ...FULL_ENV, AI_ENABLED: 'true' })).enabled).toBe(false);

    // A stored 'true' still cannot enable AI without base url + model + key.
    await writeSetting(env.DB, AI_SETTING_KEYS.enabled, 'true', 'admin');
    expect((await loadAiConfig(env.DB, { AI_BASE_URL: 'https://a/v1', AI_MODEL: 'm' })).enabled).toBe(
      false,
    );
  });

  it('can be configured entirely from rows, except the key which only env supplies', async () => {
    await writeSetting(env.DB, AI_SETTING_KEYS.baseUrl, 'https://db.example.com/v1', 'admin');
    await writeSetting(env.DB, AI_SETTING_KEYS.model, 'db-model', 'admin');
    // A row that looks like a credential must never be picked up.
    await writeSetting(env.DB, 'ai.api_key', 'sk-from-db', 'admin');

    const noKey = await loadAiConfig(env.DB, {});
    expect(noKey.apiKey).toBe('');
    expect(noKey.enabled).toBe(false);

    const withKey = await loadAiConfig(env.DB, { AI_API_KEY: 'sk-env' });
    expect(withKey.apiKey).toBe('sk-env');
    expect(withKey.enabled).toBe(true);
    expect(withKey.baseUrl).toBe('https://db.example.com/v1');
    expect(withKey.model).toBe('db-model');
  });

  it('re-reads on every call: the prompt version follows writes and depends on text only', async () => {
    const original = await loadAiConfig(env.DB, FULL_ENV);

    await writeSetting(env.DB, AI_SETTING_KEYS.prompt, '改过的提示词', 'admin');
    const edited = await loadAiConfig(env.DB, FULL_ENV);
    expect(edited.prompt).toBe('改过的提示词');
    expect(edited.promptVersion).not.toBe(original.promptVersion);
    expect(edited.promptVersion).toMatch(/^[0-9a-f]{8}$/);

    // Writing the default text back as a row gives the same version as no row.
    await writeSetting(env.DB, AI_SETTING_KEYS.prompt, DEFAULT_SYSTEM_PROMPT, 'admin');
    const restored = await loadAiConfig(env.DB, FULL_ENV);
    expect(restored.promptVersion).toBe(original.promptVersion);
  });
});
