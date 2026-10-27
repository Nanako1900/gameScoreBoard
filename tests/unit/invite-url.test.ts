import { describe, expect, it } from 'vitest';
import { parseInviteUrl } from '../../src/lib/inviteUrl';

// VITE_DISCORD_INVITE_URL becomes an href on the welcome card; a bad value must
// hide the row, never render a broken or unsafe link.

describe('parseInviteUrl', () => {
  it('accepts an absolute https URL', () => {
    expect(parseInviteUrl('https://discord.nanako.org')).toBe('https://discord.nanako.org/');
    expect(parseInviteUrl('  https://discord.nanako.org/join  ')).toBe('https://discord.nanako.org/join');
  });

  it('treats unset and blank as not configured', () => {
    expect(parseInviteUrl(undefined)).toBeNull();
    expect(parseInviteUrl('')).toBeNull();
    expect(parseInviteUrl('   ')).toBeNull();
  });

  it('rejects anything that is not an absolute https URL', () => {
    expect(parseInviteUrl('http://discord.nanako.org')).toBeNull();
    expect(parseInviteUrl('javascript:alert(1)')).toBeNull();
    expect(parseInviteUrl('discord.gg/abc123')).toBeNull();
    expect(parseInviteUrl('/join')).toBeNull();
  });

  it('rejects a URL carrying credentials', () => {
    expect(parseInviteUrl('https://user:pw@discord.nanako.org')).toBeNull();
  });
});
