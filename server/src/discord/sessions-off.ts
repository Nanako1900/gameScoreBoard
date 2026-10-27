// Existing cards and invitation DMs can outlive the session feature.
import { ephemeralReply } from './render';
import type { BotReply } from './types';

/** No account lookup or write: old buttons also work after unbinding. */
export function handleRetiredSessionButton(customId: string): BotReply | null {
  return customId.startsWith('v1:rsvp:')
    ? ephemeralReply('约局功能已下线，这个按钮不再有效。')
    : null;
}
