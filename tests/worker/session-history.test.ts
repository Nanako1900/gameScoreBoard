// P2-3 (spec §3.4, §8 B2-3 ④): GET /api/sessions?scope=history — sessions that
// have started, cancelled ones included, newest first, each with its roll-call
// counts, paged by `before=<id>`. Runs on D1 here and, unchanged, on PostgreSQL.

import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { SESSION_HISTORY_PAGE, type Attendance, type Rsvp, type SessionStatus } from '../../shared/attendance';
import { createSession, listSessionHistory, listSessions } from '../../worker/sessions';
import { OFFSET_HOURS, seedUser } from './helpers';

const HOUR_MS = 3_600_000;

/** Whole-minute ISO instant `hours` from now (negative: in the past). */
function hoursFromNow(hours: number): string {
  return new Date(Math.floor((Date.now() + hours * HOUR_MS) / 60_000) * 60_000).toISOString();
}

interface PastPlayer {
  rsvp: Rsvp;
  attendance?: Attendance;
}

interface PastSession {
  startsAt: string;
  status?: SessionStatus;
  cancelReason?: string;
  /** user id → their answer and (optionally) what roll call said. The organizer is always going. */
  players?: Record<string, PastPlayer>;
}

/** A session that already started — createSession refuses those, so it is written directly. */
async function pastSession(organizerId: string, spec: PastSession): Promise<number> {
  const res = await env.DB.prepare(
    `INSERT INTO game_sessions (organizer_id, title, starts_at, status, cancel_reason)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(organizerId, `局 ${spec.startsAt}`, spec.startsAt, spec.status ?? 'settled', spec.cancelReason ?? null)
    .run();
  const id = Number(res.meta.last_row_id);
  const players: Record<string, PastPlayer> = { [organizerId]: { rsvp: 'going' }, ...spec.players };
  for (const [userId, p] of Object.entries(players)) {
    await env.DB.prepare('INSERT INTO session_players (session_id, user_id, rsvp, attendance) VALUES (?, ?, ?, ?)')
      .bind(id, userId, p.rsvp, p.attendance ?? null)
      .run();
  }
  return id;
}

const ZEROS = { on_time: 0, late: 0, no_show: 0, left_early: 0, excused: 0 };

describe('listSessionHistory', () => {
  it('lists started sessions newest first — cancelled ones too — and none still ahead', async () => {
    const org = await seedUser({ id: 'org' });
    const ahead = await createSession(env.DB, org, { starts_at: hoursFromNow(3) }, OFFSET_HOURS);
    const settled = await pastSession('org', { startsAt: hoursFromNow(-30) });
    const cancelled = await pastSession('org', { startsAt: hoursFromNow(-5), status: 'cancelled', cancelReason: '临时加班，改天' });
    const underWay = await pastSession('org', { startsAt: hoursFromNow(-1), status: 'open' });

    const history = await listSessionHistory(env.DB, null, null);
    expect(history.map((s) => s.id)).toEqual([underWay, cancelled, settled]);
    expect(history.map((s) => s.id)).not.toContain(ahead.id);
    expect(history[1]).toMatchObject({ status: 'cancelled', cancel_reason: '临时加班，改天' });
  });

  it('counts roll call by kind: all five keys, zeros included', async () => {
    await seedUser({ id: 'org' });
    for (const id of ['a', 'b', 'c', 'd']) await seedUser({ id });
    const called = await pastSession('org', {
      startsAt: hoursFromNow(-30),
      players: {
        a: { rsvp: 'going', attendance: 'on_time' },
        b: { rsvp: 'going', attendance: 'late' },
        c: { rsvp: 'going', attendance: 'no_show' },
        d: { rsvp: 'maybe' },
      },
    });
    await env.DB.prepare("UPDATE session_players SET attendance = 'on_time' WHERE session_id = ? AND user_id = 'org'")
      .bind(called)
      .run();
    const uncalled = await pastSession('org', { startsAt: hoursFromNow(-2), status: 'open', players: { a: { rsvp: 'going' } } });

    const history = await listSessionHistory(env.DB, null, null);
    const byId = new Map(history.map((s) => [s.id, s.attendance_summary]));
    expect(byId.get(called)).toEqual({ ...ZEROS, on_time: 2, late: 1, no_show: 1 });
    expect(byId.get(uncalled)).toEqual(ZEROS);
  });

  it(`pages by before=<id>, ${SESSION_HISTORY_PAGE} a page: ties on one instant broken by id, nothing twice`, async () => {
    await seedUser({ id: 'org' });
    const tie = hoursFromNow(-150);
    const ids: number[] = [];
    for (let i = 0; i < SESSION_HISTORY_PAGE + 3; i += 1) {
      // Two oldest, then three sharing one start, then the rest: newest first,
      // the first page ends inside the tie.
      const startsAt = i < 2 ? hoursFromNow(-200 + i) : i < 5 ? tie : hoursFromNow(-100 + i);
      ids.push(await pastSession('org', { startsAt }));
    }

    const first = await listSessionHistory(env.DB, null, null);
    expect(first).toHaveLength(SESSION_HISTORY_PAGE);
    expect(first.slice(-2).map((s) => s.starts_at)).toEqual([tie, tie]);
    const second = await listSessionHistory(env.DB, null, first[first.length - 1].id);
    const seen = [...first, ...second].map((s) => s.id);
    expect(second).toHaveLength(3);
    expect(new Set(seen).size).toBe(ids.length);
    expect([...seen].sort((x, y) => x - y)).toEqual(ids);
    const order = [...first, ...second].map((s) => [s.starts_at, s.id] as const);
    for (let i = 1; i < order.length; i += 1) {
      const [prevAt, prevId] = order[i - 1];
      const [at, id] = order[i];
      expect(prevAt > at || (prevAt === at && prevId > id), `${prevAt}#${prevId} before ${at}#${id}`).toBe(true);
    }
    expect(await listSessionHistory(env.DB, null, second[second.length - 1].id)).toEqual([]);
  });

  it('gives an empty page for a cursor that does not exist', async () => {
    await seedUser({ id: 'org' });
    await pastSession('org', { startsAt: hoursFromNow(-3) });
    expect(await listSessionHistory(env.DB, null, 999_999)).toEqual([]);
  });

  it('carries the caller’s own answer, going_preview and the cancel fields like every list', async () => {
    await seedUser({ id: 'org' });
    await seedUser({ id: 'a' });
    const id = await pastSession('org', { startsAt: hoursFromNow(-3), players: { a: { rsvp: 'maybe' } } });
    const [asA] = await listSessionHistory(env.DB, 'a', null);
    expect(asA).toMatchObject({ id, my_rsvp: 'maybe', cancel_reason: null, cancelled_at: null });
    expect(asA.going_preview.map((p) => p.id)).toEqual(['org']);
    const [asNobody] = await listSessionHistory(env.DB, null, null);
    expect(asNobody.my_rsvp).toBeNull();
  });

  it('leaves scope=past as it was: no cancelled sessions, no attendance_summary', async () => {
    await seedUser({ id: 'org' });
    const settled = await pastSession('org', { startsAt: hoursFromNow(-30) });
    await pastSession('org', { startsAt: hoursFromNow(-5), status: 'cancelled' });
    const past = await listSessions(env.DB, 'past', null);
    expect(past.map((s) => s.id)).toEqual([settled]);
    expect(past[0]).not.toHaveProperty('attendance_summary');
  });
});
