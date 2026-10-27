import { afterEach, describe, expect, it } from 'vitest';
import { MAX_INVITES } from '../../shared/attendance';
import { BOARD_SLOT_MIN_LEAD_MS, synthesizeTitle } from '../../shared/quickTime';
import { AGAIN_STEP_MS } from '../../src/lib/constants';
import { againPrefill } from '../../src/lib/sessionAgain';
import type { SessionDetail, SessionPlayer } from '../../src/types';

const NOW = Date.parse('2026-10-28T12:00:00Z');
const START = '2026-10-28T13:00:00Z';
const TZ = process.env.TZ;
function player(id: string, rsvp: SessionPlayer['rsvp'] = 'going'): SessionPlayer {
  return { user: { id, username: id, avatar_url: null }, rsvp, rsvp_at: START, attendance: 'on_time',
    late_minutes: null, attendance_note: '旧说明不复制', record_id: null, is_participant: true };
}
function detail(patch: Partial<SessionDetail> = {}): SessionDetail {
  return { id: 5, organizer: { id: 'me', username: '我', avatar_url: null }, title: '周三五排', game: '无畏契约',
    starts_at: START, duration_min: 90, capacity: 5, note: '旧备注不复制', status: 'settled', settled_at: START,
    created_at: '2026-10-01 00:00:00', counts: { going: 3, invited: 1, maybe: 1, out: 1 }, my_rsvp: 'going',
    players: [player('me'), player('a'), player('b', 'maybe'), player('c', 'invited'), player('out', 'out')], ...patch };
}
afterEach(() => { if (TZ === undefined) delete process.env.TZ; else process.env.TZ = TZ; });

describe('againPrefill', () => {
  it('copies only the reusable settings and the roster except myself and out', () => {
    expect(againPrefill(detail(), 'me', NOW)).toEqual({ invite: ['a', 'b', 'c'], startsAt: '2026-11-04T13:00:00.000Z',
      game: '无畏契约', capacity: 5, durationMin: 90, title: '周三五排' });
  });
  it('never copies a synthesized title, public note or attendance fields', () => {
    const prefill = againPrefill(detail({ title: synthesizeTitle(START, 8) }), 'me', NOW);
    expect(prefill).not.toHaveProperty('title');
    expect(prefill).not.toHaveProperty('note');
    expect(prefill).not.toHaveProperty('players');
    expect(prefill).not.toHaveProperty('attendance');
  });
  it('starts at least one week later, even if the old start is still in the future', () => {
    expect(againPrefill(detail(), 'me', NOW).startsAt).toBe('2026-11-04T13:00:00.000Z');
  });
  it('adds whole weeks until strictly beyond the minimum lead boundary', () => {
    const original = NOW + BOARD_SLOT_MIN_LEAD_MS - 3 * AGAIN_STEP_MS;
    const result = againPrefill(detail({ starts_at: new Date(original).toISOString() }), 'me', NOW);
    expect(Date.parse(result.startsAt)).toBe(NOW + BOARD_SLOT_MIN_LEAD_MS + AGAIN_STEP_MS);
  });
  it('keeps an offered repeat when it is just beyond that boundary', () => {
    const original = NOW + BOARD_SLOT_MIN_LEAD_MS + 1 - AGAIN_STEP_MS;
    expect(Date.parse(againPrefill(detail({ starts_at: new Date(original).toISOString() }), 'me', NOW).startsAt))
      .toBe(NOW + BOARD_SLOT_MIN_LEAD_MS + 1);
  });
  it('caps invites at MAX_INVITES in roster order without mutating the input', () => {
    const d = detail({ players: [player('me'), ...Array.from({ length: MAX_INVITES + 3 }, (_, i) => player(`p${i}`))] });
    const before = structuredClone(d);
    expect(againPrefill(d, 'me', NOW).invite).toEqual(Array.from({ length: MAX_INVITES }, (_, i) => `p${i}`));
    expect(d).toEqual(before);
  });
  it('preserves nullable settings and permits an empty invite list', () => {
    const result = againPrefill(detail({ game: null, capacity: null, duration_min: null, players: [player('me')] }), 'me', NOW);
    expect(result).toMatchObject({ game: null, capacity: null, durationMin: null, invite: [] });
  });
  it.each(['Asia/Shanghai', 'UTC', 'America/Los_Angeles'])('reads SQL timestamps as UTC in %s', (zone) => {
    process.env.TZ = zone;
    expect(againPrefill(detail({ starts_at: '2026-10-28 13:00:00' }), 'me', NOW).startsAt)
      .toBe('2026-11-04T13:00:00.000Z');
  });
});
