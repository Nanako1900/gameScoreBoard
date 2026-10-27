import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Rsvp, SelfRsvp } from '@shared/attendance';
import { quickSlots } from '@shared/quickTime';
import { RESCHEDULE_DM_DELAY_MIN } from '../../src/lib/constants';
import {
  fullNotice,
  goingClosed,
  isFull,
  parseCustomTime,
  rescheduleConsequences,
  rescheduleImpact,
  rescheduleSlots,
  rsvpFeedback,
} from '../../src/lib/sessionActions';
import { toDateTimeLocalValue } from '../../src/lib/time';
import type { SessionDetail, SessionPlayer } from '../../src/types';

// P0-6: the numbers and copy behind 改时间 / 满员 / RSVP toasts.

const ROOT = path.resolve(__dirname, '../..');

function player(id: string, rsvp: Rsvp): SessionPlayer {
  return {
    user: { id, username: id, avatar_url: null },
    rsvp,
    rsvp_at: '2026-10-27 00:00:00',
    attendance: null,
    late_minutes: null,
    attendance_note: null,
    record_id: null,
    is_participant: true,
  };
}

function session(overrides: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: 1,
    organizer: { id: 'org', username: '组织者', avatar_url: null },
    title: '周五五排',
    game: null,
    starts_at: '2026-10-28T13:00:00.000Z',
    duration_min: null,
    capacity: null,
    note: null,
    status: 'open',
    settled_at: null,
    created_at: '2026-10-27 00:00:00',
    counts: { invited: 1, going: 2, maybe: 1, out: 1 },
    my_rsvp: null,
    players: [
      player('org', 'going'),
      player('a', 'going'),
      player('b', 'maybe'),
      player('c', 'out'),
      player('d', 'invited'),
    ],
    ...overrides,
  };
}

const FULL = { capacity: 2, counts: { invited: 0, going: 2, maybe: 0, out: 0 } };

describe('rescheduleImpact', () => {
  it('counts going, maybe and out — not the organizer, not the invited', () => {
    expect(rescheduleImpact(session())).toBe(3);
  });

  it('is 0 when only the organizer has answered', () => {
    expect(rescheduleImpact(session({ players: [player('org', 'going'), player('d', 'invited')] }))).toBe(0);
  });
});

describe('rescheduleConsequences', () => {
  it('lists what a move does (spec §3.5)', () => {
    expect(rescheduleConsequences(session())).toEqual([
      '已回复的 3 人要重新确认（说过不来的也要重新回答）',
      '局里每个人约 3 分钟后收到一条「约局改时间了」私信，连改几次也只发一条',
      '开局提醒和点名提醒会跟着改',
    ]);
  });

  it('drops the re-answer line when nobody has answered yet', () => {
    const lines = rescheduleConsequences(session({ players: [player('org', 'going'), player('d', 'invited')] }));
    expect(lines).toHaveLength(2);
    expect(lines.join()).not.toMatch(/重新确认/);
  });

  it('drops the DM line when the organizer is alone in it', () => {
    expect(rescheduleConsequences(session({ players: [player('org', 'going')] }))).toEqual([
      '开局提醒和点名提醒会跟着改',
    ]);
  });
});

describe('rescheduleSlots', () => {
  const slots = quickSlots(new Date(2026, 9, 28, 10, 0));

  it('never offers the time the session already has', () => {
    const current = slots[1];
    const left = rescheduleSlots(slots, current.iso);
    expect(left).toHaveLength(slots.length - 1);
    expect(left.map((s) => s.iso)).not.toContain(current.iso);
  });

  it('keeps every slot for a session at another time', () => {
    expect(rescheduleSlots(slots, new Date(2026, 10, 20, 9, 0).toISOString())).toEqual(slots);
  });
});

describe('parseCustomTime', () => {
  it('reads datetime-local as local wall-clock time and sends UTC', () => {
    const ms = new Date(2026, 9, 30, 20, 30).getTime();
    expect(parseCustomTime(toDateTimeLocalValue(ms))).toEqual({ ok: true, iso: new Date(ms).toISOString() });
  });

  it('asks for a time when it is empty, and refuses garbage', () => {
    expect(parseCustomTime('  ')).toEqual({ ok: false, error: '选一个时间' });
    expect(parseCustomTime('明晚八点')).toEqual({ ok: false, error: '时间格式不对' });
  });
});

describe('isFull / goingClosed / fullNotice', () => {
  it('is never full without a capacity', () => {
    expect(isFull(session({ capacity: null, counts: { invited: 0, going: 9, maybe: 0, out: 0 } }))).toBe(false);
  });

  it('is full once going reaches capacity', () => {
    expect(isFull(session(FULL))).toBe(true);
    expect(isFull(session({ ...FULL, capacity: 3 }))).toBe(false);
  });

  it('closes 来 only for someone not already going', () => {
    expect(goingClosed(session({ ...FULL, my_rsvp: 'maybe' }))).toBe(true);
    expect(goingClosed(session({ ...FULL, my_rsvp: null }))).toBe(true);
    expect(goingClosed(session({ ...FULL, my_rsvp: 'going' }))).toBe(false);
  });

  it('says what to do instead while 来 is closed', () => {
    expect(fullNotice(session({ ...FULL, my_rsvp: 'invited' }))).toBe('来 2/2 满了，可以先报待定。');
    expect(fullNotice(session({ ...FULL, my_rsvp: 'going' }))).toBeNull();
    expect(fullNotice(session())).toBeNull();
  });
});

describe('rsvpFeedback', () => {
  const cases: [Rsvp | null, SelfRsvp, string, boolean][] = [
    [null, 'going', '已回复：来。开局前想改随时改。', false],
    ['invited', 'maybe', '已回复：待定。开局前想改随时改。', false],
    ['invited', 'out', '收到，提前说了点名就不会记你 👍', false],
    ['going', 'out', '收到，提前说了点名就不会记你 👍', true],
    ['maybe', 'going', '已改成：来', true],
    ['out', 'maybe', '已改成：待定', true],
  ];

  it.each(cases)('%s → %s', (prev, next, message, undoable) => {
    expect(rsvpFeedback(prev, next)).toEqual({ message, undoable });
  });

  it('says nothing when the answer did not change', () => {
    expect(rsvpFeedback('going', 'going')).toBeNull();
  });
});

describe('RESCHEDULE_DM_DELAY_MIN', () => {
  it('matches the dm.session.changed schedule in the PG trigger', () => {
    const sql = readFileSync(path.join(ROOT, 'server/migrations/0005_sessions.sql'), 'utf8');
    const branch = sql.slice(sql.indexOf("'dm.session.changed'"));
    const minutes = /interval '(\d+) minutes'/.exec(branch);
    expect(minutes).not.toBeNull();
    expect(Number(minutes?.[1])).toBe(RESCHEDULE_DM_DELAY_MIN);
  });
});
