// P1-3: edg.return — the rules a saved login return must pass before it moves
// anyone anywhere (spec §4.1 登录回跳, P1 contract 4.11).

import { describe, expect, it } from 'vitest';
import { LOGIN_RETURN_TTL_MS, RETURN_PATH_MAX } from '../../src/lib/constants';
import {
  LOGIN_RETURN_KEY,
  hasLegacyTarget,
  parseLoginReturn,
  resumeRsvpFor,
  serializeLoginReturn,
} from '../../src/lib/loginReturnShape';
import type { LoginIntent } from '../../src/lib/loginReturnShape';

const NOW = 1_761_500_000_000;
const GOING: LoginIntent = { kind: 'rsvp', sessionId: 5, rsvp: 'going' };

/** A stored value as JSON text, with any field overridden or removed (undefined). */
function stored(fields: Record<string, unknown>): string {
  return JSON.stringify({ v: 1, path: '/sessions/5', savedAt: NOW, ...fields });
}

describe('serializeLoginReturn', () => {
  it('writes the contract shape, with or without an intent', () => {
    expect(JSON.parse(serializeLoginReturn('/sessions/5', GOING, NOW))).toEqual({
      v: 1,
      path: '/sessions/5',
      savedAt: NOW,
      intent: { kind: 'rsvp', sessionId: 5, rsvp: 'going' },
    });
    expect(JSON.parse(serializeLoginReturn('/players/p', undefined, NOW))).toEqual({
      v: 1,
      path: '/players/p',
      savedAt: NOW,
    });
  });

  it('round-trips through parseLoginReturn', () => {
    expect(parseLoginReturn(serializeLoginReturn('/sessions/5?utm=dc', GOING, NOW), NOW)).toEqual({
      v: 1,
      path: '/sessions/5?utm=dc',
      savedAt: NOW,
      intent: GOING,
    });
  });

  it('uses the edg.return key', () => {
    expect(LOGIN_RETURN_KEY).toBe('edg.return');
  });
});

describe('parseLoginReturn — the whole value', () => {
  it('nothing stored, or not JSON, or not an object → null', () => {
    expect(parseLoginReturn(null, NOW)).toBeNull();
    expect(parseLoginReturn('', NOW)).toBeNull();
    expect(parseLoginReturn('{"v":1,', NOW)).toBeNull();
    expect(parseLoginReturn('"/sessions/5"', NOW)).toBeNull();
    expect(parseLoginReturn('null', NOW)).toBeNull();
    expect(parseLoginReturn('[1]', NOW)).toBeNull();
  });

  it('another version → null', () => {
    expect(parseLoginReturn(stored({ v: 2 }), NOW)).toBeNull();
    expect(parseLoginReturn(stored({ v: '1' }), NOW)).toBeNull();
    expect(parseLoginReturn(stored({ v: undefined }), NOW)).toBeNull();
  });

  it('older than the TTL, from the future, or without a finite savedAt → null', () => {
    expect(parseLoginReturn(stored({ savedAt: NOW - LOGIN_RETURN_TTL_MS }), NOW)).not.toBeNull();
    expect(parseLoginReturn(stored({ savedAt: NOW - LOGIN_RETURN_TTL_MS - 1 }), NOW)).toBeNull();
    expect(parseLoginReturn(stored({ savedAt: NOW + 1 }), NOW)).toBeNull();
    expect(parseLoginReturn(stored({ savedAt: '1761500000000' }), NOW)).toBeNull();
    expect(parseLoginReturn(stored({ savedAt: null }), NOW)).toBeNull();
    expect(parseLoginReturn(stored({ savedAt: undefined }), NOW)).toBeNull();
  });
});

describe('parseLoginReturn — the path is the router whitelist', () => {
  it.each([
    '/sessions/5',
    '/sessions/5?utm=dc',
    '/players/p',
    '/players/a%2Fb',
    '/players/p/cases/7',
    '/cases/7',
  ])('keeps a page the router knows: %s', (path) => {
    expect(parseLoginReturn(stored({ path }), NOW)?.path).toBe(path);
  });

  it.each([
    ['not a string', 5],
    ['missing', undefined],
    ['empty', ''],
    ['relative', 'sessions/5'],
    ['protocol-relative', '//evil.example/sessions/5'],
    ['absolute URL', 'https://evil.example/sessions/5'],
    ['backslash', '/\\evil.example'],
    ['hash', '/sessions/5#x'],
    ['the lobby', '/'],
    ['the lobby with a query', '/?session=5'],
    ['an unknown page', '/xyz'],
    ['not a positive id', '/sessions/0'],
    ['a leading zero', '/sessions/07'],
    ['not a number', '/sessions/abc'],
    ['an exponent', '/cases/1e3'],
    ['a later-phase page', '/sessions/new'],
    ['the API', '/api/me'],
    ['the login itself', '/auth/login'],
    ['the Discord link flow', '/link/discord'],
    ['too long', `/players/${'x'.repeat(RETURN_PATH_MAX)}`],
  ])('drops %s', (_label, path) => {
    expect(parseLoginReturn(stored({ path }), NOW)).toBeNull();
  });

  it('a path of exactly RETURN_PATH_MAX characters is still fine', () => {
    const prefix = '/sessions/5?q=';
    const path = prefix + 'x'.repeat(RETURN_PATH_MAX - prefix.length);
    expect(path).toHaveLength(RETURN_PATH_MAX);
    expect(parseLoginReturn(stored({ path }), NOW)?.path).toBe(path);
  });
});

describe('parseLoginReturn — a bad intent is dropped on its own', () => {
  it('keeps a matching rsvp intent for each answer', () => {
    for (const rsvp of ['going', 'maybe', 'out'] as const) {
      const intent = { kind: 'rsvp', sessionId: 5, rsvp };
      expect(parseLoginReturn(stored({ intent }), NOW)?.intent).toEqual(intent);
    }
  });

  it.each([
    ['another kind', { kind: 'create', sessionId: 5, rsvp: 'going' }],
    ['invited is not an answer', { kind: 'rsvp', sessionId: 5, rsvp: 'invited' }],
    ['an unknown answer', { kind: 'rsvp', sessionId: 5, rsvp: 'yes' }],
    ['another session', { kind: 'rsvp', sessionId: 6, rsvp: 'going' }],
    ['the id as a string', { kind: 'rsvp', sessionId: '5', rsvp: 'going' }],
    ['not an object', 'rsvp:going'],
    ['null', null],
  ])('%s → the path stays, the intent goes', (_label, intent) => {
    const parsed = parseLoginReturn(stored({ intent }), NOW);
    expect(parsed).toEqual({ v: 1, path: '/sessions/5', savedAt: NOW });
    expect(parsed).not.toHaveProperty('intent');
  });

  it('an rsvp intent on a page that is not a session is dropped', () => {
    const parsed = parseLoginReturn(stored({ path: '/players/p', intent: GOING }), NOW);
    expect(parsed).toEqual({ v: 1, path: '/players/p', savedAt: NOW });
  });

  it('extra fields never come back out', () => {
    const parsed = parseLoginReturn(
      stored({ intent: { ...GOING, auto: true }, next: 'https://evil.example' }),
      NOW,
    );
    expect(parsed).toEqual({ v: 1, path: '/sessions/5', savedAt: NOW, intent: GOING });
  });
});

describe('resumeRsvpFor', () => {
  it('only answers for the session the intent was about', () => {
    expect(resumeRsvpFor(GOING, 5)).toBe('going');
    expect(resumeRsvpFor(GOING, 6)).toBeNull();
    expect(resumeRsvpFor(null, 5)).toBeNull();
    expect(resumeRsvpFor(undefined, 5)).toBeNull();
  });
});

describe('hasLegacyTarget', () => {
  it('only an old link on the lobby counts', () => {
    expect(hasLegacyTarget('/', '?case=7')).toBe(true);
    expect(hasLegacyTarget('/', '?session=3&utm=dc')).toBe(true);
    expect(hasLegacyTarget('/', '?case=abc')).toBe(false);
    expect(hasLegacyTarget('/', '?onboarding=1')).toBe(false);
    expect(hasLegacyTarget('/', '')).toBe(false);
    expect(hasLegacyTarget('/sessions/5', '?session=3')).toBe(false);
  });
});
