import { describe, expect, it } from 'vitest';
import { GUIDE_COMMANDS, GUIDE_INTRO, GUIDE_TIPS } from '../../shared/guide';
import { COMMANDS, handleCommand } from '../../server/src/discord/commands';

const names = () => GUIDE_COMMANDS.map((command) => command.name.replace(/^\//, ''));

describe('S2 shared bot guide', () => {
  it('documents every registered command exactly once, including help', () => {
    expect([...names()].sort()).toEqual(COMMANDS.map((command) => command.name).sort());
    expect(new Set(names()).size).toBe(names().length);
    expect(names()).toContain('help');
    expect(names()).not.toContain('yue');
    expect(names()).not.toContain('voice');
  });
  it('gives the daily entry and useful DM guidance without promising later phases', () => {
    expect(GUIDE_INTRO).toContain('Discord');
    expect(GUIDE_INTRO).toContain('网页');
    expect(GUIDE_TIPS.join(' ')).toContain('私信');
    expect(GUIDE_TIPS.join(' ')).toContain('陈述');
    for (const command of GUIDE_COMMANDS) expect(command.text.trim().length).toBeGreaterThan(0);
    expect(JSON.stringify({ GUIDE_INTRO, GUIDE_COMMANDS, GUIDE_TIPS })).not.toMatch(/语音记录|信息板频道|discord_|频道 id/i);
  });
  it('answers help privately without looking up a binding', async () => {
    const db = { prepare() { throw new Error('help must not query an account'); } } as unknown as D1Database;
    const reply = await handleCommand({ commandName: 'help', caller: { id: 'unbound', username: '未绑定' }, targetUser: null },
      { db, appUrl: 'https://api.example', frontendUrl: 'https://score.example' });
    expect(reply.ephemeral).toBe(true);
    const body = JSON.stringify(reply.embeds);
    for (const command of GUIDE_COMMANDS) expect(body).toContain(command.name);
    expect(body).toContain(GUIDE_INTRO);
    expect(reply.buttons).toEqual([{ label: '打开网页', url: 'https://score.example/' }]);
  });
});
