import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { synthesizeTitle } from '../../shared/quickTime';
import {
  cancelSession,
  createSession,
  getSessionDetail,
  listMyInvites,
  setRsvp,
} from '../../worker/sessions';
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
