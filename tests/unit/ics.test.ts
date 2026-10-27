import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_DURATION_MIN, SESSION_START_REMINDER_MIN } from '../../shared/attendance';
import { synthesizeTitle } from '../../shared/quickTime';
import { buildIcs, icsFileName, type IcsEvent } from '../../src/lib/ics';
import { sessionShareUrl, shareText } from '../../src/lib/share';
import { parseBoardInputValue, toBoardInputValue } from '../../src/lib/time';
import type { SessionItem } from '../../src/types';

const NOW = Date.parse('2026-10-28T12:00:00Z');
const START = '2026-10-30T13:00:00Z';
const TZ = process.env.TZ;
const event = (patch: Partial<IcsEvent> = {}): IcsEvent => ({
  uid: 'edg-session-5@example.test', title: '周五五排（无畏契约）', startsAt: START,
  durationMin: DEFAULT_DURATION_MIN, url: 'https://example.test/sessions/5',
  description: '老地方，开麦', alarmMin: SESSION_START_REMINDER_MIN, now: NOW, ...patch,
});
function session(patch: Partial<SessionItem> = {}): SessionItem {
  return { id: 5, organizer: { id: 'org', username: '组织者', avatar_url: null }, title: '周五五排', game: '无畏契约',
    starts_at: START, duration_min: null, capacity: 5, note: '备注', status: 'open', settled_at: null,
    created_at: '2026-10-01 00:00:00', counts: { going: 4, invited: 2, maybe: 1, out: 0 }, my_rsvp: null, ...patch };
}
afterEach(() => { if (TZ === undefined) delete process.env.TZ; else process.env.TZ = TZ; });

describe('local calendar export', () => {
  it('writes one UTC event with canonical calendar metadata and CRLF lines', () => {
    const ics = buildIcs(event());
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//EDG 信誉分//约局//ZH\r\n');
    expect(unfolded).toContain('CALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nBEGIN:VEVENT\r\n');
    expect(unfolded).toContain('UID:edg-session-5@example.test\r\n');
    expect(unfolded).toContain('DTSTAMP:20261028T120000Z\r\n');
    expect(unfolded).toContain('DTSTART:20261030T130000Z\r\nDTEND:20261030T150000Z\r\n');
    expect(unfolded).toContain('URL:https://example.test/sessions/5\r\n');
    expect(ics.endsWith('END:VEVENT\r\nEND:VCALENDAR\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(icsFileName(5)).toBe('edg-session-5.ics');
  });
  it('includes a display reminder and the public link even without a note', () => {
    const ics = buildIcs(event({ description: undefined }));
    expect(ics).toContain('DESCRIPTION:https://example.test/sessions/5\r\n');
    expect(ics).toContain('BEGIN:VALARM\r\nACTION:DISPLAY\r\n');
    expect(ics).toContain(`TRIGGER:-PT${SESSION_START_REMINDER_MIN}M\r\nEND:VALARM`);
    expect(ics.replace(/\r\n /g, '')).toContain('DESCRIPTION:周五五排（无畏契约） 快开局了');
  });
  it('uses an explicit duration across a UTC date boundary', () => {
    const ics = buildIcs(event({ startsAt: '2026-10-30T23:30:00Z', durationMin: 90 }));
    expect(ics).toContain('DTSTART:20261030T233000Z\r\nDTEND:20261031T010000Z');
  });
  it('escapes user text, so punctuation and line breaks cannot add calendar properties', () => {
    const ics = buildIcs(event({ title: '局\\名;朋友,来\r\nBEGIN:VEVENT', description: '备注\nEND:VCALENDAR' })).replace(/\r\n /g, '');
    expect(ics).toContain('SUMMARY:局\\\\名\\;朋友\\,来\\nBEGIN:VEVENT\r\n');
    expect(ics).toContain('DESCRIPTION:备注\\nEND:VCALENDAR\\nhttps://example.test/sessions/5');
    expect(ics.split('\r\n').filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(1);
    expect(ics.split('\r\nEND:VCALENDAR\r\n')).toHaveLength(2);
  });
  it('folds UTF-8 at 75 octets including continuation space, without splitting a code point', () => {
    const title = '一起开黑🎮'.repeat(18);
    const ics = buildIcs(event({ title, description: '备注'.repeat(70) }));
    const lines = ics.trimEnd().split('\r\n');
    expect(lines.some((line) => line.startsWith(' '))).toBe(true);
    expect(lines.every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
    expect(ics).not.toContain('�');
    expect(ics.replace(/\r\n /g, '')).toContain(`SUMMARY:${title}\r\n`);
  });
  it.each(['Asia/Shanghai', 'UTC', 'America/Los_Angeles'])('is independent of browser/process time zone %s', (zone) => {
    process.env.TZ = zone;
    expect(buildIcs(event({ startsAt: '2026-10-30 13:00:00' }))).toContain('DTSTART:20261030T130000Z');
  });
});

describe('session sharing text', () => {
  it('shares only the canonical session path and keeps the origin port', () => {
    expect(sessionShareUrl('https://example.test:8443', 5)).toBe('https://example.test:8443/sessions/5');
    expect(sessionShareUrl('https://example.test/', 7)).toBe('https://example.test/sessions/7');
  });
  it('uses the game, board clock and number of open seats', () => {
    expect(shareText(session(), NOW, 8)).toBe('周五 21:00 无畏契约，还差 1 人，来不来？');
  });
  it('uses the title when there is no game, and avoids duplicating a synthesized title', () => {
    expect(shareText(session({ game: null }), NOW, 8)).toBe('周五 21:00 周五五排，还差 1 人，来不来？');
    expect(shareText(session({ game: null, title: synthesizeTitle(START, 8) }), NOW, 8)).toBe('周五 21:00 开黑，还差 1 人，来不来？');
  });
  it('says the group is full when there are no remaining seats', () => {
    expect(shareText(session({ capacity: 4 }), NOW, 8)).toContain('，人齐了，来不来？');
    expect(shareText(session({ capacity: 3 }), NOW, 8)).toContain('，人齐了，来不来？');
  });
  it('states the current count for an uncapped session', () => {
    expect(shareText(session({ capacity: null }), NOW, 8)).toContain('，已经 4 人，来不来？');
  });
  it('never includes a score, rank, roster, private binding state or session note', () => {
    const s = { ...session(), score: 82, discord_user_id: 'private-discord', players: [{ username: '私密名单' }] };
    const text = shareText(s, NOW, 8);
    expect(text).not.toMatch(/82|段位|私密名单|private-discord|备注/);
  });
});

describe.each(['Asia/Shanghai', 'UTC', 'America/Los_Angeles'])('board-clock input in process %s', (zone) => {
  it('round trips on the fixed board clock, including a fractional and negative offset', () => {
    process.env.TZ = zone;
    expect(toBoardInputValue(Date.parse(START), 8)).toBe('2026-10-30T21:00');
    expect(parseBoardInputValue('2026-10-30T21:00', 8)).toBe(Date.parse(START));
    expect(toBoardInputValue(Date.parse(START), -5.5)).toBe('2026-10-30T07:30');
    expect(parseBoardInputValue('2026-10-30T07:30', -5.5)).toBe(Date.parse(START));
  });
});
describe('invalid board-clock input', () => {
  it.each(['', '2026-02-30T12:00', '2026-13-01T12:00', '2026-10-30T24:30', '2026-10-30T12:60', '2026-10-30T12:00Z'])('rejects %j without normalizing it into another day', (value) => {
    expect(parseBoardInputValue(value, 8)).toBeNull();
  });
});
