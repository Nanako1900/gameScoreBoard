// P2-2: the list behind GET /api/me/invitable — everyone but the caller, five
// keys each, and when the caller last really played with them (contract §8 #9:
// started, not cancelled, both said 来, neither marked 没来 / 请假). Runs on D1
// and, through vitest.pg.config.ts, on PostgreSQL.

import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { listInvitable } from '../../worker/invitable';
import { seedUser } from './helpers';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const KEYS = ['avatar_url', 'id', 'is_participant', 'last_played_with_me_at', 'username'];

/** An ISO instant `offsetMs` from now — the shape starts_at is stored in. */
function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

interface Seat {
  rsvp?: 'invited' | 'going' | 'maybe' | 'out';
  attendance?: 'on_time' | 'late' | 'no_show' | 'left_early' | 'excused' | null;
}

/** A session organised by `organizer`, with one row per seat (default: said 来, not marked). */
async function sessionWith(
  organizer: string,
  startsAt: string,
  status: 'open' | 'cancelled' | 'settled',
  seats: Record<string, Seat>,
): Promise<void> {
  const created = await env.DB.prepare(
    "INSERT INTO game_sessions (organizer_id, title, starts_at, status) VALUES (?, '测试局', ?, ?)",
  )
    .bind(organizer, startsAt, status)
    .run();
  const sessionId = Number(created.meta.last_row_id);
  for (const [userId, seat] of Object.entries(seats)) {
    await env.DB.prepare(
      'INSERT INTO session_players (session_id, user_id, rsvp, attendance) VALUES (?, ?, ?, ?)',
    )
      .bind(sessionId, userId, seat.rsvp ?? 'going', seat.attendance ?? null)
      .run();
  }
}

async function lastPlayed(callerId: string, userId: string): Promise<string | null | undefined> {
  const users = await listInvitable(env.DB, callerId);
  return users.find((u) => u.id === userId)?.last_played_with_me_at;
}

describe('listInvitable — who is on it', () => {
  it('is everyone but the caller, on the board or not', async () => {
    await seedUser({ id: 'me' });
    await seedUser({ id: 'board' });
    await seedUser({ id: 'friend', participant: false });

    const users = await listInvitable(env.DB, 'me');

    expect(users.map((u) => u.id)).toEqual(['board', 'friend']);
    expect(users.map((u) => u.is_participant)).toEqual([true, false]);
  });

  it('gives five keys and nothing else: no score, no roles, no email', async () => {
    await seedUser({ id: 'me' });
    await seedUser({ id: 'a', judge: true, admin: true, score: 37 });
    await env.DB.prepare(
      "UPDATE users SET email = 'a@example.com', avatar_url = 'https://cdn.example.com/a.png' WHERE id = 'a'",
    ).run();

    const users = await listInvitable(env.DB, 'me');

    expect(users).toHaveLength(1);
    expect(Object.keys(users[0]).sort()).toEqual(KEYS);
    expect(users[0]).toEqual({
      id: 'a',
      username: 'a',
      avatar_url: 'https://cdn.example.com/a.png',
      is_participant: true,
      last_played_with_me_at: null,
    });
    const text = JSON.stringify(users);
    for (const leak of ['score', 'judge', 'admin', 'email', 'a@example.com', '37']) {
      expect(text, leak).not.toContain(leak);
    }
  });

  it('shows the display name when there is one, like the rest of the site', async () => {
    await seedUser({ id: 'me' });
    await seedUser({ id: 'a', username: 'oauth_a' });
    await seedUser({ id: 'b', username: 'oauth_b' });
    await env.DB.prepare("UPDATE users SET display_name = '阿杰' WHERE id = 'a'").run();

    const users = await listInvitable(env.DB, 'me');

    expect(users.map((u) => [u.id, u.username])).toEqual([
      ['b', 'oauth_b'],
      ['a', '阿杰'],
    ]);
  });
});

describe('listInvitable — last_played_with_me_at', () => {
  it('is the start of the latest session we both said 来 to and both turned up for', async () => {
    await seedUser({ id: 'me' });
    await seedUser({ id: 'x' });
    const latest = iso(-1 * DAY);
    await sessionWith('me', iso(-3 * DAY), 'settled', { me: { attendance: 'on_time' }, x: { attendance: 'late' } });
    await sessionWith('x', iso(-2 * DAY), 'settled', { x: { attendance: 'on_time' }, me: { attendance: 'left_early' } });
    // Started, not settled yet, nobody marked: still counts.
    await sessionWith('x', latest, 'open', { x: {}, me: {} });
    // Later, but cancelled: does not count, and does not hide the real one.
    await sessionWith('me', iso(-1 * HOUR), 'cancelled', { me: {}, x: {} });

    expect(await lastPlayed('me', 'x')).toBe(latest);
  });

  const EXCLUDED: [string, { status?: 'open' | 'cancelled'; startsAt?: string; me?: Seat; them?: Seat }][] = [
    ['the session was cancelled', { status: 'cancelled' }],
    ['it has not started yet', { status: 'open', startsAt: iso(3 * HOUR) }],
    ['I only said 待定', { me: { rsvp: 'maybe' } }],
    ['they only said 待定', { them: { rsvp: 'maybe' } }],
    ['they never answered', { them: { rsvp: 'invited' } }],
    ['they said 不来', { them: { rsvp: 'out' } }],
    ['I was marked 没来', { me: { attendance: 'no_show' } }],
    ['I was marked 请假', { me: { attendance: 'excused' } }],
    ['they were marked 没来', { them: { attendance: 'no_show' } }],
    ['they were marked 请假', { them: { attendance: 'excused' } }],
  ];

  it.each(EXCLUDED)('stays null when %s', async (_why, tweak) => {
    await seedUser({ id: 'me' });
    await seedUser({ id: 'x' });
    await sessionWith('me', tweak.startsAt ?? iso(-1 * DAY), tweak.status ?? 'settled', {
      me: tweak.me ?? {},
      x: tweak.them ?? {},
    });

    expect(await lastPlayed('me', 'x')).toBeNull();
  });

  it('counts only sessions the caller was in, not two others playing together', async () => {
    await seedUser({ id: 'me' });
    await seedUser({ id: 'x' });
    await seedUser({ id: 'y' });
    await sessionWith('x', iso(-1 * DAY), 'settled', { x: {}, y: {} });

    const users = await listInvitable(env.DB, 'me');

    expect(users.map((u) => u.last_played_with_me_at)).toEqual([null, null]);
    expect(await lastPlayed('x', 'y')).not.toBeNull();
  });
});

describe('listInvitable — order', () => {
  it('puts who played with me first (latest first), then the board, then by name and id', async () => {
    await seedUser({ id: 'me' });
    await seedUser({ id: 'p-old', username: 'Zed' });
    await seedUser({ id: 'p-new', username: 'Yan', participant: false });
    await seedUser({ id: 'bea', username: 'Bea' });
    await seedUser({ id: 'amy', username: 'Amy' });
    await seedUser({ id: 'q2', username: '同名' });
    await seedUser({ id: 'q1', username: '同名' });
    await seedUser({ id: 'dan', username: 'Dan', participant: false });
    await seedUser({ id: 'cat', username: 'Cat', participant: false });
    await sessionWith('me', iso(-3 * DAY), 'settled', { me: {}, 'p-old': {} });
    await sessionWith('me', iso(-1 * DAY), 'settled', { me: {}, 'p-new': {} });

    const users = await listInvitable(env.DB, 'me');

    expect(users.map((u) => u.id)).toEqual(['p-new', 'p-old', 'amy', 'bea', 'q1', 'q2', 'cat', 'dan']);
  });
});
