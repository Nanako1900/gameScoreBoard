import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_DURATION_MIN } from '../../shared/attendance';
import { LOBBY_CANCELLED_KEEP_MS } from '../../src/lib/constants';
import { lobbyTimeline, mergeSessions, patchSession, sessionEndsAt, sessionPhase } from '../../src/lib/lobbySessions';
import { clockOn, dayStartOn, weekStartOn } from '../../src/lib/time';
import type { SessionItem } from '../../src/types';

const START = Date.parse('2026-10-26T12:00:00Z');
const MINUTE = 60_000;
const TZ = process.env.TZ;
const item = (patch: Partial<SessionItem> = {}): SessionItem => ({
  id: 1, organizer: { id: 'org', username: '组织者', avatar_url: null }, title: '五排', game: null,
  starts_at: new Date(START).toISOString(), duration_min: null, capacity: null, note: null,
  status: 'open', settled_at: null, created_at: '2026-10-26 01:00:00',
  counts: { invited: 1, going: 1, maybe: 0, out: 0 }, my_rsvp: null, ...patch,
});
afterEach(() => { if (TZ === undefined) delete process.env.TZ; else process.env.TZ = TZ; });

describe('session phase and immutable merging', () => {
  it('uses the default duration, with exact start and end boundaries', () => {
    const s = item();
    expect(sessionEndsAt(s)).toBe(START + DEFAULT_DURATION_MIN * MINUTE);
    expect(sessionPhase(s, START - 1)).toBe('upcoming');
    expect(sessionPhase(s, START)).toBe('live');
    expect(sessionPhase(s, sessionEndsAt(s) - 1)).toBe('live');
    expect(sessionPhase(s, sessionEndsAt(s))).toBe('due');
  });
  it('uses an explicit duration; cancelled and settled override the clock', () => {
    expect(sessionEndsAt(item({ duration_min: 45 }))).toBe(START + 45 * MINUTE);
    expect(sessionPhase(item({ status: 'cancelled' }), START)).toBe('cancelled');
    expect(sessionPhase(item({ status: 'settled' }), START - 1)).toBe('settled');
  });
  it('deduplicates by id, first list wins and null means empty', () => {
    const first = Object.freeze(item());
    expect(mergeSessions(null, [first], [item({ title: '旧的' }), item({ id: 2 })])).toEqual([first, item({ id: 2 })]);
  });
  it('patches a row without losing extra fields, inserts missing rows, and leaves inputs alone', () => {
    const original = Object.freeze({ ...item(), extra: '保留' });
    const list = Object.freeze([original]);
    const updated = patchSession(list, item({ title: '新时间' }));
    expect(updated[0]).toMatchObject({ title: '新时间', extra: '保留' });
    expect(original.title).toBe('五排');
    expect(patchSession([item()], item({ id: 2 }))).toHaveLength(2);
  });
});

describe.each(['Asia/Shanghai', 'UTC', 'America/Los_Angeles'])('board timeline in process %s', (zone) => {
  it('groups in display order and sorts by start then id without changing input', () => {
    process.env.TZ = zone;
    const now = START;
    const tomorrow = Date.parse('2026-10-27T12:00:00Z');
    const nextMonday = Date.parse('2026-11-01T16:00:00Z');
    const rows = Object.freeze([
      item({ id: 5, starts_at: new Date(nextMonday).toISOString() }),
      item({ id: 3, starts_at: new Date(tomorrow).toISOString() }),
      item({ id: 2, starts_at: new Date(START + MINUTE).toISOString() }), item(),
      item({ id: 6, status: 'cancelled' }), item({ id: 7, status: 'settled' }),
      item({ id: 8, starts_at: new Date(START - 3 * 60 * MINUTE).toISOString() }),
    ]);
    const groups = lobbyTimeline(rows, now, 8);
    expect(groups.map((g) => [g.key, g.label, g.sessions.map((s) => s.id)])).toEqual([
      ['live', '进行中', [1]], ['tonight', '今晚', [2]], ['week', '本周', [3]],
      ['later', '更晚', [5]], ['cancelled', '已取消', [6]],
    ]);
    expect(rows[0].id).toBe(5);
    expect(lobbyTimeline([item({ id: 2 }), item()], now, 8)[0].sessions.map((s) => s.id)).toEqual([1, 2]);
  });
  it('uses board midnight and Monday, and expires cancellations exactly after 24 hours', () => {
    process.env.TZ = zone;
    const sunday = Date.parse('2026-11-01T15:30:00Z');
    const monday = item({ starts_at: '2026-11-01T16:00:00Z' });
    expect(lobbyTimeline([monday], sunday, 8)[0].key).toBe('later');
    expect(lobbyTimeline([monday], sunday, 0)[0].key).toBe('tonight');
    const cancelled = item({ status: 'cancelled' });
    expect(lobbyTimeline([cancelled], START + LOBBY_CANCELLED_KEEP_MS - 1, 8)).toHaveLength(1);
    expect(lobbyTimeline([cancelled], START + LOBBY_CANCELLED_KEEP_MS, 8)).toEqual([]);
  });
  it('reads board day/week/clock independently of the process, with local fallback', () => {
    process.env.TZ = zone;
    expect(dayStartOn(START, 8)).toBe(Date.parse('2026-10-25T16:00:00Z'));
    expect(weekStartOn(START, 8)).toBe(Date.parse('2026-10-25T16:00:00Z'));
    expect(clockOn(START, 5.5)).toBe('17:30');
    const local = new Date(START); local.setHours(0, 0, 0, 0);
    expect(dayStartOn(START)).toBe(local.getTime());
    expect(clockOn(START)).toBe(`${String(new Date(START).getHours()).padStart(2, '0')}:00`);
  });
});
