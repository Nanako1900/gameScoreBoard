import { describe, expect, it } from 'vitest';
import { PRIMARY_NAVIGATION, primaryNavigationKey } from '../../src/lib/navigation';
import { parseRoute } from '../../src/lib/routes';

describe('shared primary navigation', () => {
  it('keeps the same four ordered destinations for every viewport and role', () => {
    expect(PRIMARY_NAVIGATION).toEqual([
      { key: 'home', label: '首页', to: '/' },
      { key: 'board', label: '信誉榜', to: '/board' },
      { key: 'cases', label: '案件', to: '/cases' },
      { key: 'settings', label: '设置', to: '/settings/profile' },
    ]);
  });

  it.each([
    ['/', 'home'], ['/board', 'board'], ['/players/p', 'board'],
    ['/cases', 'cases'], ['/cases/7', 'cases'], ['/players/p/cases/7', 'cases'],
    ['/tools', 'cases'], ['/tools/filing', 'cases'], ['/tools/voice', 'cases'], ['/tools/score', 'cases'],
    ['/settings', 'settings'], ['/settings/profile', 'settings'], ['/settings/discord', 'settings'],
    ['/settings/members', 'settings'], ['/settings/ai', 'settings'],
    ['/board/feed', 'cases'], ['/admin', 'cases'], ['/admin/voice', 'cases'],
    ['/admin/ai', 'settings'], ['/admin/members', 'settings'],
  ] as const)('marks %s under %s', (path, current) => {
    expect(primaryNavigationKey(parseRoute(path))).toBe(current);
  });

  it.each(['/board/report', '/board/rules', '/welcome', '/guide', '/sessions/7', '/missing'])
    ('does not mark an unrelated destination for %s', (path) => {
      expect(primaryNavigationKey(parseRoute(path))).toBeNull();
    });
});
