import { describe, expect, it } from 'vitest';
import { canReadRoom, publicCommunityJson, publicCommunitySettings, safeCommunityText } from '../src/community/security';
import { defaultCommunitySettings } from '../../shared/community';

const owner = 'ab4ce2dd-8bc9-4043-845c-d2aec97b4bfb';
const viewer = 'b10ebd61-dbd4-4804-aa54-021b345821c1';
describe('community privacy and object authorization', () => {
  it('requires current membership for ordinary members and keeps hidden rooms out of lists', () => {
    const room = { ownerRef: owner, visibility: 'hidden' as const };
    expect(canReadRoom({ memberRef: viewer, isAdmin: false, memberAvailable: true }, room, [])).toBe(false);
    expect(canReadRoom({ memberRef: viewer, isAdmin: false, memberAvailable: true }, room, [{ memberRef: viewer, allowed: true, blocked: false, present: false }])).toBe(true);
    expect(canReadRoom({ memberRef: viewer, isAdmin: false, memberAvailable: false }, room, [{ memberRef: viewer, allowed: true, blocked: false, present: false }])).toBe(false);
    expect(canReadRoom({ memberRef: owner, isAdmin: false, memberAvailable: true }, room, [])).toBe(true);
    expect(canReadRoom({ memberRef: null, isAdmin: true, memberAvailable: false }, room, [])).toBe(true);
  });
  it('does not turn a public room into access for an explicitly blocked ordinary member', () => {
    expect(canReadRoom({ memberRef: viewer, isAdmin: false, memberAvailable: true }, { ownerRef: owner, visibility: 'open' },
      [{ memberRef: viewer, allowed: false, blocked: true, present: true }])).toBe(false);
  });
  it('keeps configuration secrets and administrative resource selections out of the member view', () => {
    const value = defaultCommunitySettings();
    value.fun.ai.prompt = 'private community prompt';
    value.rooms.categoryRef = owner;
    const json = JSON.stringify(publicCommunitySettings(value));
    expect(json).not.toContain('private community prompt');
    expect(json).not.toContain(owner);
    expect(json).not.toContain('categoryRef');
  });
  it('redacts identifiers from untrusted text and strips internal result fields recursively', () => {
    expect(safeCommunityText('hello <#1114391825336250432> <@1114391825336250433>')).not.toMatch(/111439182533625043[23]/);
    const json = JSON.stringify(publicCommunityJson({ roomRef: owner, name: '房间', channel_id: '1114391825336250432',
      nested: { discord_user_id: '1114391825336250433', token: 'not-public', picks: ['safe'] } }));
    expect(json).toContain(owner);
    expect(json).not.toMatch(/111439182533625043|not-public|channel_id|discord_user_id/);
  });
});
