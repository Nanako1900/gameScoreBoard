import { describe, expect, it } from 'vitest';
import { normalizeWelcomeReturn, parseWelcomeReturn } from '../../src/lib/welcomeReturn';
import { LOGIN_RETURN_TTL_MS } from '../../src/lib/constants';
const NOW = Date.parse('2026-10-27T12:00:00Z');
const stored = (path: unknown, savedAt: unknown = NOW, v: unknown = 1) => JSON.stringify({ v, path, savedAt });

describe('welcome addresses kept through Discord OAuth', () => {
  it.each(['/cases/9', '/players/a%2Fb', '/players/p/cases/9', '/guide', '/board/rules', '/sessions/4'])('allows an existing read-only destination %s', (path) => {
    expect(normalizeWelcomeReturn(path)).toBe(path);
  });
  it('keeps valid legacy case/session targets and unrelated query while consuming welcome flags', () => {
    expect(normalizeWelcomeReturn('/?case=9&session=3&onboarding=1&linked=discord&utm=old')).toBe('/?case=9&session=3&utm=old');
    expect(normalizeWelcomeReturn('/?session=3')).toBe('/?session=3');
    expect(normalizeWelcomeReturn('/players/p?onboarding=1&linked=discord&utm=old')).toBe('/players/p?utm=old');
  });
  it.each([null, '', '/', '/?utm=old', '/?case=bad', '/?session=0', '/welcome', '/welcome?case=1', '/missing',
    '/api/me', '/auth/login', '/link/discord', '//evil.example', 'https://evil.example/', '/players/p#hash', '/players\\p'])('rejects unsafe, unsupported or self-return destination %s', (path) => {
    expect(normalizeWelcomeReturn(path)).toBeNull();
  });
  it('validates lifetime and version and ignores old action fields', () => {
    expect(parseWelcomeReturn(stored('/cases/9'), NOW)).toBe('/cases/9');
    expect(parseWelcomeReturn(stored('/cases/9', NOW - LOGIN_RETURN_TTL_MS), NOW)).toBe('/cases/9');
    for (const at of [NOW + 1, NOW - LOGIN_RETURN_TTL_MS - 1, 'bad', null]) expect(parseWelcomeReturn(stored('/cases/9', at), NOW)).toBeNull();
    for (const raw of [null, '{', 'null', '[]', stored('/cases/9', NOW, 2), stored('/api/me'), stored('/players/' + 'x'.repeat(600))]) expect(parseWelcomeReturn(raw, NOW)).toBeNull();
    expect(parseWelcomeReturn(JSON.stringify({ v: 1, path: '/cases/9', savedAt: NOW, intent: 'rsvp', secret: 'unused' }), NOW)).toBe('/cases/9');
  });
});
