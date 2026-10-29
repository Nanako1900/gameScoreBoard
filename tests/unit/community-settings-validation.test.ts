import { describe, expect, it } from 'vitest';
import { CommunitySettingsValidationError, communitySettingsIssues, defaultCommunitySettings, parseCommunitySettings } from '../../shared/community';

const REF = '9352c4df-dd6a-4384-86ba-f74508fc7b73';
function assign(value: unknown, path: string, next: unknown): void {
  const fields = path.split('.'); let target = value as Record<string, unknown>;
  for (const key of fields.slice(0, -1)) target = target[key] as Record<string, unknown>;
  target[fields.at(-1)!] = next;
}

describe('structured community settings validation', () => {
  it('uses one strict decoder for parse results and all independent field issues', () => {
    const value = defaultCommunitySettings(); value.rooms.emptyGraceSeconds = 14; value.welcome.template = '';
    value.fun.ai.prompt = ''; value.fun.topics[0].text = ''; value.fun.topics[0].tags = [''];
    const issues = communitySettingsIssues(value);
    expect(issues.map(issue => issue.path)).toEqual(expect.arrayContaining([
      'rooms.emptyGraceSeconds', 'welcome.template', 'fun.ai.prompt', 'fun.topics.0.text', 'fun.topics.0.tags.0',
    ]));
    expect(issues.find(issue => issue.path === 'rooms.emptyGraceSeconds')?.message).toMatch(/15.*86400/);
    try { parseCommunitySettings(value); throw new Error('invalid settings unexpectedly parsed'); }
    catch (error) { expect(error).toBeInstanceOf(CommunitySettingsValidationError); expect((error as CommunitySettingsValidationError).issues).toEqual(issues); }
    expect(value.fun.topics[0].text).toBe('');
  });
  it.each([
    ['rooms.maxPerMember', 1, 1], ['rooms.maxRooms', 1, 100], ['rooms.cooldownSeconds', 0, 3600],
    ['rooms.emptyGraceSeconds', 15, 86400], ['rooms.ownerGraceSeconds', 15, 86400], ['rooms.userLimit', 0, 99],
    ['rooms.maxUserLimit', 1, 99], ['welcome.rejoinCooldownHours', 1, 720], ['roles.maxChoices', 1, 5],
    ['fun.cooldownSeconds', 0, 3600], ['fun.pollMaxHours', 1, 720], ['fun.pollMaxOptions', 2, 10],
    ['fun.maxParticipants', 2, 100], ['fun.maxDiceCount', 1, 100], ['fun.maxDiceSides', 2, 1000000],
    ['fun.ai.userDailyLimit', 1, 1000], ['fun.ai.guildDailyLimit', 1, 10000],
  ] as const)('keeps the existing integer range for %s (%s–%s)', (path, min, max) => {
    for (const good of [min, max]) { const value = defaultCommunitySettings(); assign(value, path, good); expect(communitySettingsIssues(value)).toEqual([]); }
    for (const bad of [min - 1, max + 1, min + 0.5, NaN, Infinity, String(min)]) {
      const value = defaultCommunitySettings(); assign(value, path, bad);
      expect(communitySettingsIssues(value)).toEqual(expect.arrayContaining([expect.objectContaining({ path })]));
      expect(() => parseCommunitySettings(value)).toThrow(CommunitySettingsValidationError);
    }
  });
  it.each([
    ['welcome.template', 1500], ['fun.ai.prompt', 4000], ['fun.topics.0.text', 500], ['fun.topics.0.tags.0', 30],
  ] as const)('keeps the existing required-text limit for %s', (path, max) => {
    const value = defaultCommunitySettings(); value.fun.topics[0].tags = ['tag'];
    assign(value, path, 'x'.repeat(max)); expect(communitySettingsIssues(value)).toEqual([]);
    for (const bad of ['', '  ', 'x'.repeat(max + 1), null, 123]) {
      assign(value, path, bad); expect(communitySettingsIssues(value).some(issue => issue.path === path)).toBe(true);
    }
  });
  it('reports each dependent enablement and cross-field constraint at its own field', () => {
    const value = defaultCommunitySettings(); value.enabled = true; value.rooms.enabled = true; value.welcome.enabled = true;
    value.rooms.userLimit = 6; value.rooms.maxUserLimit = 5;
    expect(communitySettingsIssues(value).map(issue => issue.path)).toEqual(expect.arrayContaining([
      'rooms.categoryRef', 'rooms.creatorRef', 'welcome.channelRef', 'rooms.userLimit',
    ]));
    value.rooms.waitingRef = REF; value.rooms.creatorRef = REF;
    expect(communitySettingsIssues(value).some(issue => issue.path === 'rooms.waitingRef')).toBe(true);
  });
  it('rejects unknown fields without echoing arbitrary property names or values', () => {
    const value = defaultCommunitySettings() as unknown as Record<string, unknown>;
    value['secret_1114391825336250432'] = 'private prompt content';
    (value.rooms as Record<string, unknown>)['token_hidden-value'] = 'do not echo';
    const issues = communitySettingsIssues(value);
    expect(issues.map(issue => issue.path)).toEqual(expect.arrayContaining(['', 'rooms']));
    const text = JSON.stringify(issues);
    for (const secret of ['1114391825336250432', 'private prompt content', 'token_hidden-value', 'do not echo']) expect(text).not.toContain(secret);
    expect(() => parseCommunitySettings(value)).toThrow(CommunitySettingsValidationError);
  });
  it('reports nested topic references and unsupported placeholders without dropping invalid entries', () => {
    const value = defaultCommunitySettings(); value.fun.topics[0].ref = '1114391825336250432';
    value.welcome.template = '欢迎 {private-secret-placeholder}';
    const issues = communitySettingsIssues(value);
    expect(issues.map(issue => issue.path)).toEqual(expect.arrayContaining(['fun.topics.0.ref', 'welcome.template']));
    expect(JSON.stringify(issues)).not.toContain('1114391825336250432');
    expect(JSON.stringify(issues)).not.toContain('private-secret-placeholder');
    expect(() => parseCommunitySettings(value)).toThrow(CommunitySettingsValidationError);
  });
  it('accepts legacy missing fixed categories, normalizes allowed duplicates, and preserves unrelated defaults', () => {
    const value = defaultCommunitySettings(); delete value.rooms.fixedCategoryRefs; value.roles.allowedRefs = [REF, REF];
    expect(communitySettingsIssues(value)).toEqual([]);
    expect(parseCommunitySettings(value)).toMatchObject({ rooms: { fixedCategoryRefs: [], emptyGraceSeconds: 120 }, roles: { allowedRefs: [REF] } });
  });
  it('reports malformed whole groups without artificial nested cascades', () => {
    expect(communitySettingsIssues(null)).toEqual([expect.objectContaining({ path: '', label: expect.any(String) })]);
    const value = defaultCommunitySettings();
    expect(communitySettingsIssues({ ...value, rooms: null, welcome: { ...value.welcome, enabled: 'yes' } }).map(issue => issue.path))
      .toEqual(['rooms', 'welcome.enabled']);
  });
  it('keeps array limits strict before deduplication and retains empty valid topic collections', () => {
    const value = defaultCommunitySettings(); value.fun.topics = []; expect(communitySettingsIssues(value)).toEqual([]);
    expect(communitySettingsIssues({ ...value, rooms: { ...value.rooms, fixedCategoryRefs: Array(101).fill(REF) } }).some(issue => issue.path === 'rooms.fixedCategoryRefs')).toBe(true);
    expect(communitySettingsIssues({ ...value, fun: { ...value.fun, topics: Array(201).fill({ ref: REF, text: 'valid', tags: [] }) } }).some(issue => issue.path === 'fun.topics')).toBe(true);
  });
});
