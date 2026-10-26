import { describe, expect, it } from 'vitest';
import { parseRsvpButton, sessionCard, sessionDmRelevant, slotIso } from '../src/discord/sessions';
import type { SessionDetail } from '../../worker/types';

const EVIL = '[报名](https://evil.example) @everyone <@123456789012345678>';
const NOW = Date.parse('2026-10-26T04:00:00.000Z'); // 12:00 at UTC+8

function session(over: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id: 3,
    organizer: { id: 'org', username: '组织者', avatar_url: null },
    title: '周一 20:00 开黑',
    game: null,
    starts_at: '2026-10-26T12:00:00.000Z',
    duration_min: null,
    capacity: 5,
    note: null,
    status: 'open',
    settled_at: null,
    created_at: '2026-10-26 01:00:00',
    counts: { invited: 1, going: 2, maybe: 1, out: 0 },
    my_rsvp: null,
    players: [
      { user: { id: 'org', username: '组织者', avatar_url: null }, rsvp: 'going', rsvp_at: 'x', attendance: null, late_minutes: null, attendance_note: null },
      { user: { id: 'a', username: EVIL, avatar_url: null }, rsvp: 'going', rsvp_at: 'x', attendance: null, late_minutes: null, attendance_note: null },
      { user: { id: 'b', username: 'b', avatar_url: null }, rsvp: 'maybe', rsvp_at: 'x', attendance: null, late_minutes: null, attendance_note: null },
      { user: { id: 'c', username: 'c', avatar_url: null }, rsvp: 'invited', rsvp_at: 'x', attendance: null, late_minutes: null, attendance_note: null },
    ],
    ...over,
  } as SessionDetail;
}

describe('slotIso', () => {
  it('is board-local: 20:00 at UTC+8 is 12:00 UTC, across the date line too', () => {
    expect(slotIso(0, 20, 8, NOW)).toBe('2026-10-26T12:00:00.000Z');
    expect(slotIso(1, 20, 8, NOW)).toBe('2026-10-27T12:00:00.000Z');
    // 01:00 local on the 27th is still "today" there, though it is the 26th in UTC.
    const lateNight = Date.parse('2026-10-26T17:00:00.000Z');
    expect(slotIso(0, 20, 8, lateNight)).toBe('2026-10-27T12:00:00.000Z');
  });
});

describe('sessionCard', () => {
  it('shows seats and who is coming, with RSVP buttons, and pings nobody', () => {
    const card = sessionCard(session(), 'https://score.example', NOW);
    const out = JSON.stringify(card);
    expect(out).toContain('2/5 人');
    expect(out).toContain('v1:rsvp:3:going');
    expect(out).toContain('v1:rsvp:3:out');
    expect(card.allowed_mentions).toEqual({ parse: [] });
    const names = card.embeds[0].fields?.find((f) => f.name === '报名的人')?.value ?? '';
    expect(names).not.toContain('](');
    expect(names).not.toMatch(/@everyone/);
    expect(names).not.toContain('<@');
  });

  it('keeps no buttons once it is cancelled, over or under way', () => {
    expect(sessionCard(session({ status: 'cancelled' }), 'https://score.example', NOW).components).toEqual([]);
    expect(sessionCard(session({ status: 'settled' }), 'https://score.example', NOW).components).toEqual([]);
    const started = Date.parse('2026-10-26T12:30:00.000Z');
    expect(sessionCard(session(), 'https://score.example', started).components).toEqual([]);
  });
});

describe('sessionDmRelevant', () => {
  it('fits each DM to where its recipient stands now', () => {
    const s = session();
    expect(sessionDmRelevant('dm.session.invited', s, 'c', NOW)).toBe(true);
    expect(sessionDmRelevant('dm.session.invited', s, 'b', NOW)).toBe(false);
    expect(sessionDmRelevant('dm.session.starting', s, 'a', NOW)).toBe(true);
    expect(sessionDmRelevant('dm.session.starting', s, 'b', NOW)).toBe(false);
    expect(sessionDmRelevant('dm.session.rollcall', s, 'org', NOW)).toBe(true);
    expect(sessionDmRelevant('dm.session.rollcall', session({ status: 'settled' }), 'org', NOW)).toBe(false);
    expect(sessionDmRelevant('dm.session.cancelled', session({ status: 'cancelled' }), 'a', NOW)).toBe(true);
    // Delivered after the start it would have been: news no more.
    const afterStart = Date.parse('2026-10-26T12:30:00.000Z');
    expect(sessionDmRelevant('dm.session.cancelled', session({ status: 'cancelled' }), 'a', afterStart)).toBe(false);
    expect(sessionDmRelevant('dm.session.changed', s, 'c', NOW)).toBe(true);
    expect(sessionDmRelevant('dm.session.changed', s, 'nobody', NOW)).toBe(false);
  });
});

describe('RSVP buttons', () => {
  it('carry the start time they were made for', () => {
    const card = sessionCard(session(), 'https://score.example', NOW);
    const ids = card.components.flatMap((row) => row.components).flatMap((b) => ('custom_id' in b ? [b.custom_id] : []));
    expect(ids).toContain(`v1:rsvp:3:going:${Date.parse('2026-10-26T12:00:00.000Z')}`);
    expect(ids.every((id) => id.length <= 100)).toBe(true);
    expect(JSON.stringify(card.components)).toContain('https://score.example/?session=3');
  });

  it('read only their own ids, and give back the time', () => {
    expect(parseRsvpButton(`v1:rsvp:3:maybe:${Date.parse('2026-10-26T12:00:00.000Z')}`)).toEqual({
      sessionId: 3,
      choice: 'maybe',
      startsAt: '2026-10-26T12:00:00.000Z',
    });
    for (const id of ['v1:rsvp:3:invited:1', 'v1:rsvp:x:going:1', 'v1:rsvp:3:going', 'v1:rsvp:3', 'v1:verdict:3']) {
      expect(parseRsvpButton(id)).toBeNull();
    }
  });
});
