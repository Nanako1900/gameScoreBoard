import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { VIOLATION_MAP, WEEKLY_BONUS_CAP } from '../../shared/scoring';
import { listRecords } from '../../worker/cases';
import { ApiError } from '../../worker/errors';
import {
  cancelSession,
  createSession,
  getSessionDetail,
  listSessions,
  rollCall,
  setRsvp,
  settleSession,
} from '../../worker/sessions';
import type { SessionDetail, User } from '../../worker/types';
import { OFFSET_HOURS, noAiEnv, scoreEventCount, scoreOf, seedUser } from './helpers';

const FUTURE = new Date(Date.now() + 3 * 3_600_000).toISOString();
const PAST = new Date(Date.now() - 3 * 3_600_000).toISOString();

async function cast(): Promise<{ organizer: User; a: User; b: User; c: User }> {
  return {
    organizer: await seedUser({ id: 'org', judge: true }),
    a: await seedUser({ id: 'a' }),
    b: await seedUser({ id: 'b' }),
    c: await seedUser({ id: 'c' }),
  };
}

/** Build a started session with everyone signed up, ready for roll call. */
async function startedSession(
  organizer: User,
  players: User[],
): Promise<SessionDetail> {
  const session = await createSession(env.DB, organizer, {
    title: '周五五排',
    starts_at: FUTURE,
    capacity: 10,
  }, OFFSET_HOURS);
  for (const p of players) await setRsvp(env.DB, p, session.id, 'going');
  // Move the start into the past so roll call is allowed.
  await env.DB.prepare('UPDATE game_sessions SET starts_at = ? WHERE id = ?')
    .bind(PAST, session.id)
    .run();
  return getSessionDetail(env.DB, session.id, organizer.id);
}

describe('createSession', () => {
  it('signs the organizer up automatically', async () => {
    const { organizer } = await cast();
    const session = await createSession(env.DB, organizer, {
      title: '周五五排',
      game: '王者荣耀',
      starts_at: FUTURE,
      capacity: 5,
    }, OFFSET_HOURS);
    expect(session.counts.going).toBe(1);
    expect(session.players[0].user.id).toBe(organizer.id);
    expect(session.status).toBe('open');
  });

  it('does not require the judge role — organising is not judging', async () => {
    const plain = await seedUser({ id: 'plain' });
    const session = await createSession(env.DB, plain, { title: '随便打打', starts_at: FUTURE }, OFFSET_HOURS);
    expect(session.organizer.id).toBe('plain');
  });

  it('rejects a blank title, a bad time and an absurd lead time', async () => {
    const { organizer } = await cast();
    await expect(
      createSession(env.DB, organizer, { title: '   ', starts_at: FUTURE }, OFFSET_HOURS),
    ).rejects.toThrow(ApiError);
    await expect(
      createSession(env.DB, organizer, { title: 'x', starts_at: 'tomorrow-ish' }, OFFSET_HOURS),
    ).rejects.toThrow(/时间/);
    await expect(
      createSession(env.DB, organizer, {
        title: 'x',
        starts_at: new Date(Date.now() + 400 * 24 * 3_600_000).toISOString(),
      }, OFFSET_HOURS),
    ).rejects.toThrow(/90 天/);
  });

  it('rejects out-of-range capacity and duration', async () => {
    const { organizer } = await cast();
    await expect(
      createSession(env.DB, organizer, { title: 'x', starts_at: FUTURE, capacity: 1 }, OFFSET_HOURS),
    ).rejects.toThrow(/人数/);
    await expect(
      createSession(env.DB, organizer, { title: 'x', starts_at: FUTURE, duration_min: 5 }, OFFSET_HOURS),
    ).rejects.toThrow(/时长/);
  });
});

describe('rsvp', () => {
  it('records and updates a player’s answer', async () => {
    const { organizer, a } = await cast();
    const session = await createSession(env.DB, organizer, { title: 'x', starts_at: FUTURE }, OFFSET_HOURS);

    let out = await setRsvp(env.DB, a, session.id, 'going');
    expect(out.counts.going).toBe(2);

    out = await setRsvp(env.DB, a, session.id, 'out');
    expect(out.counts.going).toBe(1);
    expect(out.counts.out).toBe(1);
  });

  it('enforces the capacity, but lets an existing attendee re-confirm', async () => {
    const { organizer, a, b } = await cast();
    const session = await createSession(env.DB, organizer, {
      title: 'x',
      starts_at: FUTURE,
      capacity: 2,
    }, OFFSET_HOURS);
    await setRsvp(env.DB, a, session.id, 'going'); // 2/2

    await expect(setRsvp(env.DB, b, session.id, 'going')).rejects.toThrow(/人数已满/);
    // b may still mark themselves as maybe/out — those do not take a slot.
    await expect(setRsvp(env.DB, b, session.id, 'maybe')).resolves.toBeDefined();
    await expect(setRsvp(env.DB, a, session.id, 'going')).resolves.toBeDefined();
  });

  it('refuses changes once the session has started or been cancelled', async () => {
    const { organizer, a } = await cast();
    const session = await createSession(env.DB, organizer, { title: 'x', starts_at: FUTURE }, OFFSET_HOURS);
    await env.DB.prepare('UPDATE game_sessions SET starts_at = ? WHERE id = ?')
      .bind(PAST, session.id)
      .run();
    await expect(setRsvp(env.DB, a, session.id, 'going')).rejects.toThrow(/已开始/);

    const other = await createSession(env.DB, organizer, { title: 'y', starts_at: FUTURE }, OFFSET_HOURS);
    await cancelSession(env.DB, organizer, other.id);
    await expect(setRsvp(env.DB, a, other.id, 'going')).rejects.toThrow(/不接受报名/);
  });

  it('will not let the organizer quietly bail on their own session', async () => {
    const { organizer } = await cast();
    const session = await createSession(env.DB, organizer, { title: 'x', starts_at: FUTURE }, OFFSET_HOURS);
    await expect(setRsvp(env.DB, organizer, session.id, 'out')).rejects.toThrow(/取消约局/);
  });

  it('validates the rsvp value', async () => {
    const { organizer, a } = await cast();
    const session = await createSession(env.DB, organizer, { title: 'x', starts_at: FUTURE }, OFFSET_HOURS);
    await expect(setRsvp(env.DB, a, session.id, 'MAYBE')).rejects.toThrow(/报名状态/);
  });
});

describe('rollCall', () => {
  it('records attendance and moves nobody’s score', async () => {
    const { organizer, a, b } = await cast();
    const session = await startedSession(organizer, [a, b]);

    const res = await rollCall(
      env.DB,
      organizer,
      session.id,
      [
        { user_id: a.id, attendance: 'late', late_minutes: 20 },
        { user_id: b.id, attendance: 'no_show' },
        { user_id: organizer.id, attendance: 'on_time' },
      ],
      OFFSET_HOURS,
    );

    expect(await scoreOf(a.id)).toBe(100);
    expect(await scoreOf(b.id)).toBe(100);
    expect(await scoreEventCount(a.id)).toBe(0);
    // Drafts are proposals only — nothing has been filed.
    expect(await listRecords(env.DB, { session: session.id })).toHaveLength(0);

    const forA = res.drafts.find((d) => d.user_id === a.id);
    expect(forA?.type).toBe('late_major'); // 20 min → 15..30 bucket
    expect(res.drafts.find((d) => d.user_id === b.id)?.type).toBe('no_show');
    // The organizer never appears as their own defendant.
    expect(res.drafts.some((d) => d.user_id === organizer.id)).toBe(false);
  });

  it('only lets the organizer or an admin call the roll', async () => {
    const { organizer, a, b } = await cast();
    const session = await startedSession(organizer, [a, b]);
    const entries = [{ user_id: a.id, attendance: 'no_show' }];

    await expect(rollCall(env.DB, a, session.id, entries, OFFSET_HOURS)).rejects.toThrow(/组织者/);

    const admin = await seedUser({ id: 'admin', admin: true });
    await expect(
      rollCall(env.DB, admin, session.id, entries, OFFSET_HOURS),
    ).resolves.toBeDefined();
  });

  it('refuses before the session has started', async () => {
    const { organizer, a } = await cast();
    const session = await createSession(env.DB, organizer, { title: 'x', starts_at: FUTURE }, OFFSET_HOURS);
    await setRsvp(env.DB, a, session.id, 'going');
    await expect(
      rollCall(env.DB, organizer, session.id, [{ user_id: a.id, attendance: 'no_show' }], OFFSET_HOURS),
    ).rejects.toThrow(/还没开始/);
  });

  it('refuses to mark someone who never signed up', async () => {
    const { organizer, a, c } = await cast();
    const session = await startedSession(organizer, [a]);
    await expect(
      rollCall(env.DB, organizer, session.id, [{ user_id: c.id, attendance: 'no_show' }], OFFSET_HOURS),
    ).rejects.toThrow(/报名过/);
  });

  it('rejects a bogus attendance value', async () => {
    const { organizer, a } = await cast();
    const session = await startedSession(organizer, [a]);
    await expect(
      rollCall(env.DB, organizer, session.id, [{ user_id: a.id, attendance: 'vanished' }], OFFSET_HOURS),
    ).rejects.toThrow(/出勤状态/);
  });

  it('omits 请假 from the drafts', async () => {
    const { organizer, a } = await cast();
    const session = await startedSession(organizer, [a]);
    const res = await rollCall(
      env.DB,
      organizer,
      session.id,
      [{ user_id: a.id, attendance: 'excused' }],
      OFFSET_HOURS,
    );
    expect(res.drafts.some((d) => d.user_id === a.id)).toBe(false);
  });

  it('can be redone before settlement', async () => {
    const { organizer, a } = await cast();
    const session = await startedSession(organizer, [a]);
    await rollCall(env.DB, organizer, session.id, [{ user_id: a.id, attendance: 'no_show' }], OFFSET_HOURS);
    const second = await rollCall(
      env.DB,
      organizer,
      session.id,
      [{ user_id: a.id, attendance: 'late', late_minutes: 5 }],
      OFFSET_HOURS,
    );
    expect(second.drafts.find((d) => d.user_id === a.id)?.type).toBe('late_minor');
  });
});

describe('settleSession', () => {
  async function rolled() {
    const { organizer, a, b } = await cast();
    const session = await startedSession(organizer, [a, b]);
    await rollCall(
      env.DB,
      organizer,
      session.id,
      [
        { user_id: a.id, attendance: 'no_show' },
        { user_id: b.id, attendance: 'on_time' },
        { user_id: organizer.id, attendance: 'on_time' },
      ],
      OFFSET_HOURS,
    );
    return { organizer, a, b, session };
  }

  it('skip_all closes the session without touching a single point', async () => {
    const { organizer, a, session } = await rolled();
    const res = await settleSession(
      env.DB,
      organizer,
      session.id,
      [],
      true,
      noAiEnv(),
      OFFSET_HOURS,
    );

    expect(res.created).toBe(0);
    expect(res.session.status).toBe('settled');
    expect(await scoreOf(a.id)).toBe(100);
    // Attendance is still on the record — that is the point of "记录但不扣分".
    expect(res.session.players.find((p) => p.user.id === a.id)?.attendance).toBe('no_show');
  });

  it('files exactly the ticked drafts', async () => {
    const { organizer, a, b, session } = await rolled();
    const res = await settleSession(
      env.DB,
      organizer,
      session.id,
      [{ user_id: a.id }],
      false,
      noAiEnv(),
      OFFSET_HOURS,
    );

    expect(res.created).toBe(1);
    const records = await listRecords(env.DB, { session: session.id });
    const against = records.filter((r) => r.subject.id === a.id);
    expect(against).toHaveLength(1);
    expect(against[0].type).toBe('no_show');
    expect(against[0].status).toBe('awaiting_statement');
    expect(against[0].session_id).toBe(session.id);
    // b was not ticked, so nothing was filed against them.
    expect(records.some((r) => r.subject.id === b.id)).toBe(false);
    // And a's score is untouched until the case is judged.
    expect(await scoreOf(a.id)).toBe(100);
  });

  it('re-derives the violation type and refuses a tampered escalation', async () => {
    const { organizer, a, b, session } = await rolled();
    // b was on time; a tampered client asks for the -25 group-wipe charge.
    await expect(
      settleSession(
        env.DB,
        organizer,
        session.id,
        [{ user_id: b.id, type: 'no_show_group' }],
        false,
        noAiEnv(),
        OFFSET_HOURS,
      ),
    ).rejects.toThrow(/改判成其他类型/);
    // Rejected before anything moved, so the session is still open for a retry.
    expect((await getSessionDetail(env.DB, session.id, organizer.id)).status).toBe('open');
  });

  it('hands the session back when any entry is invalid', async () => {
    const { organizer, a, session } = await rolled();
    // A good entry first, then one for someone who never signed up.
    await expect(
      settleSession(
        env.DB,
        organizer,
        session.id,
        [{ user_id: a.id }, { user_id: 'stranger' }],
        false,
        noAiEnv(),
        OFFSET_HOURS,
      ),
    ).rejects.toThrow(/报名过/);

    // Nothing moved: still open, nothing filed, and the corrected retry goes
    // through instead of bouncing off 「已经结算过了」.
    expect((await getSessionDetail(env.DB, session.id, organizer.id)).status).toBe('open');
    expect(await listRecords(env.DB, { session: session.id })).toHaveLength(0);
    const retry = await settleSession(
      env.DB,
      organizer,
      session.id,
      [{ user_id: a.id }],
      false,
      noAiEnv(),
      OFFSET_HOURS,
    );
    expect(retry.created).toBe(1);
  });

  it('refuses the same player twice in one settlement', async () => {
    const { organizer, a, session } = await rolled();
    // Settlement skips the per-day rate limits, so a repeat would file the same
    // charge again for every copy.
    await expect(
      settleSession(
        env.DB,
        organizer,
        session.id,
        [{ user_id: a.id }, { user_id: a.id }],
        false,
        noAiEnv(),
        OFFSET_HOURS,
      ),
    ).rejects.toThrow(/重复/);
    expect((await getSessionDetail(env.DB, session.id, organizer.id)).status).toBe('open');
    expect(await listRecords(env.DB, { session: session.id })).toHaveLength(0);
  });

  it('normalises a whitespace-padded claim the way fileCase will check it', async () => {
    const { organizer, a, b, c } = await cast();
    const session = await startedSession(organizer, [a, b, c]);
    await rollCall(
      env.DB,
      organizer,
      session.id,
      [
        { user_id: a.id, attendance: 'no_show' },
        { user_id: b.id, attendance: 'no_show' },
        { user_id: c.id, attendance: 'late', late_minutes: 20 },
      ],
      OFFSET_HOURS,
    );

    const res = await settleSession(
      env.DB,
      organizer,
      session.id,
      [
        // Leading padding used to eat the whole 1000-char budget, so fileCase
        // saw ~5 real characters and threw after the session was settled.
        { user_id: a.id, claim: `${' '.repeat(995)}这个人迟到了二十分钟左右呢` },
        // Long enough before trimming the cut, too short after: falls back to the draft.
        { user_id: b.id, claim: `x${' '.repeat(999)}后面的字被截掉了不算数` },
        { user_id: c.id },
      ],
      false,
      noAiEnv(),
      OFFSET_HOURS,
    );

    expect(res.created).toBe(3);
    const records = await listRecords(env.DB, { session: session.id });
    expect(records.find((r) => r.subject.id === a.id)?.claim).toBe('这个人迟到了二十分钟左右呢');
    const bClaim = records.find((r) => r.subject.id === b.id)?.claim ?? '';
    expect(bClaim.startsWith('x')).toBe(false);
    expect(bClaim.length).toBeGreaterThanOrEqual(10);
    expect(records.find((r) => r.subject.id === c.id)?.type).toBe('late_major');
  });

  it('skips a capped 守约 bonus instead of abandoning the rest of the settlement', async () => {
    const { organizer, a, b, c } = await cast();
    await env.DB.prepare('UPDATE users SET score = 80 WHERE id = ?').bind(organizer.id).run();
    await env.DB.prepare('UPDATE users SET score = 90 WHERE id = ?').bind(b.id).run();
    // b has already banked this week's whole bonus allowance.
    await env.DB.prepare(
      `INSERT INTO records (subject_id, reporter_id, type, delta, status)
       VALUES (?, ?, 'on_time_bonus', ?, 'decided')`,
    )
      .bind(b.id, organizer.id, WEEKLY_BONUS_CAP)
      .run();

    const session = await startedSession(organizer, [a, b, c]);
    await rollCall(
      env.DB,
      organizer,
      session.id,
      [
        { user_id: b.id, attendance: 'on_time' },
        { user_id: a.id, attendance: 'no_show' },
        { user_id: c.id, attendance: 'late', late_minutes: 20 },
        { user_id: organizer.id, attendance: 'on_time' },
      ],
      OFFSET_HOURS,
    );

    // b's capped bonus comes FIRST: the cap used to throw here, after the
    // session was already marked settled, so a and c were never filed.
    const res = await settleSession(
      env.DB,
      organizer,
      session.id,
      [{ user_id: b.id }, { user_id: a.id }, { user_id: c.id }],
      false,
      noAiEnv(),
      OFFSET_HOURS,
    );

    expect(res.created).toBe(2);
    expect(res.session.status).toBe('settled');
    const records = await listRecords(env.DB, { session: session.id });
    expect(records.find((r) => r.subject.id === a.id)?.type).toBe('no_show');
    expect(records.find((r) => r.subject.id === c.id)?.type).toBe('late_major');
    expect(records.some((r) => r.subject.id === b.id)).toBe(false);
    expect(await scoreOf(b.id)).toBe(90);
    // The organizer bonus is awarded after the loop, so it used to be lost too.
    expect(await scoreOf(organizer.id)).toBe(80 + VIOLATION_MAP.organizer_bonus.base);
  });

  it('allows the one legitimate escalation: no-show → group wipe', async () => {
    const { organizer, a, session } = await rolled();
    const res = await settleSession(
      env.DB,
      organizer,
      session.id,
      [{ user_id: a.id, type: 'no_show_group' }],
      false,
      noAiEnv(),
      OFFSET_HOURS,
    );
    expect(res.created).toBe(1);
    const filed = (await listRecords(env.DB, { session: session.id })).find(
      (r) => r.subject.id === a.id,
    );
    expect(filed?.type).toBe('no_show_group');
  });

  it('is idempotent — a second settle is rejected outright', async () => {
    const { organizer, session } = await rolled();
    await settleSession(env.DB, organizer, session.id, [], true, noAiEnv(), OFFSET_HOURS);
    await expect(
      settleSession(env.DB, organizer, session.id, [], true, noAiEnv(), OFFSET_HOURS),
    ).rejects.toThrow(/已经结算/);
  });

  it('lets a non-judge organizer file inside their own session', async () => {
    // The organizer is the only person who was actually there, so they hold a
    // session-scoped judging right. Bounded to this session's signed-up players.
    const plain = await seedUser({ id: 'plain-org' });
    const a = await seedUser({ id: 'a' });
    const b = await seedUser({ id: 'b' });
    const session = await startedSession(plain, [a, b]);
    await rollCall(
      env.DB,
      plain,
      session.id,
      [
        { user_id: a.id, attendance: 'no_show' },
        { user_id: b.id, attendance: 'on_time' },
      ],
      OFFSET_HOURS,
    );

    const res = await settleSession(
      env.DB,
      plain,
      session.id,
      [{ user_id: a.id }],
      false,
      noAiEnv(),
      OFFSET_HOURS,
    );
    expect(res.created).toBe(1);
  });

  it('honours SESSION_ORGANIZER_CAN_FILE=false by refusing to file', async () => {
    const plain = await seedUser({ id: 'plain-org' });
    const a = await seedUser({ id: 'a' });
    const b = await seedUser({ id: 'b' });
    const session = await startedSession(plain, [a, b]);
    await rollCall(
      env.DB,
      plain,
      session.id,
      [
        { user_id: a.id, attendance: 'no_show' },
        { user_id: b.id, attendance: 'on_time' },
      ],
      OFFSET_HOURS,
    );

    const strict = noAiEnv({ SESSION_ORGANIZER_CAN_FILE: 'false' });
    await expect(
      settleSession(env.DB, plain, session.id, [{ user_id: a.id }], false, strict, OFFSET_HOURS),
    ).rejects.toThrow(/裁判权限/);
    // Recording attendance without filing still works with the switch off.
    await expect(
      settleSession(env.DB, plain, session.id, [], true, strict, OFFSET_HOURS),
    ).resolves.toMatchObject({ created: 0 });
  });

  it('refuses to settle a cancelled session', async () => {
    const { organizer } = await cast();
    const session = await createSession(env.DB, organizer, { title: 'x', starts_at: FUTURE }, OFFSET_HOURS);
    await cancelSession(env.DB, organizer, session.id);
    await expect(
      settleSession(env.DB, organizer, session.id, [], true, noAiEnv(), OFFSET_HOURS),
    ).rejects.toThrow(/已取消/);
  });
});

describe('organizer bonus', () => {
  it('is awarded once the session provably happened', async () => {
    const { organizer, a, b } = await cast();
    await env.DB.prepare('UPDATE users SET score = 80 WHERE id = ?').bind(organizer.id).run();
    const session = await startedSession(organizer, [a, b]);
    await rollCall(
      env.DB,
      organizer,
      session.id,
      [
        { user_id: a.id, attendance: 'on_time' },
        { user_id: b.id, attendance: 'late', late_minutes: 5 },
      ],
      OFFSET_HOURS,
    );

    await settleSession(env.DB, organizer, session.id, [], true, noAiEnv(), OFFSET_HOURS);
    expect(await scoreOf(organizer.id)).toBe(80 + VIOLATION_MAP.organizer_bonus.base);
  });

  it('is withheld when nobody actually turned up — no farming empty lobbies', async () => {
    const { organizer, a, b } = await cast();
    await env.DB.prepare('UPDATE users SET score = 80 WHERE id = ?').bind(organizer.id).run();
    const session = await startedSession(organizer, [a, b]);
    await rollCall(
      env.DB,
      organizer,
      session.id,
      [
        { user_id: a.id, attendance: 'no_show' },
        { user_id: b.id, attendance: 'no_show' },
      ],
      OFFSET_HOURS,
    );

    await settleSession(env.DB, organizer, session.id, [], true, noAiEnv(), OFFSET_HOURS);
    expect(await scoreOf(organizer.id)).toBe(80);
  });

  it('respects the weekly bonus cap', async () => {
    const { organizer, a, b } = await cast();
    await env.DB.prepare('UPDATE users SET score = 50 WHERE id = ?').bind(organizer.id).run();

    const rounds = Math.ceil(WEEKLY_BONUS_CAP / VIOLATION_MAP.organizer_bonus.base) + 2;
    for (let i = 0; i < rounds; i += 1) {
      const session = await startedSession(organizer, [a, b]);
      await rollCall(
        env.DB,
        organizer,
        session.id,
        [
          { user_id: a.id, attendance: 'on_time' },
          { user_id: b.id, attendance: 'on_time' },
        ],
        OFFSET_HOURS,
      );
      await settleSession(env.DB, organizer, session.id, [], true, noAiEnv(), OFFSET_HOURS);
    }

    expect(await scoreOf(organizer.id)).toBeLessThanOrEqual(50 + WEEKLY_BONUS_CAP);
  });
});

describe('listSessions', () => {
  it('separates upcoming from past and hides cancelled ones from upcoming', async () => {
    const { organizer } = await cast();
    const soon = await createSession(env.DB, organizer, { title: '将来', starts_at: FUTURE }, OFFSET_HOURS);
    const gone = await createSession(env.DB, organizer, { title: '过去', starts_at: FUTURE }, OFFSET_HOURS);
    await env.DB.prepare('UPDATE game_sessions SET starts_at = ? WHERE id = ?')
      .bind(PAST, gone.id)
      .run();
    const dead = await createSession(env.DB, organizer, { title: '取消', starts_at: FUTURE }, OFFSET_HOURS);
    await cancelSession(env.DB, organizer, dead.id);

    const upcoming = await listSessions(env.DB, 'upcoming', organizer.id);
    expect(upcoming.map((s) => s.id)).toEqual([soon.id]);

    const past = await listSessions(env.DB, 'past', organizer.id);
    expect(past.map((s) => s.id)).toEqual([gone.id]);
  });

  it('reports the caller’s own rsvp on each row', async () => {
    const { organizer, a } = await cast();
    const session = await createSession(env.DB, organizer, { title: 'x', starts_at: FUTURE }, OFFSET_HOURS);
    await setRsvp(env.DB, a, session.id, 'maybe');

    const forA = await listSessions(env.DB, 'upcoming', a.id);
    expect(forA[0].my_rsvp).toBe('maybe');
    const anon = await listSessions(env.DB, 'upcoming', null);
    expect(anon[0].my_rsvp).toBeNull();
  });
});
