import { describe, expect, it } from 'vitest';
import { MAX_OPEN_SESSIONS, MAX_SESSIONS_PER_DAY } from '@shared/attendance';
import { consoleState, gapLine, quotaHint, rosterGap, sessionQuota } from '../../src/lib/sessionConsole';
import type { SessionItem } from '../../src/types';

const NOW = Date.parse('2026-10-28T10:00:00Z');
const HOUR = 3_600_000;
function session(patch: Partial<SessionItem> = {}): SessionItem {
  return { id: 1, organizer: { id: 'org', username: '组织者', avatar_url: null }, title: '五排', game: null,
    starts_at: new Date(NOW + HOUR).toISOString(), duration_min: 60, capacity: 5, note: null, status: 'open',
    settled_at: null, created_at: new Date(NOW - HOUR).toISOString(), counts: { going: 4, invited: 2, maybe: 1, out: 1 },
    my_rsvp: null, ...patch };
}
describe('organizer console rules', () => {
  it('maps upcoming, live, due, settled and cancelled states', () => {
    expect(consoleState(session(), NOW)).toBe('before');
    expect(consoleState(session({ starts_at: new Date(NOW).toISOString() }), NOW)).toBe('live');
    expect(consoleState(session({ starts_at: new Date(NOW - HOUR).toISOString() }), NOW)).toBe('due');
    expect(consoleState(session({ status: 'settled' }), NOW)).toBe('settled');
    expect(consoleState(session({ status: 'cancelled' }), NOW)).toBe('cancelled');
  });
  it('counts missing places and unanswered invitations, with no negative gap', () => {
    expect(rosterGap(session())).toEqual({ missing: 1, pending: 2 });
    expect(rosterGap(session({ capacity: 3 }))).toEqual({ missing: 0, pending: 2 });
    expect(rosterGap(session({ capacity: null }))).toEqual({ missing: null, pending: 2 });
  });
  it('describes gaps, full rosters and unlimited sessions without empty parts', () => {
    expect(gapLine(session())).toBe('还差 1 人满员 · 2 人还没回');
    expect(gapLine(session({ capacity: 4 }))).toBe('4/4 到齐，就等开打 🎉');
    expect(gapLine(session({ capacity: null }))).toBe('2 人还没回');
    expect(gapLine(session({ capacity: null, counts: { going: 2, invited: 0, maybe: 1, out: 0 } }))).toBeNull();
  });
  it('quota counts only my upcoming open sessions, and all my creates in the rolling 24 hours', () => {
    const mine = [session(), session({ status: 'cancelled' }), session({ starts_at: new Date(NOW - HOUR).toISOString() }),
      session({ created_at: new Date(NOW - 25 * HOUR).toISOString() }), session({ organizer: { id: 'other', username: '', avatar_url: null } })];
    expect(sessionQuota(mine, 'org', NOW)).toEqual({ openLeft: MAX_OPEN_SESSIONS - 2, dayLeft: MAX_SESSIONS_PER_DAY - 3 });
    expect(sessionQuota(Array.from({ length: 20 }, () => session()), 'org', NOW)).toEqual({ openLeft: 0, dayLeft: 0 });
    expect(sessionQuota([session({ created_at: new Date(NOW - 24 * HOUR).toISOString() })], 'org', NOW).dayLeft).toBe(MAX_SESSIONS_PER_DAY - 1);
  });
  it('shows only the tighter low quota, choosing open quota for ties', () => {
    expect(quotaHint({ openLeft: 2, dayLeft: 2 })).toBeNull();
    expect(quotaHint({ openLeft: 1, dayLeft: 2 })).toBe(`你还能再开 1 个局（同时最多 ${MAX_OPEN_SESSIONS} 个还没开的）`);
    expect(quotaHint({ openLeft: 2, dayLeft: 1 })).toBe('24 小时内还能再发起 1 个');
    expect(quotaHint({ openLeft: 0, dayLeft: 0 })).toBe(`同时最多 ${MAX_OPEN_SESSIONS} 个还没开的局，你已经满了`);
    expect(quotaHint({ openLeft: 1, dayLeft: 0 })).toBe(`24 小时内最多发起 ${MAX_SESSIONS_PER_DAY} 个，你已经满了`);
  });
});
