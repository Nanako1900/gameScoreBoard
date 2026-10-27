import { EventEmitter } from 'node:events';
import { Client, Events, GatewayIntentBits, Options } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VOICE_UNKNOWN_CHANNEL } from '../../shared/voice';
import { createClient, readVoicePresence, wireVoice } from '../src/discord/gateway';
import type { VoiceRecorder } from '../src/voice/recorder';

const GUILD = 'target-guild';
const USER = 'bound-user';
function state(channelId: string | null, name: string | null = '开黑一号', guildId = GUILD, userId = USER) {
  return { id: userId, channelId, channel: name === null ? null : { name }, guild: { id: guildId },
    get member(): never { throw new Error('Member cache must not be read'); } };
}
function guild(id = GUILD, available = true) {
  return { id, available, shardId: 2, voiceStates: { cache: new Map([[USER, state('channel-a')]]) } };
}
function fakeClient() {
  const emitter = new EventEmitter();
  const target = guild();
  const cache = new Map([[GUILD, target]]);
  Object.assign(emitter, { guilds: { cache }, isReady: () => false });
  return { client: emitter as unknown as Client, emitter, target, cache };
}
function recorder() {
  return { onVoiceUpdate: vi.fn(async () => {}), reconcile: vi.fn(async () => {}), resume: vi.fn(async () => {}),
    start: vi.fn(), stop: vi.fn(async () => {}), heartbeat: vi.fn(async () => {}), cleanup: vi.fn(async () => {}),
    status: vi.fn() } as unknown as VoiceRecorder;
}
afterEach(() => vi.restoreAllMocks());

describe('voice gateway client', () => {
  it('requests only guild and voice-state intents and retains the voice cache', async () => {
    const cacheWithLimits = vi.spyOn(Options, 'cacheWithLimits');
    const client = createClient();
    try {
      expect(client.options.intents.toArray().sort()).toEqual([GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
        .map((bit) => GatewayIntentBits[bit]).sort());
      const limits = cacheWithLimits.mock.calls[0][0];
      expect(limits).not.toHaveProperty('VoiceStateManager');
      expect(limits).toMatchObject({ MessageManager: 0, PresenceManager: 0, GuildMemberManager: { maxSize: 0 }, UserManager: { maxSize: 0 } });
      expect(client.options.allowedMentions).toEqual({ parse: [] });
    } finally { await client.destroy(); }
  });
});

describe('voice cache snapshots', () => {
  it('reads current channel facts without needing member/user caches or network requests', () => {
    const { client, target } = fakeClient();
    target.voiceStates.cache.set('offline', state(null, null, GUILD, 'offline'));
    target.voiceStates.cache.set('unknown', state('channel-b', null, GUILD, 'unknown'));
    expect(readVoicePresence(client, GUILD)).toEqual([
      { discordUserId: USER, channelId: 'channel-a', channelName: '开黑一号' },
      { discordUserId: 'unknown', channelId: 'channel-b', channelName: VOICE_UNKNOWN_CHANNEL },
    ]);
    target.voiceStates.cache.delete(USER);
    expect(readVoicePresence(client, GUILD)).toEqual([{ discordUserId: 'unknown', channelId: 'channel-b', channelName: VOICE_UNKNOWN_CHANNEL }]);
  });
  it('distinguishes an unavailable/missing guild from a complete empty snapshot', () => {
    const { client, target, cache } = fakeClient();
    target.available = false; expect(readVoicePresence(client, GUILD)).toBeNull();
    target.available = true; target.voiceStates.cache.clear(); expect(readVoicePresence(client, GUILD)).toEqual([]);
    cache.clear(); expect(readVoicePresence(client, GUILD)).toBeNull();
  });
});

describe('voice gateway events', () => {
  it('passes the raw voice transition into the recorder without querying binding or member caches', () => {
    const { client, emitter } = fakeClient(); const recording = recorder(); wireVoice(client, recording, GUILD);
    emitter.emit(Events.VoiceStateUpdate, state(null), state('channel-a'));
    expect(recording.onVoiceUpdate).toHaveBeenCalledExactlyOnceWith({ discordUserId: USER,
      prevChannelId: null, nextChannelId: 'channel-a', nextChannelName: '开黑一号' });
  });
  it('passes an uncached channel name as null for the recorder fallback', () => {
    const { client, emitter } = fakeClient(); const recording = recorder(); wireVoice(client, recording, GUILD);
    emitter.emit(Events.VoiceStateUpdate, state('channel-a'), state('channel-b', null));
    expect(recording.onVoiceUpdate).toHaveBeenCalledWith({ discordUserId: USER,
      prevChannelId: 'channel-a', nextChannelId: 'channel-b', nextChannelName: null });
  });
  it('ignores voice changes in another guild', () => {
    const { client, emitter } = fakeClient(); const recording = recorder(); wireVoice(client, recording, GUILD);
    emitter.emit(Events.VoiceStateUpdate, state(null, null, 'other-guild'), state('channel-a', '别处', 'other-guild'));
    expect(recording.onVoiceUpdate).not.toHaveBeenCalled();
  });
  it('reconciles every complete target GuildAvailable before ClientReady, without a second ShardReady reconcile', () => {
    const { client, emitter, target } = fakeClient(); const recording = recorder(); wireVoice(client, recording, GUILD);
    expect(client.isReady()).toBe(false);
    emitter.emit(Events.GuildAvailable, target);
    emitter.emit(Events.ShardReady, target.shardId);
    expect(recording.reconcile).toHaveBeenCalledTimes(1);
    emitter.emit(Events.GuildAvailable, target);
    expect(recording.reconcile).toHaveBeenCalledTimes(2);
  });
  it('does not reconcile an unavailable target or another guild', () => {
    const { client, emitter } = fakeClient(); const recording = recorder(); wireVoice(client, recording, GUILD);
    emitter.emit(Events.GuildAvailable, guild(GUILD, false));
    emitter.emit(Events.GuildAvailable, guild('other-guild'));
    expect(recording.reconcile).not.toHaveBeenCalled();
  });
  it('resumes only the available target guild shard', () => {
    const { client, emitter, target, cache } = fakeClient(); const recording = recorder(); wireVoice(client, recording, GUILD);
    emitter.emit(Events.ShardResume, 8, 3); expect(recording.resume).not.toHaveBeenCalled();
    emitter.emit(Events.ShardResume, target.shardId, 3); expect(recording.resume).toHaveBeenCalledTimes(1);
    target.available = false; emitter.emit(Events.ShardResume, target.shardId, 3);
    cache.clear(); emitter.emit(Events.ShardResume, 2, 3);
    expect(recording.resume).toHaveBeenCalledTimes(1);
    expect(recording.reconcile).not.toHaveBeenCalled();
  });
  it('starts timers once after ClientReady and detaches all voice hooks on disposal', () => {
    const { client, emitter, target } = fakeClient(); const recording = recorder(); const dispose = wireVoice(client, recording, GUILD);
    expect(recording.start).not.toHaveBeenCalled();
    emitter.emit(Events.ClientReady, client); emitter.emit(Events.ClientReady, client);
    expect(recording.start).toHaveBeenCalledTimes(1);
    dispose();
    emitter.emit(Events.GuildAvailable, target);
    emitter.emit(Events.VoiceStateUpdate, state(null), state('channel-a'));
    emitter.emit(Events.ShardResume, target.shardId, 3);
    expect(recording.onVoiceUpdate).not.toHaveBeenCalled(); expect(recording.reconcile).not.toHaveBeenCalled();
    expect(recording.resume).not.toHaveBeenCalled();
  });
  it('can dispose before login completes without starting timers', () => {
    const { client, emitter } = fakeClient(); const recording = recorder(); const dispose = wireVoice(client, recording, GUILD);
    dispose(); emitter.emit(Events.ClientReady, client); expect(recording.start).not.toHaveBeenCalled();
  });
  it('handles an unexpected rejected callback without logging identifiers', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client, emitter, target } = fakeClient(); const recording = recorder();
    vi.mocked(recording.reconcile).mockRejectedValueOnce(new Error('raw Discord user ID 123456789 channel 987654321'));
    wireVoice(client, recording, GUILD); emitter.emit(Events.GuildAvailable, target);
    await Promise.resolve();
    expect(error).toHaveBeenCalled();
    expect(JSON.stringify(error.mock.calls)).not.toMatch(/123456789|987654321/);
  });
});
