// Shared evidence policy: the recorder, APIs, bot and web use these same limits.
export const VOICE_RETENTION_DAYS = 90;
export const VOICE_RANGE_MAX_DAYS = 31;
export const VOICE_BOT_DAYS_MAX = 14;
export const VOICE_HEARTBEAT_MS = 60_000;
export const VOICE_UNKNOWN_CHANNEL = '未知频道';

export type VoiceStartReason = 'joined' | 'moved' | 'bot_online';
export type VoiceEndReason = 'left' | 'moved' | 'bot_offline' | 'unlinked';

export function voiceNotice(): string {
  return `绑定后，你在本服务器语音频道的进出时间会被记录，保存 ${VOICE_RETENTION_DAYS} 天，供裁判处理迟到、缺席时参考。只有裁判、管理员和你自己能看到。`;
}
