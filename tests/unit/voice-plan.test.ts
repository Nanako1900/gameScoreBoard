import { describe, expect, it } from 'vitest';
import { planReconcile, planVoiceUpdate } from '../../server/src/voice/plan';
import { VOICE_UNKNOWN_CHANNEL } from '../../shared/voice';
const D = 'discord-fixture';
const update = (prev: string | null, next: string | null, bound = true, channelName: string | null = '开黑一号') =>
  planVoiceUpdate({ channelId: prev }, { channelId: next, channelName }, D, bound);

describe('voice update decisions', () => {
  it('opens a joined segment only for a currently bound caller', () => {
    expect(update(null, 'one')).toEqual([{ kind: 'open', discordUserId: D, channelId: 'one', channelName: '开黑一号', reason: 'joined' }]);
    expect(update(null, 'one', false)).toEqual([]);
  });
  it.each([false, true])('closes a leaving account regardless of current binding: %s', (bound) => {
    expect(update('one', null, bound)).toEqual([{ kind: 'close', discordUserId: D, reason: 'left' }]);
  });
  it('orders close before open for a move', () => {
    expect(update('one', 'two')).toEqual([
      { kind: 'close', discordUserId: D, reason: 'moved' },
      { kind: 'open', discordUserId: D, channelId: 'two', channelName: '开黑一号', reason: 'moved' },
    ]);
    expect(update('one', 'two', false)).toEqual([{ kind: 'close', discordUserId: D, reason: 'moved' }]);
  });
  it.each(['one', null])('ignores updates with no channel change, including mute/video: %s', (channel) => {
    expect(update(channel, channel)).toEqual([]);
  });
  it.each([null, '', '   '])('uses a safe unknown-channel name when the cache name is empty: %s', (name) => {
    expect(update(null, 'one', true, name)[0]).toMatchObject({ channelName: VOICE_UNKNOWN_CHANNEL });
  });
});

describe('complete guild snapshot reconciliation', () => {
  const old = { discordUserId: D, channelId: 'one' };
  const present = { ...old, channelName: '一号' };
  const bound = new Set([D]);
  it('keeps an existing segment when the snapshot still has the same channel', () => {
    expect(planReconcile([old], [present], bound)).toEqual([]);
  });
  it('closes a vanished person with bot_offline', () => {
    expect(planReconcile([old], [], new Set())).toEqual([{ kind: 'close', discordUserId: D, reason: 'bot_offline' }]);
  });
  it('closes a stale channel before reopening the current one as bot_online', () => {
    expect(planReconcile([old], [{ ...present, channelId: 'two' }], bound)).toEqual([
      { kind: 'close', discordUserId: D, reason: 'bot_offline' },
      { kind: 'open', discordUserId: D, channelId: 'two', channelName: '一号', reason: 'bot_online' },
    ]);
  });
  it('opens only bound people present without an existing segment', () => {
    expect(planReconcile([], [present, { ...present, discordUserId: 'unbound' }], bound)).toEqual([
      { kind: 'open', discordUserId: D, channelId: 'one', channelName: '一号', reason: 'bot_online' },
    ]);
  });
  it('does not reopen an unbound person who changed channels', () => {
    expect(planReconcile([old], [{ ...present, channelId: 'two' }], new Set())).toEqual([
      { kind: 'close', discordUserId: D, reason: 'bot_offline' },
    ]);
  });
  it('does not mutate the supplied snapshot and keeps users isolated', () => {
    const open = Object.freeze([Object.freeze(old), Object.freeze({ discordUserId: 'left', channelId: 'two' })]);
    const snapshot = Object.freeze([Object.freeze(present), Object.freeze({ discordUserId: 'new', channelId: 'three', channelName: '' })]);
    expect(planReconcile(open, snapshot, new Set([D, 'new']))).toEqual([
      { kind: 'close', discordUserId: 'left', reason: 'bot_offline' },
      { kind: 'open', discordUserId: 'new', channelId: 'three', channelName: VOICE_UNKNOWN_CHANNEL, reason: 'bot_online' },
    ]);
  });
});
