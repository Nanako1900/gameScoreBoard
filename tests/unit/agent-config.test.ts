import { describe, expect, it } from 'vitest';
import { defaultAgentSettings, parseAgentDocumentInput, parseAgentSettings, safeAgentText } from '../../shared/community-agent';

const REF = '9352c4df-dd6a-4384-86ba-f74508fc7b73';

describe('independent community Agent contracts', () => {
  it('starts disabled and returns independent defaults', () => {
    expect(defaultAgentSettings()).toEqual({ enabled: false, channelRefs: [], userDailyLimit: 20, guildDailyLimit: 200, cooldownSeconds: 10 });
    const first = defaultAgentSettings(); first.channelRefs.push(REF);
    expect(defaultAgentSettings().channelRefs).toEqual([]);
  });
  it('strictly validates channels and quota limits', () => {
    expect(parseAgentSettings({ ...defaultAgentSettings(), channelRefs: [REF, REF] }).channelRefs).toEqual([REF]);
    for (const patch of [{ channelRefs: ['111111111111111111'] }, { channelRefs: Array(11).fill(REF) }, { userDailyLimit: 0 }, { userDailyLimit: 101 }, { guildDailyLimit: 1001 }, { cooldownSeconds: 3601 }, { enabled: 'true' }, { prompt: 'ignored rules' }]) {
      expect(() => parseAgentSettings({ ...defaultAgentSettings(), ...patch })).toThrow();
    }
  });
  it('requires explicit publishing and an optimistic document version', () => {
    expect(parseAgentDocumentInput({ title: '  社区规则 ', content: '  请友善交流。 ', published: false, expectedVersion: 0 })).toEqual({ title: '社区规则', content: '请友善交流。', published: false, expectedVersion: 0 });
    for (const patch of [{ title: '' }, { title: 'a'.repeat(101) }, { content: 'a'.repeat(8001) }, { published: undefined }, { expectedVersion: -1 }, { ref: '111111111111111111' }, { url: 'https://example.com' }]) {
      expect(() => parseAgentDocumentInput({ title: '规则', content: '正文', published: false, expectedVersion: 0, ...patch })).toThrow();
    }
  });
  it('removes platform identifiers, channel links, and recognizable credential shapes from public text', () => {
    const result = safeAgentText('资料 <@111111111111111111> https://discord.com/channels/111111111111111111/222222222222222222 sk-testcredential123 Bearer abcdefghijklmnop api_key="secretvalue" 正文');
    expect(result).toContain('正文');
    for (const secret of ['111111111111111111', '222222222222222222', 'discord.com/channels', 'sk-testcredential123', 'abcdefghijklmnop', 'secretvalue']) expect(result).not.toContain(secret);
  });
});
