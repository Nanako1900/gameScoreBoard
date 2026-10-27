// P2-1: who the InviteSheet offers, and how picking works (P2 contract 4.6).

import { describe, expect, it } from 'vitest';
import {
  INVITES_PER_ORGANIZER,
  MAX_INVITES,
  MAX_SESSION_ROSTER,
  type Rsvp,
} from '@shared/attendance';
import { inviteGroups, inviteToast, toggleInvite, pickerGroups, lastLineup, pickLineup } from '../../src/lib/invitePicker';
import type { InvitableUser, SessionPlayer } from '../../src/types';

function user(id: string, isParticipant = true): InvitableUser {
  return { id, username: `名字${id}`, avatar_url: null, is_participant: isParticipant, last_played_with_me_at: null };
}

function player(id: string, rsvp: Rsvp): SessionPlayer {
  return {
    user: { id, username: `名字${id}`, avatar_url: null },
    rsvp,
    rsvp_at: '2026-10-27 00:00:00',
    attendance: null,
    late_minutes: null,
    attendance_note: null,
    record_id: null,
    is_participant: true,
  };
}

describe('inviteGroups', () => {
  it('splits the board from the other friends and keeps the server order in each', () => {
    const users = [user('z'), user('y', false), user('x'), user('w', false)];
    const groups = inviteGroups(users, []);
    expect(groups.onBoard.map((r) => r.user.id)).toEqual(['z', 'x']);
    expect(groups.others.map((r) => r.user.id)).toEqual(['y', 'w']);
    expect([...groups.onBoard, ...groups.others].every((r) => r.state === 'free')).toBe(true);
  });

  it('marks who is already in (invited, going, maybe) and who said no', () => {
    const users = [user('i'), user('g'), user('m'), user('o', false), user('f', false)];
    const players = [player('i', 'invited'), player('g', 'going'), player('m', 'maybe'), player('o', 'out')];
    const { onBoard, others } = inviteGroups(users, players);
    expect(onBoard.map((r) => [r.user.id, r.state])).toEqual([
      ['i', 'in'],
      ['g', 'in'],
      ['m', 'in'],
    ]);
    expect(others.map((r) => [r.user.id, r.state])).toEqual([
      ['o', 'out'],
      ['f', 'free'],
    ]);
  });

  it('two empty groups for nobody', () => {
    expect(inviteGroups([], [player('org', 'going')])).toEqual({ onBoard: [], others: [] });
  });
});

describe('toggleInvite', () => {
  it('adds and removes, always as a new array', () => {
    const none: readonly string[] = [];
    const one = toggleInvite(none, 'a');
    expect(one).toEqual(['a']);
    expect(none).toEqual([]);
    const two = toggleInvite(one, 'b');
    expect(two).toEqual(['a', 'b']);
    expect(toggleInvite(two, 'a')).toEqual(['b']);
    expect(two).toEqual(['a', 'b']);
  });

  it(`stops at MAX_INVITES (${MAX_INVITES}) by default, but a full list can still drop someone`, () => {
    const full = Array.from({ length: MAX_INVITES }, (_, i) => `u${i}`);
    const same = toggleInvite(full, 'extra');
    expect(same).toEqual(full);
    expect(same).not.toBe(full);
    expect(toggleInvite(full, 'u0')).toHaveLength(MAX_INVITES - 1);
    expect(toggleInvite(['a', 'b'], 'c', 2)).toEqual(['a', 'b']);
  });
});

describe('inviteToast', () => {
  it('says how many were asked, and to shout in the group', () => {
    expect(inviteToast(2)).toBe('已叫 2 人。没绑 Discord 的朋友，记得在群里喊一声。');
  });

  it('says so when nobody new was asked', () => {
    expect(inviteToast(0)).toBe('没有叫到新的人：选的人已经在局里了。');
  });
});

describe('the limits the sheet and the server share', () => {
  it('are the values the backend has always used', () => {
    expect(MAX_INVITES).toBe(20);
    expect(MAX_SESSION_ROSTER).toBe(50);
    expect(INVITES_PER_ORGANIZER).toBe(3);
  });
});


// P3-3: recent groups and the last complete lineup.
describe('full picker rules', () => {
  const recent = (id: string, at: string, board = true): InvitableUser => ({ ...user(id, board), last_played_with_me_at: at });
  it('puts recent people first without duplication, keeping server order and membership reasons', () => {
    const rows = [recent('z', '2026-10-27'), recent('x', '2026-10-26', false), user('b'), user('c', false)];
    const groups = pickerGroups(rows, [player('z', 'going'), player('x', 'out')]);
    expect(groups.recent.map((r) => [r.user.id, r.state])).toEqual([['z', 'in'], ['x', 'out']]);
    expect(groups.onBoard.map((r) => r.user.id)).toEqual(['b']);
    expect(groups.others.map((r) => r.user.id)).toEqual(['c']);
  });
  it('filters names without case sensitivity and keeps empty groups empty', () => {
    const alice = { ...user('a'), username: 'ALice' };
    expect(pickerGroups([alice, user('b')], [], 'LiC').onBoard.map((r) => r.user.id)).toEqual(['a']);
    expect(pickerGroups([], [], 'a')).toEqual({ recent: [], onBoard: [], others: [] });
  });
  it('takes only people from the latest actual session, capped at MAX_INVITES', () => {
    expect(lastLineup([recent('a', '2026-10-26'), recent('b', '2026-10-27'), recent('c', '2026-10-27'), user('d')])).toEqual(['b', 'c']);
    expect(lastLineup([user('a')])).toEqual([]);
    expect(lastLineup(Array.from({ length: MAX_INVITES + 1 }, (_, i) => recent(String(i), '2026-10-27')))).toHaveLength(MAX_INVITES);
  });
  it('unions the last lineup with selected people, accepting only free ids up to the cap', () => {
    const selected = ['a'];
    expect(pickLineup(selected, ['a', 'b', 'c', 'd'], ['a', 'c', 'd'], 2)).toEqual(['a', 'c']);
    expect(selected).toEqual(['a']);
    expect(pickLineup([], ['taken', 'out'], [])).toEqual([]);
  });
});
