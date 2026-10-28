import { describe, expect, it } from 'vitest';
import { defaultCommunitySettings, isCommunityRef, parseCommunitySettings } from '../../shared/community';

const REF = '9352c4df-dd6a-4384-86ba-f74508fc7b73';

describe('community settings and resource references', () => {
  it('uses the approved defaults without enabling unconfigured public effects', () => {
    const value = defaultCommunitySettings();
    expect(value.enabled).toBe(false);
    expect(value.rooms).toMatchObject({ visibility: 'open', maxPerMember: 1, emptyGraceSeconds: 120, ownerGraceSeconds: 120 });
    expect(value.welcome).toMatchObject({ enabled: false, rejoinCooldownHours: 24 });
    expect(value.roles).toMatchObject({ maxChoices: 5, allowedRefs: [] });
    expect(value.fun.ai).toMatchObject({ enabled: false, userDailyLimit: 5, guildDailyLimit: 50 });
  });
  it('only accepts opaque resource UUIDs, never raw Discord identifiers or encoded payloads', () => {
    expect(isCommunityRef(REF)).toBe(true);
    for (const value of ['1114391825336250432', 'discord:1114391825336250432', 'MTExNDM5MTgyNTMzNjI1MDQzMg==', '', null]) {
      expect(isCommunityRef(value)).toBe(false);
    }
  });
  it('validates and normalizes the complete settings atomically', () => {
    const value = defaultCommunitySettings();
    value.rooms.categoryRef = REF;
    value.roles.allowedRefs = [REF, REF];
    expect(parseCommunitySettings(value).roles.allowedRefs).toEqual([REF]);
    expect(() => parseCommunitySettings({ ...value, rooms: { ...value.rooms, emptyGraceSeconds: -1 } })).toThrow();
    expect(() => parseCommunitySettings({ ...value, rooms: { ...value.rooms, categoryRef: '1114391825336250432' } })).toThrow();
    expect(() => parseCommunitySettings({ ...value, fun: { ...value.fun, ai: { ...value.fun.ai, userDailyLimit: 0 } } })).toThrow();
    expect(() => parseCommunitySettings({ ...value, secret: 'do-not-accept-unknown-configuration' })).toThrow();
  });
  it('never returns shared mutable arrays between default settings', () => {
    const first = defaultCommunitySettings(), second = defaultCommunitySettings();
    first.roles.allowedRefs.push(REF);
    first.fun.topics.push({ ref: REF, text: '新话题', tags: ['新'] });
    expect(second.roles.allowedRefs).toEqual([]);
    expect(second.fun.topics.some(t => t.text === '新话题')).toBe(false);
  });
});
