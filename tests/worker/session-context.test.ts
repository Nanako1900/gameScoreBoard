// P2-3 (spec §8 B2-3 ①②③): what a move leaves behind for each person — what
// they had said, and to which time — and a cancel's reason. Runs on D1 here and,
// unchanged, on PostgreSQL (vitest.pg.config.ts), so both engines agree.

import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
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
