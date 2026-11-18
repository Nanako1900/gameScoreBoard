// Discord side of the music bot: one voice connection (DAVE handled inside
// @discordjs/voice via @snazzah/davey), one audio player and an ffmpeg pipeline
// per track. Exposed as the MusicVoice interface the runtime is tested against.
import { spawn as nodeSpawn } from 'node:child_process';
import type { Readable } from 'node:stream';
import {
  AudioPlayerStatus, createAudioPlayer, createAudioResource, entersState, joinVoiceChannel,
  NoSubscriberBehavior, StreamType, VoiceConnectionDisconnectReason, VoiceConnectionStatus,
  type AudioPlayerState, type VoiceConnection, type VoiceConnectionState,
} from '@discordjs/voice';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, GatewayIntentBits, Options } from 'discord.js';
import { startFfmpeg, type FfmpegPipeline } from './ffmpeg';
import type { MusicVoice } from './types';

export const MUSIC_JOIN_TIMEOUT_MS = 15_000;
export const MUSIC_RECONNECT_ATTEMPTS = 3;
export const MUSIC_RECONNECT_WINDOW_MS = 5_000;
export const MUSIC_PLAYER_BUTTON_LABEL = '打开音乐播放器';
export const MUSIC_ANNOUNCE_TEXT = 'Music 已进入语音房，点击下方按钮选歌与控制播放。';
/** Discord voice close code: the bot was removed from the channel or the call. */
const CLOSE_CODE_REMOVED = 4014;

export interface DiscordVoiceDeps {
  spawn?: typeof nodeSpawn;
  onError?: (error: unknown) => void;
}

interface Track {
  id: number;
  pipeline: FfmpegPipeline;
  idle: boolean;
  done: boolean;
  error: Error | null;
}

function removedFromChannel(state: VoiceConnectionState): boolean {
  return state.status === VoiceConnectionStatus.Disconnected
    && state.reason === VoiceConnectionDisconnectReason.WebSocketClose
    && state.closeCode === CLOSE_CODE_REMOVED;
}

function trackIdOf(state: AudioPlayerState): number | null {
  if (state.status === AudioPlayerStatus.Idle) return null;
  const id = state.resource.metadata;
  return typeof id === 'number' ? id : null;
}

export function playerButtonRow(url: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(MUSIC_PLAYER_BUTTON_LABEL).setURL(url),
  );
}

/**
 * Guilds + GuildVoiceStates only. Members and users stay cached (the default):
 * voice states bring their member along, and humans() needs its bot flag.
 */
export function createMusicClient(): Client {
  return new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
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
    }),
    allowedMentions: { parse: [] },
  });
}

export function createDiscordVoice(client: Client, guildId: string, deps: DiscordVoiceDeps = {}): MusicVoice {
  const spawn = deps.spawn ?? nodeSpawn;
  const onError = deps.onError ?? (() => undefined);
  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
  let connection: VoiceConnection | null = null;
  let track: Track | null = null;
  let nextTrackId = 0;
  let endCb: (playId: number, error: Error | null) => void = () => undefined;
  let disconnectCb: () => void = () => undefined;

  /** Reports a track once both the player went idle and ffmpeg has exited. */
  const updateTrack = (id: number, patch: Partial<Track>): void => {
    if (!track || track.id !== id) return;
    const next = { ...track, ...patch, error: track.error ?? patch.error ?? null };
    track = next;
    if (!next.idle || !next.done) return;
    track = null;
    endCb(id, next.error);
  };

  player.on('stateChange', (previous, current) => {
    const id = trackIdOf(previous);
    if (id !== null && current.status === AudioPlayerStatus.Idle) updateTrack(id, { idle: true });
  });
  player.on('error', (error) => {
    const id = error.resource.metadata;
    if (typeof id !== 'number' || !track || track.id !== id) return;
    // The player abandons the resource: ffmpeg would block on a full pipe.
    track.pipeline.kill();
    updateTrack(id, { error, done: true });
  });

  const killTrack = (): void => {
    track?.pipeline.kill();
    track = null;
  };

  const destroyConnection = (): void => {
    const current = connection;
    connection = null;
    if (current && current.state.status !== VoiceConnectionStatus.Destroyed) current.destroy();
  };

  const reportDisconnect = (target: VoiceConnection): void => {
    if (connection !== target) return;
    killTrack();
    player.stop(true);
    destroyConnection();
    disconnectCb();
  };

  /** The library's documented pattern: a move or region change passes through Signalling/Connecting. */
  async function recover(target: VoiceConnection, state: VoiceConnectionState): Promise<void> {
    try {
      await Promise.race([
        entersState(target, VoiceConnectionStatus.Signalling, MUSIC_RECONNECT_WINDOW_MS),
        entersState(target, VoiceConnectionStatus.Connecting, MUSIC_RECONNECT_WINDOW_MS),
      ]);
      await entersState(target, VoiceConnectionStatus.Ready, MUSIC_JOIN_TIMEOUT_MS);
    } catch {
      if (connection !== target) return;
      if (removedFromChannel(state) || target.rejoinAttempts >= MUSIC_RECONNECT_ATTEMPTS) {
        reportDisconnect(target);
        return;
      }
      if (!target.rejoin()) {
        reportDisconnect(target);
        return;
      }
      await entersState(target, VoiceConnectionStatus.Ready, MUSIC_JOIN_TIMEOUT_MS).catch(() => {
        // A fresh Disconnected already started its own recovery; anything else is stuck.
        if (target.state.status !== VoiceConnectionStatus.Disconnected) reportDisconnect(target);
      });
    }
  }

  function wire(target: VoiceConnection): void {
    target.on(VoiceConnectionStatus.Disconnected, (_previous, state) => {
      void recover(target, state).catch(onError);
    });
    target.on(VoiceConnectionStatus.Destroyed, () => reportDisconnect(target));
  }

  async function join(channelId: string): Promise<void> {
    if (connection?.joinConfig.channelId === channelId && connection.state.status === VoiceConnectionStatus.Ready) return;
    destroyConnection();
    const guild = client.guilds.cache.get(guildId);
    if (!guild?.available) throw new Error('the guild is not available yet');
    const target = joinVoiceChannel({
      channelId, guildId, adapterCreator: guild.voiceAdapterCreator, selfDeaf: true, selfMute: false,
    });
    target.on('error', onError);
    try {
      await entersState(target, VoiceConnectionStatus.Ready, MUSIC_JOIN_TIMEOUT_MS);
    } catch {
      target.destroy();
      throw new Error('the voice connection did not become ready in time');
    }
    connection = target;
    wire(target);
    target.subscribe(player);
  }

  function play(input: { stream: Readable; seekMs: number; volume: number }): number {
    killTrack();
    const id = ++nextTrackId;
    const pipeline = startFfmpeg(input.stream, {
      seekMs: input.seekMs,
      volume: input.volume,
      done: (error) => updateTrack(id, { done: true, error }),
    }, spawn);
    track = { id, pipeline, idle: false, done: false, error: null };
    player.play(createAudioResource(pipeline.output, { inputType: StreamType.OggOpus, metadata: id }));
    return id;
  }

  function humans(channelId: string): number | null {
    const guild = client.guilds.cache.get(guildId);
    if (!guild?.available) return null;
    const selfId = client.user?.id;
    return [...guild.voiceStates.cache.values()].filter((state) => {
      if (state.channelId !== channelId || state.id === selfId) return false;
      // Members arrive with their voice states and stay cached in this process;
      // an unknown user is counted as human so the bot never leaves people early.
      const user = state.member?.user ?? client.users.cache.get(state.id);
      return user?.bot !== true;
    }).length;
  }

  async function announce(channelId: string, url: string): Promise<void> {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isVoiceBased() || !channel.isSendable()) throw new Error('the voice channel chat is not available');
    await channel.send({ content: MUSIC_ANNOUNCE_TEXT, components: [playerButtonRow(url)], allowedMentions: { parse: [] } });
  }

  return {
    join,
    play,
    pause: () => { player.pause(); },
    resume: () => { player.unpause(); },
    stop: () => { killTrack(); player.stop(true); },
    leave: () => { killTrack(); player.stop(true); destroyConnection(); },
    onEnd: (cb) => { endCb = cb; },
    onDisconnect: (cb) => { disconnectCb = cb; },
    humans,
    announce,
  };
}
