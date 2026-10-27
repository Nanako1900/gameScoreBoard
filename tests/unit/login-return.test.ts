// P1-3: edg.return — the rules a saved login return must pass before it moves
// anyone anywhere (spec §4.1 登录回跳, P1 contract 4.11).

import { describe, expect, it } from 'vitest';
import { LOGIN_RETURN_TTL_MS, RETURN_PATH_MAX } from '../../src/lib/constants';
import {
  LOGIN_RETURN_KEY,
  hasLegacyTarget,
  parseLoginReturn,
  serializeLoginReturn,
} from '../../src/lib/loginReturnShape';

const NOW = 1_761_500_000_000;
const GOING = { kind: 'rsvp', sessionId: 5, rsvp: 'going' };

/** A stored value as JSON text, with any field overridden or removed (undefined). */
function stored(fields: Record<string, unknown>): string {
  return JSON.stringify({ v: 1, path: '/players/p', savedAt: NOW, ...fields });
}

describe('serializeLoginReturn', () => {
  it('writes only the return address and timestamp', () => {
    expect(JSON.parse(serializeLoginReturn('/players/p', NOW))).toEqual({ v: 1, path: '/players/p', savedAt: NOW });
  });
  it('round-trips a retained address', () => {
    expect(parseLoginReturn(serializeLoginReturn('/players/p?utm=dc', NOW), NOW)).toEqual({
      v: 1, path: '/players/p?utm=dc', savedAt: NOW,
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
    ['an exponent', '/cases/1e3'],
    ['a later-phase page', '/me'],
    ['the API', '/api/me'],
    ['the login itself', '/auth/login'],
    ['the Discord link flow', '/link/discord'],
    ['too long', `/players/${'x'.repeat(RETURN_PATH_MAX)}`],
  ])('drops %s', (_label, path) => {
    expect(parseLoginReturn(stored({ path }), NOW)).toBeNull();
  });

  it('a path of exactly RETURN_PATH_MAX characters is still fine', () => {
    const prefix = '/players/p?q=';
    const path = prefix + 'x'.repeat(RETURN_PATH_MAX - prefix.length);
    expect(path).toHaveLength(RETURN_PATH_MAX);
    expect(parseLoginReturn(stored({ path }), NOW)?.path).toBe(path);
  });
});

describe('old stored return values', () => {
  it('keeps the address while ignoring an old RSVP intent and other extra fields', () => {
    expect(parseLoginReturn(stored({ intent: { ...GOING, auto: true }, next: 'https://evil.example' }), NOW))
      .toEqual({ v: 1, path: '/players/p', savedAt: NOW });
  });
  it.each(['/sessions', '/sessions/5', '/sessions/5?utm=dc', '/sessions/new?again=5', '/sessions/x/y'])
    ('maps retired address %s to home and ignores its intent', (path) => {
      expect(parseLoginReturn(stored({ path, intent: GOING }), NOW)).toEqual({ v: 1, path: '/', savedAt: NOW });
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
