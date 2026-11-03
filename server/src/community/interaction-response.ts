import { MessageFlags, type APIActionRowComponent, type APIComponentInMessageActionRow, type RepliableInteraction } from 'discord.js';

export interface CommunityInteractionMessage {
  content: string;
  components: APIActionRowComponent<APIComponentInMessageActionRow>[];
  allowedMentions: { parse: [] };
}

/** The acknowledgement target is fixed before any asynchronous business work.
 * Both deferReply and deferUpdate set `deferred`, so that flag cannot select
 * the message to edit. Shared messages never receive a personal render. */
export function communityInteractionResponse(input: RepliableInteraction, quietSharedModal = false) {
  const source = input.isMessageComponent() ? input
    : input.isModalSubmit() && input.isFromMessage() ? input : null;
  const privateSource = source?.message.flags.has(MessageFlags.Ephemeral) === true;
  const quiet = quietSharedModal && source !== null && !privateSource;
  let privateFollowUp: Promise<void> | undefined;
  return {
    quiet,
    async immediate(out: CommunityInteractionMessage): Promise<void> {
      if (privateSource && source) await source.update(out);
      else await input.reply({ ...out, flags: MessageFlags.Ephemeral });
    },
    async defer(): Promise<void> {
      if ((privateSource || quiet) && source) await source.deferUpdate();
      else await input.deferReply({ flags: MessageFlags.Ephemeral });
    },
    async send(out: CommunityInteractionMessage): Promise<void> {
      if (quiet) {
        // A follow-up does not change the shared @original target. Send at most
        // one private receipt; later refreshes originate on that private card.
        privateFollowUp ??= input.followUp({ ...out, flags: MessageFlags.Ephemeral }).then(() => undefined);
        await privateFollowUp;
      } else await input.editReply(out);
    },
  };
}
