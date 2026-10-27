import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { synthesizeTitle } from '../../shared/quickTime';
import { MAX_INVITES as SHARED_MAX_INVITES, MAX_SESSION_ROSTER } from '../../shared/attendance';
import {
  MAX_INVITES,
  cancelSession,
  createSession,
  getSessionDetail,
  listMyInvites,
  setRsvp,
} from '../../worker/sessions';
import { inviteToSession } from '../../worker/session-invites';
import type { SessionDetail, User } from '../../worker/types';
import { OFFSET_HOURS, seedUser } from './helpers';

const FUTURE = new Date(Date.now() + 3 * 3_600_000).toISOString();
const PAST = new Date(Date.now() - 3 * 3_600_000).toISOString();

async function cast() {
  return {
    organizer: await seedUser({ id: 'org' }),
    a: await seedUser({ id: 'a' }),
    b: await seedUser({ id: 'b' }),
    c: await seedUser({ id: 'c' }),
  };
}

describe('createSession — v3 minimal input', () => {
  it('synthesises the title from the time when none is given', async () => {
    const { organizer } = await cast();
    const s = await createSession(env.DB, organizer, { starts_at: FUTURE }, OFFSET_HOURS);
    expect(s.title).toBe(synthesizeTitle(FUTURE, OFFSET_HOURS));
    expect(s.title).toMatch(/开黑$/);
  });

  it('still honours an explicit title', async () => {
    const { organizer } = await cast();
    const s = await createSession(
      env.DB,
      organizer,
      { starts_at: FUTURE, title: '排位之夜' },
      OFFSET_HOURS,
    );
    expect(s.title).toBe('排位之夜');
  });

  it('works with nothing but a time — no game, duration or capacity', async () => {
    const { organizer } = await cast();
    const s = await createSession(env.DB, organizer, { starts_at: FUTURE }, OFFSET_HOURS);
    expect(s.game).toBeNull();
    expect(s.duration_min).toBeNull();
    expect(s.capacity).toBeNull();
    expect(s.counts.going).toBe(1); // the organizer
  });
});

describe('invites', () => {
  it('puts invitees in `invited`, not `going`', async () => {
    const { organizer, a, b } = await cast();
    const s = await createSession(
      env.DB,
      organizer,
      { starts_at: FUTURE, invite: [a.id, b.id] },
      OFFSET_HOURS,
    );

    expect(s.counts.invited).toBe(2);
    expect(s.counts.going).toBe(1); // only the organizer has actually committed
    const invitedIds = s.players.filter((p) => p.rsvp === 'invited').map((p) => p.user.id);
    expect(invitedIds.sort()).toEqual([a.id, b.id].sort());
  });

  it('ignores an invite for the organizer themselves', async () => {
    const { organizer, a } = await cast();
    const s = await createSession(
      env.DB,
      organizer,
      { starts_at: FUTURE, invite: [organizer.id, a.id] },
      OFFSET_HOURS,
    );
    expect(s.counts.invited).toBe(1);
    expect(s.players.find((p) => p.user.id === organizer.id)?.rsvp).toBe('going');
  });

  it('silently drops unknown user ids instead of failing creation', async () => {
    const { organizer, a } = await cast();
    const s = await createSession(
      env.DB,
      organizer,
      { starts_at: FUTURE, invite: [a.id, 'ghost'] },
      OFFSET_HOURS,
    );
    expect(s.counts.invited).toBe(1);
    expect(s.players.some((p) => p.user.id === 'ghost')).toBe(false);
  });

  it('de-duplicates a repeated invite', async () => {
    const { organizer, a } = await cast();
    const s = await createSession(
      env.DB,
      organizer,
      { starts_at: FUTURE, invite: [a.id, a.id] },
      OFFSET_HOURS,
    );
    expect(s.counts.invited).toBe(1);
  });

  it('rejects a non-array invite list', async () => {
    const { organizer } = await cast();
    await expect(
      createSession(env.DB, organizer, { starts_at: FUTURE, invite: 'a' }, OFFSET_HOURS),
    ).rejects.toThrow(/数组/);
  });

  // The point of a separate `invited` state: invite generously, seat the first N.
  it('does NOT consume a capacity slot', async () => {
    const { organizer, a, b, c } = await cast();
    const s = await createSession(
      env.DB,
      organizer,
      { starts_at: FUTURE, capacity: 2, invite: [a.id, b.id, c.id] },
      OFFSET_HOURS,
    );
    // 3 invited against 2 seats is legal — nothing is taken until someone accepts.
    expect(s.counts.invited).toBe(3);
    expect(s.counts.going).toBe(1);

    // First to answer takes the last seat.
    const afterA = await setRsvp(env.DB, a, s.id, 'going');
    expect(afterA.counts.going).toBe(2);
    // Now it really is full.
    await expect(setRsvp(env.DB, b, s.id, 'going')).rejects.toThrow(/人数已满/);
    // …but they can still decline, which never needed a seat.
    await expect(setRsvp(env.DB, b, s.id, 'out')).resolves.toBeDefined();
  });

  it('answering clears the invite from the caller’s list', async () => {
    const { organizer, a } = await cast();
    const s = await createSession(
      env.DB,
      organizer,
      { starts_at: FUTURE, invite: [a.id] },
      OFFSET_HOURS,
    );

    expect((await listMyInvites(env.DB, a.id)).map((x) => x.id)).toEqual([s.id]);
    await setRsvp(env.DB, a, s.id, 'going');
    expect(await listMyInvites(env.DB, a.id)).toHaveLength(0);
  });

  it('declining also clears it — an answer is an answer', async () => {
    const { organizer, a } = await cast();
    const s = await createSession(
      env.DB,
      organizer,
      { starts_at: FUTURE, invite: [a.id] },
      OFFSET_HOURS,
    );
    await setRsvp(env.DB, a, s.id, 'out');
    expect(await listMyInvites(env.DB, a.id)).toHaveLength(0);
  });

  it('never lists invites for sessions that started or were cancelled', async () => {
    const { organizer, a } = await cast();
    const started = await createSession(
      env.DB,
      organizer,
      { starts_at: FUTURE, invite: [a.id] },
      OFFSET_HOURS,
    );
    await env.DB.prepare('UPDATE game_sessions SET starts_at = ? WHERE id = ?')
      .bind(PAST, started.id)
      .run();

    const dead = await createSession(
      env.DB,
      organizer,
      { starts_at: FUTURE, invite: [a.id] },
      OFFSET_HOURS,
    );
    await cancelSession(env.DB, organizer, dead.id);

    expect(await listMyInvites(env.DB, a.id)).toHaveLength(0);
  });

  it('shows each invitee only their own invites', async () => {
    const { organizer, a, b } = await cast();
    await createSession(env.DB, organizer, { starts_at: FUTURE, invite: [a.id] }, OFFSET_HOURS);
    expect(await listMyInvites(env.DB, a.id)).toHaveLength(1);
    expect(await listMyInvites(env.DB, b.id)).toHaveLength(0);
    expect(await listMyInvites(env.DB, organizer.id)).toHaveLength(0);
  });

  it('an invitee is never silently counted as attending at roll call', async () => {
    const { organizer, a } = await cast();
    const s = await createSession(
      env.DB,
      organizer,
      { starts_at: FUTURE, invite: [a.id] },
      OFFSET_HOURS,
    );
    const detail = await getSessionDetail(env.DB, s.id, organizer.id);
    // No attendance recorded yet, and their rsvp is still unanswered.
    const player = detail.players.find((p) => p.user.id === a.id);
    expect(player?.rsvp).toBe('invited');
    expect(player?.attendance).toBeNull();
  });

  it('rejects `invited` as a self-settable rsvp', async () => {
    const { organizer, a } = await cast();
    const s = await createSession(env.DB, organizer, { starts_at: FUTURE }, OFFSET_HOURS);
    // A player cannot put themselves back into the organizer-assigned state.
    await expect(setRsvp(env.DB, a, s.id, 'invited')).rejects.toThrow(/报名状态/);
  });
});

// --- P2-1: inviting more people after creation (spec §8 B2-1, P2 contract 4.3) ---

describe('inviteToSession — inviting more people after creation', () => {
  const open = (organizer: User, invite: string[] = []): Promise<SessionDetail> =>
    createSession(env.DB, organizer, { starts_at: FUTURE, invite }, OFFSET_HOURS);
  const rsvpOf = (s: SessionDetail, id: string): string | null =>
    s.players.find((p) => p.user.id === id)?.rsvp ?? null;
  const rows = async (sessionId: number) =>
    (
      await env.DB.prepare(
        'SELECT user_id, rsvp, rsvp_at FROM session_players WHERE session_id = ? ORDER BY user_id',
      )
        .bind(sessionId)
        .all()
    ).results;

  /** `n` more people already in the session (straight rows: no limits in the way). */
  async function crowd(sessionId: number, n: number): Promise<void> {
    const statements = Array.from({ length: n }, (_, i) => [
      env.DB.prepare("INSERT INTO users (id, username) VALUES (?, ?)").bind(`crowd${i}`, `crowd${i}`),
      env.DB.prepare("INSERT INTO session_players (session_id, user_id, rsvp) VALUES (?, ?, 'invited')").bind(
        sessionId,
        `crowd${i}`,
      ),
    ]).flat();
    await env.DB.batch(statements);
  }

  it('puts new people in invited, and they find it in their own invites', async () => {
    const { organizer, a, b } = await cast();
    const s = await open(organizer);
    const res = await inviteToSession(env.DB, organizer, s.id, [a.id, b.id]);
    expect(res.added).toBe(2);
    expect(res.skipped).toBe(0);
    expect(rsvpOf(res.session, a.id)).toBe('invited');
    expect(rsvpOf(res.session, b.id)).toBe('invited');
    expect(res.session.counts).toEqual({ invited: 2, going: 1, maybe: 0, out: 0 });
    expect(res.session.my_rsvp).toBe('going');
    expect((await listMyInvites(env.DB, a.id)).map((x) => x.id)).toEqual([s.id]);
  });

  it('never touches a row that is already there: a yes stays a yes, a no stays a no', async () => {
    const { organizer, a, b, c } = await cast();
    const s = await open(organizer, [a.id, b.id, c.id]);
    await setRsvp(env.DB, a, s.id, 'going');
    await setRsvp(env.DB, b, s.id, 'out');
    const before = await rows(s.id);
    const res = await inviteToSession(env.DB, organizer, s.id, [a.id, b.id, c.id]);
    expect(res).toMatchObject({ added: 0, skipped: 3 });
    expect(await rows(s.id)).toEqual(before);
    expect(rsvpOf(res.session, b.id)).toBe('out');
  });

  it('counts an unknown id as skipped instead of failing', async () => {
    const { organizer, a } = await cast();
    const s = await open(organizer);
    const res = await inviteToSession(env.DB, organizer, s.id, [a.id, 'ghost']);
    expect(res).toMatchObject({ added: 1, skipped: 1 });
    expect(res.session.players.some((p) => p.user.id === 'ghost')).toBe(false);
  });

  it("de-duplicates, and drops the session's organizer even when an admin asks", async () => {
    const { organizer, a } = await cast();
    const admin = await seedUser({ id: 'admin', admin: true });
    const s = await open(organizer);
    const res = await inviteToSession(env.DB, admin, s.id, [a.id, a.id, organizer.id]);
    expect(res).toMatchObject({ added: 1, skipped: 0 });
    expect(rsvpOf(res.session, organizer.id)).toBe('going');
    expect(res.session.my_rsvp).toBeNull();
    // Nobody left once the organizer is dropped: nothing to do, and not an error.
    const none = await inviteToSession(env.DB, organizer, s.id, [organizer.id]);
    expect(none).toMatchObject({ added: 0, skipped: 0 });
  });

  it('is for the organizer or an admin: a stranger gets 403, even on a cancelled session', async () => {
    const { organizer, a, b } = await cast();
    const s = await open(organizer);
    await expect(inviteToSession(env.DB, a, s.id, [b.id])).rejects.toMatchObject({
      status: 403,
      message: '只有组织者可以操作这个约局',
    });
    await cancelSession(env.DB, organizer, s.id);
    await expect(inviteToSession(env.DB, a, s.id, [b.id])).rejects.toMatchObject({ status: 403 });
    await expect(inviteToSession(env.DB, organizer, 999_999, [b.id])).rejects.toMatchObject({
      status: 404,
      message: '约局不存在',
    });
  });

  it('refuses a cancelled, a settled and a started session — before reading the list', async () => {
    const { organizer, a } = await cast();
    const closed = '已取消 / 已结算的约局不能再叫人';
    const cancelled = await open(organizer);
    await cancelSession(env.DB, organizer, cancelled.id);
    await expect(inviteToSession(env.DB, organizer, cancelled.id, [a.id])).rejects.toMatchObject({
      status: 400,
      message: closed,
    });
    await expect(inviteToSession(env.DB, organizer, cancelled.id, 'x')).rejects.toMatchObject({ message: closed });

    const settled = await open(organizer);
    await env.DB.prepare("UPDATE game_sessions SET status = 'settled' WHERE id = ?").bind(settled.id).run();
    await expect(inviteToSession(env.DB, organizer, settled.id, [a.id])).rejects.toMatchObject({ message: closed });

    const started = await open(organizer);
    await env.DB.prepare('UPDATE game_sessions SET starts_at = ? WHERE id = ?').bind(PAST, started.id).run();
    await expect(inviteToSession(env.DB, organizer, started.id, [a.id])).rejects.toMatchObject({
      status: 400,
      message: '约局已开始，不能再叫人',
    });
    expect(await listMyInvites(env.DB, a.id)).toHaveLength(0);
  });

  it('checks the list: an array, not empty, real ids, at most MAX_INVITES at once', async () => {
    const { organizer } = await cast();
    const s = await open(organizer);
    const refuse = (raw: unknown, message: string) =>
      expect(inviteToSession(env.DB, organizer, s.id, raw)).rejects.toMatchObject({ status: 400, message });
    await refuse(undefined, 'user_ids 必须是数组');
    await refuse('a', 'user_ids 必须是数组');
    await refuse([], '至少选一个人');
    await refuse([''], 'user_ids 里有无效的用户 ID');
    await refuse([42], 'user_ids 里有无效的用户 ID');
    await refuse(
      Array.from({ length: MAX_INVITES + 1 }, (_, i) => `u${i}`),
      `一次最多邀请 ${MAX_INVITES} 人`,
    );
    // Creating a session still says `invite`.
    await expect(
      createSession(env.DB, organizer, { starts_at: FUTURE, invite: 'a' }, OFFSET_HOURS),
    ).rejects.toMatchObject({ message: 'invite 必须是数组' });
  });

  it(`never grows a roster past ${MAX_SESSION_ROSTER}`, async () => {
    const { organizer, a, b } = await cast();
    const s = await open(organizer);
    await crowd(s.id, MAX_SESSION_ROSTER - 2); // with the organizer: one seat left
    const full = (n: number) => `这局最多 ${MAX_SESSION_ROSTER} 人，已经有 ${n} 人了`;
    await expect(inviteToSession(env.DB, organizer, s.id, [a.id, b.id])).rejects.toMatchObject({
      status: 400,
      message: full(MAX_SESSION_ROSTER - 1),
    });
    expect(rsvpOf(await getSessionDetail(env.DB, s.id, organizer.id), a.id)).toBeNull();
    expect(await inviteToSession(env.DB, organizer, s.id, [a.id])).toMatchObject({ added: 1, skipped: 0 });
    // Someone already in costs nothing, even at the limit.
    expect(await inviteToSession(env.DB, organizer, s.id, [a.id])).toMatchObject({ added: 0, skipped: 1 });
    await expect(inviteToSession(env.DB, organizer, s.id, [b.id])).rejects.toMatchObject({
      message: full(MAX_SESSION_ROSTER),
    });
  });

  it('takes its limits from shared/attendance (worker/sessions re-exports them)', () => {
    expect(MAX_INVITES).toBe(SHARED_MAX_INVITES);
    expect(SHARED_MAX_INVITES).toBe(20);
    expect(MAX_SESSION_ROSTER).toBe(50);
  });
});
