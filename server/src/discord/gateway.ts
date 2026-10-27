// Testable Gateway setup. No login or network work occurs at import time.
import { Client, Events, GatewayIntentBits, Options, type Guild, type VoiceState } from 'discord.js';
import { VOICE_UNKNOWN_CHANNEL } from '../../../shared/voice';
import type { VoicePresent, VoiceRecorder } from '../voice/recorder';

export function createClient(): Client {
  return new Client({
    // No GuildMembers, GuildPresences or MessageContent: slash commands bring
    // the users they mention with them.
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
    // Voice states must survive for complete-state reconciliation. Members and
    // users remain uncached; slash commands carry the users they mention.
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 0,
      ReactionManager: 0,
      PresenceManager: 0,
      ThreadMemberManager: 0,
      GuildEmojiManager: 0,
      GuildStickerManager: 0,
      GuildInviteManager: 0,
      GuildBanManager: 0,
      GuildScheduledEventManager: 0,
      StageInstanceManager: 0,
      AutoModerationRuleManager: 0,
      GuildMemberManager: { maxSize: 0, keepOverLimit: (member) => member.id === member.client.user.id },
      UserManager: { maxSize: 0, keepOverLimit: (user) => user.id === user.client.user.id },
    }),
    // Every reply sets this too (toReplyOptions); this covers anything that does not.
    allowedMentions: { parse: [] },
  });
}


/** null is an unavailable snapshot, not evidence that nobody is in voice. */
export function readVoicePresence(client: Client, guildId: string): readonly VoicePresent[] | null {
  const guild = client.guilds.cache.get(guildId);
  if (!guild?.available) return null;
  return [...guild.voiceStates.cache.values()].flatMap((state) => {
    if (state.channelId === null) return [];
    const name = state.channel?.name;
    return [{ discordUserId: state.id, channelId: state.channelId,
      channelName: name?.trim() ? name : VOICE_UNKNOWN_CHANNEL }];
  });
}

type GatewayRecorder = Pick<VoiceRecorder, 'onVoiceUpdate' | 'reconcile' | 'resume' | 'start'>;

/** Hang these hooks before login: GuildAvailable can precede ClientReady. */
export function wireVoice(client: Client, recorder: GatewayRecorder, guildId: string): () => void {
  const run = (work: () => void | Promise<void>): void => {
    try {
      void Promise.resolve(work()).catch(() => console.error('Voice gateway event processing failed'));
    } catch { console.error('Voice gateway event processing failed'); }
  };
  const update = (prev: VoiceState, next: VoiceState): void => {
    if (next.guild.id !== guildId) return;
    const input = { discordUserId: next.id, prevChannelId: prev.channelId,
      nextChannelId: next.channelId, nextChannelName: next.channel?.name ?? null };
    run(() => recorder.onVoiceUpdate(input));
  };
  const available = (guild: Guild): void => {
    if (guild.id === guildId && guild.available) run(() => recorder.reconcile());
  };
  const resume = (shardId: number): void => {
    const guild = client.guilds.cache.get(guildId);
    if (guild?.available && guild.shardId === shardId) run(() => recorder.resume());
  };
  const ready = (): void => run(() => recorder.start());
  client.on(Events.VoiceStateUpdate, update);
  client.on(Events.GuildAvailable, available);
  client.on(Events.ShardResume, resume);
  client.once(Events.ClientReady, ready);
  return () => {
    client.off(Events.VoiceStateUpdate, update);
    client.off(Events.GuildAvailable, available);
    client.off(Events.ShardResume, resume);
    client.off(Events.ClientReady, ready);
  };
}
