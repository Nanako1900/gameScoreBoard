import { GUIDE_COMMANDS, GUIDE_INTRO, GUIDE_TIPS } from '../../../shared/guide';
import { GOLD, safeLine, safeText } from './render';
import type { BotEmbed } from './types';

/** The same copy as GuideContent, escaped for Discord without any account data. */
export function renderGuideEmbed(): BotEmbed {
  return {
    title: '机器人指南',
    description: safeText(GUIDE_INTRO),
    color: GOLD,
    fields: [
      ...GUIDE_COMMANDS.map(({ name, text }) => ({ name: safeLine(name), value: safeText(text) })),
      { name: '使用提醒', value: safeText(GUIDE_TIPS.join('\n')) },
    ],
  };
}
