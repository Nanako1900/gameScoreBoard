import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../src/discord/commands';
import { handleRetiredSessionButton } from '../src/discord/sessions-off';

const OFF = '约局功能已下线，这个按钮不再有效。';

describe('retired session interactions', () => {
  it('does not register /yue or describe session notifications', () => {
    expect(COMMANDS.map((command) => command.name)).not.toContain('yue');
    expect(COMMANDS.find((command) => command.name === 'todo')?.description)
      .toBe('我的待办：待写陈述（管理员还有待复核的申诉）');
    expect(JSON.stringify(COMMANDS)).not.toContain('约局');
  });

  it.each(['v1:rsvp:5:going:0', 'v1:rsvp:5:maybe:1793000000000', 'v1:rsvp:old'])
  ('answers %s privately without reading an account or session', (customId) => {
    expect(handleRetiredSessionButton(customId)).toEqual({ content: OFF, ephemeral: true });
  });

  it('leaves unrelated buttons to their handlers', () => {
    expect(handleRetiredSessionButton('v1:verdict:5')).toBeNull();
  });
});
