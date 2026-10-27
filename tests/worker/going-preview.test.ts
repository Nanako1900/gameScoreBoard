// P2-6: going_preview — who's coming, on every session card (spec §8 B2-6).
// Lists get it from one batch query per page (worker/session-extras.ts); the
// detail derives it from the roster it already loaded. Names and avatars only,
// never a score. Runs on D1 here and on PostgreSQL in the pg suite.

import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { GOING_PREVIEW_MAX } from '../../shared/attendance';
import { goingPreviews, previewOfPlayers } from '../../worker/session-extras';
import { createSession, getSessionDetail, setRsvp } from '../../worker/sessions';
import type { SessionDetail, User } from '../../worker/types';
import { OFFSET_HOURS, seedUser } from './helpers';

const FUTURE = new Date(Date.now() + 3 * 3_600_000).toISOString();

async function pair(): Promise<{ organizer: User; a: User; b: User }> {
  return {
    organizer: await seedUser({ id: 'org' }),
    a: await seedUser({ id: 'a' }),
    b: await seedUser({ id: 'b' }),
  };
}

/** datetime('now') has one-second resolution: pin answer times so the order is certain. */
async function answeredAt(sessionId: number, userId: string, at: string): Promise<void> {
  await env.DB.prepare('UPDATE session_players SET rsvp_at = ? WHERE session_id = ? AND user_id = ?')
    .bind(at, sessionId, userId)
    .run();
}

/** In answer order, ties broken by id: what every preview of crowdedSession() must show. */
const CROWD_FIRST_FIVE = ['p2', 'p4', 'org', 'p3', 'p1'];

/**
 * Ten people around one session: seven said 来 (org and p1–p6), one 待定 (m),
 * one 不来 (o), one still invited (i). m, o and i answered earliest of all.
 */
async function crowdedSession(): Promise<{ session: SessionDetail; organizer: User; invitee: User }> {
  const organizer = await seedUser({ id: 'org' });
  const going: User[] = [];
  for (const id of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']) going.push(await seedUser({ id }));
  const maybe = await seedUser({ id: 'm' });
  const out = await seedUser({ id: 'o' });
  const invitee = await seedUser({ id: 'i' });
  const session = await createSession(env.DB, organizer, {
    title: '十人局',
    starts_at: FUTURE,
    capacity: 10,
    invite: [invitee.id],
  }, OFFSET_HOURS);
  for (const p of going) await setRsvp(env.DB, p, session.id, 'going');
  await setRsvp(env.DB, maybe, session.id, 'maybe');
  await setRsvp(env.DB, out, session.id, 'out');
  const times: Array<[string, string]> = [
    ['org', '2026-10-20 10:00:03'],
    ['p1', '2026-10-20 10:00:05'],
    ['p2', '2026-10-20 10:00:01'],
    ['p3', '2026-10-20 10:00:03'], // same second as org: the id breaks the tie ('org' < 'p3')
    ['p4', '2026-10-20 10:00:02'],
    ['p5', '2026-10-20 10:00:09'],
    ['p6', '2026-10-20 10:00:07'],
    ['m', '2026-10-20 10:00:00'],
    ['o', '2026-10-20 10:00:00'],
    ['i', '2026-10-20 10:00:00'],
  ];
  for (const [id, at] of times) await answeredAt(session.id, id, at);
  return { session, organizer, invitee };
}

/** A D1 handle that counts the statements it is asked to prepare. */
function counting(): { db: D1Database; prepared: () => number } {
  let n = 0;
  const db = {
    prepare: (sql: string) => {
      n += 1;
      return env.DB.prepare(sql);
    },
  } as unknown as D1Database;
  return { db, prepared: () => n };
}

describe('goingPreviews', () => {
  it('answers for a whole page of sessions in one query, and asks nothing for no sessions', async () => {
    const { organizer, a, b } = await pair();
    const one = await createSession(env.DB, organizer, { title: '一', starts_at: FUTURE }, OFFSET_HOURS);
    const two = await createSession(env.DB, organizer, { title: '二', starts_at: FUTURE }, OFFSET_HOURS);
    const three = await createSession(env.DB, organizer, { title: '三', starts_at: FUTURE }, OFFSET_HOURS);
    await setRsvp(env.DB, a, two.id, 'going');
    await setRsvp(env.DB, b, three.id, 'maybe');
    await answeredAt(two.id, organizer.id, '2026-10-20 10:00:02');
    await answeredAt(two.id, a.id, '2026-10-20 10:00:01');

    const probe = counting();
    const previews = await goingPreviews(probe.db, [one.id, two.id, three.id]);
    expect(probe.prepared()).toBe(1);
    expect(previews.get(one.id)?.map((p) => p.id)).toEqual([organizer.id]);
    expect(previews.get(two.id)?.map((p) => p.id)).toEqual([a.id, organizer.id]);
    expect(previews.get(three.id)?.map((p) => p.id)).toEqual([organizer.id]);

    const idle = counting();
    expect((await goingPreviews(idle.db, [])).size).toBe(0);
    expect(idle.prepared()).toBe(0);
  });

  it(`keeps the first ${GOING_PREVIEW_MAX} who said 来, by answer time then id — never 待定, invited or 不来`, async () => {
    const { session } = await crowdedSession();
    const preview = (await goingPreviews(env.DB, [session.id])).get(session.id);
    expect(preview?.map((p) => p.id)).toEqual(CROWD_FIRST_FIVE);
    expect(preview).toHaveLength(GOING_PREVIEW_MAX);

    // The detail derives the same five from its roster, whatever order it holds them in.
    const detail = await getSessionDetail(env.DB, session.id, null);
    expect(previewOfPlayers([...detail.players].reverse())).toEqual(preview);
  });

  it('carries the display name and the avatar, and nothing else — never a score', async () => {
    const { organizer, a } = await pair();
    await env.DB.prepare('UPDATE users SET display_name = ?, avatar_url = ? WHERE id = ?')
      .bind('阿杰', 'https://cdn.example.com/a.png', a.id)
      .run();
    const session = await createSession(env.DB, organizer, { title: 'x', starts_at: FUTURE }, OFFSET_HOURS);
    await setRsvp(env.DB, a, session.id, 'going');
    await answeredAt(session.id, organizer.id, '2026-10-20 10:00:01');
    await answeredAt(session.id, a.id, '2026-10-20 10:00:02');

    const preview = (await goingPreviews(env.DB, [session.id])).get(session.id) ?? [];
    expect(preview).toEqual([
      { id: organizer.id, username: organizer.username, avatar_url: null },
      { id: a.id, username: '阿杰', avatar_url: 'https://cdn.example.com/a.png' },
    ]);
    for (const person of preview) {
      expect(Object.keys(person).sort()).toEqual(['avatar_url', 'id', 'username']);
    }
  });

  it('leaves out a session nobody is coming to', async () => {
    const { organizer } = await pair();
    const session = await createSession(env.DB, organizer, { title: 'x', starts_at: FUTURE }, OFFSET_HOURS);
    await env.DB.prepare("UPDATE session_players SET rsvp = 'maybe' WHERE session_id = ?")
      .bind(session.id)
      .run();
    expect((await goingPreviews(env.DB, [session.id])).has(session.id)).toBe(false);
    expect(previewOfPlayers((await getSessionDetail(env.DB, session.id, null)).players)).toEqual([]);
  });
});
