// P1-1: the address table (spec §2.2) — src/lib/routes.ts is pure, so it is tested here.

import { describe, expect, it } from 'vitest';
import { DESKTOP_MEDIA_QUERY, USER_ID_MAX } from '../../src/lib/constants';
import { pinnedCaseEyebrow } from '../../src/lib/routeCopy';
import {
  casePath,
  formatRoute,
  isAppPath,
  isUserId,
  parseRoute,
  playerCasePath,
  playerPath,
  readEdgState,
  routeCoversHome,
  sessionPath,
  type LinkableRoute,
  type Route,
} from '../../src/lib/routes';

const NOT_FOUND: Route = { name: 'notFound' };

describe('parseRoute', () => {
  it('reads the five P1 routes', () => {
    expect(parseRoute('/')).toEqual({ name: 'home' });
    expect(parseRoute('/sessions/5')).toEqual({ name: 'session', sessionId: 5 });
    expect(parseRoute('/players/p')).toEqual({ name: 'player', userId: 'p' });
    expect(parseRoute('/players/p/cases/7')).toEqual({ name: 'playerCase', userId: 'p', caseId: 7 });
    expect(parseRoute('/cases/7')).toEqual({ name: 'case', caseId: 7 });
  });

  it('takes only a positive integer id of at most 15 digits', () => {
    for (const bad of ['0', '07', '-1', '1e3', 'abc', '1.5', '1234567890123456', '']) {
      expect(parseRoute(`/sessions/${bad}`), bad).toEqual(NOT_FOUND);
      expect(parseRoute(`/cases/${bad}`), bad).toEqual(NOT_FOUND);
      expect(parseRoute(`/players/p/cases/${bad}`), bad).toEqual(NOT_FOUND);
    }
    expect(parseRoute('/sessions/123456789012345')).toEqual({ name: 'session', sessionId: 123456789012345 });
  });

  it('knows nothing of the later phases’ routes yet', () => {
    for (const later of [
      '/sessions/new',
      '/sessions/history',
      '/sessions/5/rollcall',
      '/board',
      '/board/feed',
      '/me',
      '/me/notify',
      '/review',
      '/admin',
      '/join',
      '/cases/new',
      '/cases/7/statement',
      '/players',
      '/players/p/cases',
      '/xyz',
    ]) {
      expect(parseRoute(later), later).toEqual(NOT_FOUND);
    }
  });

  it('never takes over /api, /auth or /link — but /apix is an ordinary unknown path', () => {
    for (const reserved of ['/api', '/api/', '/api/config', '/auth/login', '/auth', '/link', '/link/discord']) {
      expect(isAppPath(reserved), reserved).toBe(false);
      expect(parseRoute(reserved), reserved).toEqual(NOT_FOUND);
    }
    expect(isAppPath('/apix')).toBe(true);
    expect(isAppPath('/authors')).toBe(true);
    expect(isAppPath('sessions/5')).toBe(false);
  });

  it('forgives exactly one trailing slash', () => {
    expect(parseRoute('/sessions/5/')).toEqual({ name: 'session', sessionId: 5 });
    expect(parseRoute('/players/p/')).toEqual({ name: 'player', userId: 'p' });
    expect(parseRoute('/sessions/5//')).toEqual(NOT_FOUND);
    expect(parseRoute('//')).toEqual(NOT_FOUND);
  });

  it('decodes user ids, %2F included, and refuses broken or oversized ones', () => {
    expect(parseRoute('/players/%E9%80%89%E6%89%8B')).toEqual({ name: 'player', userId: '选手' });
    expect(parseRoute('/players/a%2Fb/cases/7')).toEqual({ name: 'playerCase', userId: 'a/b', caseId: 7 });
    expect(parseRoute('/players/%E0%A4%A')).toEqual(NOT_FOUND);
    expect(parseRoute('/players/a%00b')).toEqual(NOT_FOUND);
    expect(parseRoute(`/players/${'x'.repeat(USER_ID_MAX)}`)).toEqual({ name: 'player', userId: 'x'.repeat(USER_ID_MAX) });
    expect(parseRoute(`/players/${'x'.repeat(USER_ID_MAX + 1)}`)).toEqual(NOT_FOUND);
  });
});

describe('isUserId', () => {
  it('is non-empty, at most USER_ID_MAX, without NUL', () => {
    expect(isUserId('discord:123')).toBe(true);
    expect(isUserId('')).toBe(false);
    expect(isUserId('a\u0000b')).toBe(false);
    expect(isUserId('x'.repeat(USER_ID_MAX + 1))).toBe(false);
  });
});

describe('formatRoute and the path builders', () => {
  it('build what parseRoute reads back, never ending in a slash', () => {
    const routes: LinkableRoute[] = [
      { name: 'home' },
      { name: 'session', sessionId: 5 },
      { name: 'player', userId: 'a/b 选手' },
      { name: 'playerCase', userId: 'a/b', caseId: 7 },
      { name: 'case', caseId: 7 },
    ];
    for (const route of routes) {
      const path = formatRoute(route);
      expect(path === '/' || !path.endsWith('/'), path).toBe(true);
      expect(parseRoute(path)).toEqual(route);
    }
  });

  it('encode the user id', () => {
    expect(sessionPath(5)).toBe('/sessions/5');
    expect(playerPath('a/b')).toBe('/players/a%2Fb');
    expect(playerCasePath('p', 7)).toBe('/players/p/cases/7');
    expect(casePath(7)).toBe('/cases/7');
  });
});

describe('routeCoversHome', () => {
  it('hides the lobby under pages and NotFound, not under drawers', () => {
    expect(routeCoversHome({ name: 'home' }, 'page')).toBe(false);
    expect(routeCoversHome({ name: 'home' }, 'drawer')).toBe(false);
    expect(routeCoversHome(NOT_FOUND, 'drawer')).toBe(true);
    expect(routeCoversHome({ name: 'case', caseId: 7 }, 'drawer')).toBe(true);
    for (const route of [
      { name: 'session', sessionId: 5 },
      { name: 'player', userId: 'p' },
      { name: 'playerCase', userId: 'p', caseId: 7 },
    ] as const) {
      expect(routeCoversHome(route, 'page'), route.name).toBe(true);
      expect(routeCoversHome(route, 'drawer'), route.name).toBe(false);
    }
  });
});

describe('readEdgState', () => {
  it('knows the router’s own entries by edg: 1 alone', () => {
    expect(readEdgState(null)).toBeNull();
    expect(readEdgState('x')).toBeNull();
    expect(readEdgState({ edg: 2, idx: 1 })).toBeNull();
    expect(readEdgState({ edg: 1, idx: 3 })).toEqual({ edg: 1, idx: 3 });
  });

  it('reads a missing or broken idx as 0', () => {
    for (const idx of [undefined, -1, 1.5, '2', Number.NaN]) {
      expect(readEdgState({ edg: 1, idx }), String(idx)).toEqual({ edg: 1, idx: 0 });
    }
  });
});

describe('DESKTOP_MEDIA_QUERY', () => {
  // The four width features css-conventions.test.ts allows: JS must use the same desktop line.
  const CSS_WIDTH_FEATURES = ['max-width: 600px', 'min-width: 601px', 'max-width: 1023px', 'min-width: 1024px'];

  it('is the CSS desktop breakpoint', () => {
    expect(DESKTOP_MEDIA_QUERY).toBe('(min-width: 1024px)');
    expect(CSS_WIDTH_FEATURES).toContain(DESKTOP_MEDIA_QUERY.slice(1, -1));
  });
});

describe('pinnedCaseEyebrow', () => {
  const base = { id: 7, type: 'no_show', status: 'awaiting_statement' } as const;

  it('names the charge and the stage for those who may read the case', () => {
    expect(pinnedCaseEyebrow(base)).toBe('案件 #7 · 放鸽子 · 待说明');
    expect(pinnedCaseEyebrow({ ...base, status: 'appealed' })).toBe('案件 #7 · 放鸽子 · 申诉中');
  });

  it('drops the empty label of a decided case', () => {
    expect(pinnedCaseEyebrow({ ...base, status: 'decided' })).toBe('案件 #7 · 放鸽子');
  });

  it('says only 处理中 when the API hid the case (B1-1)', () => {
    expect(pinnedCaseEyebrow({ ...base, type: null, status: 'judging', pending_hidden: true })).toBe('案件 #7 · 处理中');
  });
});
