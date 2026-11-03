import { describe, expect, it } from 'vitest';
import { defaultCommunitySettings, parseCommunitySettings } from '../../shared/community';
import { publicCommunitySettings } from '../../server/src/community/security';

describe('retired community tools configuration', () => {
  it('starts with a disabled compatibility shell containing no topics or AI prompt', () => {
    expect(defaultCommunitySettings().fun).toMatchObject({ enabled: false, enabledTools: [], topics: [], ai: { enabled: false, prompt: '' } });
  });

  it.each([undefined, null, 'obsolete', { enabled: true, enabledTools: ['ai', 'poll'], topics: [{ text: 'OLD_PRIVATE_TOPIC' }], ai: { enabled: true, prompt: 'OLD_PRIVATE_PROMPT' } }])
  ('ignores omitted or malformed legacy tool settings without reviving them (%j)', legacy => {
    const value = defaultCommunitySettings();
    const parsed = parseCommunitySettings({ ...value, fun: legacy });
    expect(parsed.fun).toEqual(defaultCommunitySettings().fun);
    expect(parsed.fun).toMatchObject({ enabled: false, enabledTools: [], topics: [], ai: { enabled: false, prompt: '' } });
    expect(JSON.stringify(parsed)).not.toMatch(/OLD_PRIVATE_TOPIC|OLD_PRIVATE_PROMPT/);
  });

  it('never publishes legacy topic tags or enabled tools from an unnormalized object', () => {
    const value = defaultCommunitySettings();
    value.fun.enabled = true; value.fun.enabledTools = ['poll', 'ai']; value.fun.ai.enabled = true;
    value.fun.ai.prompt = 'OLD_PRIVATE_PROMPT'; value.fun.topics = [{ ref: crypto.randomUUID(), text: 'OLD_PRIVATE_TOPIC', tags: ['PRIVATE_TAG'] }];
    const publicValue = publicCommunitySettings(value);
    expect(publicValue.fun).toMatchObject({ enabled: false, enabledTools: [], tags: [], ai: { enabled: false } });
    expect(JSON.stringify(publicValue)).not.toMatch(/PRIVATE_TAG|OLD_PRIVATE/);
  });
});
