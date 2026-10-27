import type { VoiceDay, VoiceGap } from './voiceDays';

/** Public Nanako reference, never a Discord account or channel identifier. */
export interface VoiceUserRef { id: string; username: string; avatar_url: string | null }
export interface VoiceHistoryResponse {
  user: VoiceUserRef;
  days: VoiceDay[];
  gaps: VoiceGap[];
  retention_days: number;
}
export interface VoiceDayUser {
  user: VoiceUserRef;
  first_join: string | null;
  total_min: number;
  /** True only for an unclosed segment and a committed current observation. */
  in_voice_now: boolean;
  /** Without current coverage this means only “尚未记录离开”. */
  has_open_segment: boolean;
}
export interface VoiceDayResponse {
  date: string;
  users: VoiceDayUser[];
  gaps: VoiceGap[];
  retention_days: number;
}
