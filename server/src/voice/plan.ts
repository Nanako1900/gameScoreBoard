// Pure decisions; the recorder obtains binding/cache facts inside its queues.
import { VOICE_UNKNOWN_CHANNEL, type VoiceEndReason, type VoiceStartReason } from '../../../shared/voice';

export type VoiceAction =
  | { kind: 'open'; discordUserId: string; channelId: string; channelName: string; reason: VoiceStartReason }
  | { kind: 'close'; discordUserId: string; reason: VoiceEndReason };

const channelName = (name: string | null): string => name?.trim() ? name : VOICE_UNKNOWN_CHANNEL;

export function planVoiceUpdate(prev: { channelId: string | null }, next: { channelId: string | null; channelName: string | null },
  discordUserId: string, bound: boolean): VoiceAction[] {
  if (prev.channelId === next.channelId) return [];
  if (next.channelId === null) return [{ kind: 'close', discordUserId, reason: 'left' }];
  const actions: VoiceAction[] = prev.channelId === null ? [] : [{ kind: 'close', discordUserId, reason: 'moved' }];
  if (bound) actions.push({ kind: 'open', discordUserId, channelId: next.channelId, channelName: channelName(next.channelName),
    reason: prev.channelId === null ? 'joined' : 'moved' });
  return actions;
}

export function planReconcile(open: readonly { discordUserId: string; channelId: string }[],
  present: readonly { discordUserId: string; channelId: string; channelName: string }[], bound: ReadonlySet<string>): VoiceAction[] {
  const existing = new Map(open.map((row) => [row.discordUserId, row]));
  const current = new Map(present.map((row) => [row.discordUserId, row]));
  const close: VoiceAction[] = open.filter((row) => current.get(row.discordUserId)?.channelId !== row.channelId)
    .map((row) => ({ kind: 'close', discordUserId: row.discordUserId, reason: 'bot_offline' }));
  const start: VoiceAction[] = present.filter((row) => bound.has(row.discordUserId) && existing.get(row.discordUserId)?.channelId !== row.channelId)
    .map((row) => ({ kind: 'open', discordUserId: row.discordUserId, channelId: row.channelId,
      channelName: channelName(row.channelName), reason: 'bot_online' }));
  return [...close, ...start];
}
