import { describe, expect, it } from 'vitest';
import { GUIDE_COMMANDS, GUIDE_INTRO, GUIDE_TIPS } from '../../shared/guide';
import { renderWelcomeDm } from '../src/discord/dm';

describe('welcome DM', () => {
  it('renders the shared guide and a website link without account data or mentions', () => {
    const message = renderWelcomeDm('https://score.example');
    const text = JSON.stringify(message);
    expect(text).toContain(GUIDE_INTRO);
    for (const { name, text: description } of GUIDE_COMMANDS) { expect(text).toContain(name); expect(text).toContain(description); }
    for (const tip of GUIDE_TIPS) expect(text).toContain(tip);
    expect(message.allowed_mentions).toEqual({ parse: [] });
    expect(message.components?.[0].components[0]).toMatchObject({ label: '打开网页', url: 'https://score.example/' });
    expect(text).not.toMatch(/discord_user|channel_id|<@/);
  });
});
