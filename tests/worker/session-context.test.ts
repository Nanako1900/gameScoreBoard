// P2-3 (spec §8 B2-3 ①②③): what a move leaves behind for each person — what
// they had said, and to which time — and a cancel's reason. Runs on D1 here and,
// unchanged, on PostgreSQL (vitest.pg.config.ts), so both engines agree.

import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { SESSION_CANCEL_REASON_MAX } from '../../shared/attendance';
import {
  cancelSession,
  createSession,
  getSessionDetail,
  listMyInvites,
  listSessions,
  setRsvp,
  updateSession,
} from '../../worker/sessions';
import type { User } from '../../worker/types';
import { OFFSET_HOURS, seedUser } from './helpers';

const HOUR_MS = 3_600_000;

/** Whole-minute instant `hours` from now, so ISO round-trips are exact. */
function minuteFromNow(hours: number): string {
  return new Date(Math.floor((Date.now() + hours * HOUR_MS) / 60_000) * 60_000).toISOString();
}

interface Cast {
  org: User;
  a: User;
  b: User;
  c: User;
  d: User;
}

async function cast(): Promise<Cast> {
  return {
    org: await seedUser({ id: 'org' }),
    a: await seedUser({ id: 'a' }),
    b: await seedUser({ id: 'b' }),
    c: await seedUser({ id: 'c' }),
    d: await seedUser({ id: 'd' }),
  };
}

interface ContextRow {
  user_id: string;
  rsvp: string;
  prev_rsvp: string | null;
  prev_starts_at: string | null;
}

async function contextRows(sessionId: number): Promise<ContextRow[]> {
  const rows = await env.DB.prepare(
    `SELECT user_id, rsvp, prev_rsvp, prev_starts_at
       FROM session_players WHERE session_id = ? ORDER BY user_id`,
  )
    .bind(sessionId)
    .all<ContextRow>();
  return rows.results;
}

async function cancelColumns(id: number): Promise<{ cancel_reason: string | null; cancelled_at: string | null } | null> {
  return env.DB.prepare('SELECT cancel_reason, cancelled_at FROM game_sessions WHERE id = ?')
    .bind(id)
    .first<{ cancel_reason: string | null; cancelled_at: string | null }>();
}

describe('the P2-3 columns', () => {
  it('start empty on a new session and on every new row of its roster', async () => {
    const { org, a } = await cast();
    const session = await createSession(env.DB, org, { starts_at: minuteFromNow(3), invite: [a.id] }, OFFSET_HOURS);
    expect(await cancelColumns(session.id)).toEqual({ cancel_reason: null, cancelled_at: null });
    expect(await contextRows(session.id)).toEqual([
      { user_id: 'a', rsvp: 'invited', prev_rsvp: null, prev_starts_at: null },
      { user_id: 'org', rsvp: 'going', prev_rsvp: null, prev_starts_at: null },
    ]);
  });
});

describe('cancelSession with a reason', () => {
  const SQLITE_NOW = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

  it('keeps the reason, trimmed and cut to SESSION_CANCEL_REASON_MAX, and when it was cancelled', async () => {
    const { org } = await cast();
    const session = await createSession(env.DB, org, { starts_at: minuteFromNow(3) }, OFFSET_HOURS);
    const long = `  ${'加'.repeat(SESSION_CANCEL_REASON_MAX + 5)}  `;
    const out = await cancelSession(env.DB, org, session.id, long);
    expect(out.status).toBe('cancelled');
    expect(out.cancel_reason).toBe('加'.repeat(SESSION_CANCEL_REASON_MAX));
    expect(out.cancelled_at).toMatch(SQLITE_NOW);
    expect(await cancelColumns(session.id)).toEqual({ cancel_reason: out.cancel_reason, cancelled_at: out.cancelled_at });
  });

  it('stores no reason for none, a blank one, or one that is not text — and still cancels', async () => {
    const { org } = await cast();
    for (const raw of [undefined, null, '   \n ', 42, { text: '临时加班' }]) {
      const session = await createSession(env.DB, org, { starts_at: minuteFromNow(3) }, OFFSET_HOURS);
      const out = await cancelSession(env.DB, org, session.id, raw);
      expect(out.status, String(raw)).toBe('cancelled');
      expect(out.cancel_reason, String(raw)).toBeNull();
      expect(out.cancelled_at, String(raw)).toMatch(SQLITE_NOW);
    }
  });

  it('cancelling again changes nothing: the first reason and time stay', async () => {
    const { org } = await cast();
    const session = await createSession(env.DB, org, { starts_at: minuteFromNow(3) }, OFFSET_HOURS);
    const first = await cancelSession(env.DB, org, session.id, '临时加班，改天');
    const again = await cancelSession(env.DB, org, session.id, '换个理由');
    expect(again.cancel_reason).toBe('临时加班，改天');
    expect(again.cancelled_at).toBe(first.cancelled_at);
  });

  it('every SessionItem carries both fields: null while open, the reason once cancelled', async () => {
    const { org, a } = await cast();
    const session = await createSession(env.DB, org, { starts_at: minuteFromNow(3), invite: [a.id] }, OFFSET_HOURS);
    const [open] = await listSessions(env.DB, 'upcoming', null);
    expect(open).toMatchObject({ id: session.id, cancel_reason: null, cancelled_at: null });
    expect((await listMyInvites(env.DB, a.id))[0]).toMatchObject({ cancel_reason: null, cancelled_at: null });

    await cancelSession(env.DB, org, session.id, '下雨');
    const [mine] = await listSessions(env.DB, 'mine', a.id);
    expect(mine).toMatchObject({ id: session.id, status: 'cancelled', cancel_reason: '下雨' });
    expect(mine.cancelled_at).toMatch(SQLITE_NOW);
    expect((await getSessionDetail(env.DB, session.id, null)).cancel_reason).toBe('下雨');
  });
});
