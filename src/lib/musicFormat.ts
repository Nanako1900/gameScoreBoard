import type { MusicEndReason, MusicMode, MusicTrack } from '@shared/music';

const SECOND_MS = 1000;
const SECONDS_PER_MINUTE = 60;

export const MUSIC_MODE_ORDER: readonly MusicMode[] = ['order', 'loop', 'single', 'shuffle'];

export const MUSIC_MODE_LABELS: Readonly<Record<MusicMode, string>> = {
  order: '顺序',
  loop: '列表循环',
  single: '单曲循环',
  shuffle: '随机',
};

/** m:ss, rounded down, never negative. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / SECOND_MS));
  const seconds = total % SECONDS_PER_MINUTE;
  return `${Math.floor(total / SECONDS_PER_MINUTE)}:${String(seconds).padStart(2, '0')}`;
}

export function formatArtists(track: MusicTrack): string {
  return track.artists.length > 0 ? track.artists.join(' / ') : '未知歌手';
}

export function formatExpiry(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '未知' : date.toLocaleDateString('zh-CN');
}

/** The mode that follows `mode` when the member presses the mode button. */
export function nextMusicMode(mode: MusicMode): MusicMode {
  const index = MUSIC_MODE_ORDER.indexOf(mode);
  return MUSIC_MODE_ORDER[(index + 1) % MUSIC_MODE_ORDER.length] ?? 'order';
}

export const MUSIC_END_REASON_TEXT: Readonly<Record<MusicEndReason, string>> = {
  left: 'Music 已离开房间',
  empty: '房间里没有人了，Music 已自动离开',
  idle: '长时间没有播放，Music 已自动离开',
  room_closed: '房间已关闭，Music 已离开',
  disconnected: 'Music 与语音的连接中断了，可以重新邀请',
  connect_failed: 'Music 没能进入房间，可能缺少进入该房间的权限，请联系管理员',
  bot_restarted: 'Music 机器人刚刚重启，可以重新邀请',
  shutdown: 'Music 机器人刚刚重启，可以重新邀请',
  offline: 'Music 机器人离线，播放已结束',
};

/** Server clock minus browser clock at the moment a view arrived; 0 when the backend does not send one. */
export function serverClockOffset(serverNow: string | undefined, browserNowMs: number): number {
  const server = serverNow ? Date.parse(serverNow) : NaN;
  return Number.isFinite(server) ? server - browserNowMs : 0;
}
