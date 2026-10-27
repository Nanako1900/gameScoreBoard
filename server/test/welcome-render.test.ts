import { describe, expect, it } from 'vitest';
import { GUIDE_COMMANDS, GUIDE_INTRO, GUIDE_TIPS } from '../../shared/guide';
import { renderWelcomeDm } from '../src/discord/dm';
import { renderGuideEmbed } from '../src/discord/guide';
import { voiceNotice } from '../../shared/voice';

describe('welcome DM', () => {
  it('renders the shared guide and a website link without account data or mentions', () => {
    const message = renderWelcomeDm('https://score.example');
    const text = JSON.stringify(message);
    expect(text).toContain(GUIDE_INTRO);
    for (const { name, text: description } of GUIDE_COMMANDS) { expect(text).toContain(name); expect(text).toContain(description); }
    for (const tip of GUIDE_TIPS) expect(text).toContain(tip);
    expect(message.allowed_mentions).toEqual({ parse: [] });
    expect(message.components?.[0].components[0]).toMatchObject({ label: '打开网页', url: 'https://score.example/' });
    expect(text).not.toMatch(/discord_user|channel_id|<@|<#/);
    expect(text).toContain('信息板频道');
    expect(text.split(voiceNotice())).toHaveLength(2);
  });
  it('adds a real channel link only to a configured welcome, leaving the plain guide unchanged', () => {
    for (const channel of ['12345678901234567', '12345678901234567890']) {
      const message = renderWelcomeDm('https://score.example', channel);
      const text = JSON.stringify(message);
      expect(text).toContain(`<#${channel}>`); expect(text.match(/<#/g)).toHaveLength(1);
      expect(text).not.toMatch(/<@|discord_user|channel_id/);
      expect(message.allowed_mentions).toEqual({ parse: [] });
      expect(text.split(voiceNotice())).toHaveLength(2);
      const guide = JSON.stringify(renderGuideEmbed());
      expect(guide).not.toContain(channel); expect(guide).not.toContain('<#');
      expect(message.embeds).toHaveLength(1);
      expect((message.embeds[0].fields ?? []).length).toBeLessThanOrEqual(25);
    }
  });
  it('keeps absent and invalid channel settings identical to the default welcome', () => {
    const plain = renderWelcomeDm('https://score.example');
    for (const channel of [undefined, null, '', '1234567890123456', '123456789012345678901', '12345678901234567\n',
      ' 12345678901234567', '1234567890123456x', '<#12345678901234567>', '@everyone']) {
      expect(renderWelcomeDm('https://score.example', channel)).toEqual(plain);
    }
  });
});
