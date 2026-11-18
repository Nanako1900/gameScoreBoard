// Music bot contracts shared by the API, the music process and the web player.
// Like shared/community.ts, browser DTOs carry only opaque references: no
// Discord identifier, account cookie or proxy credential appears in any view.

export type MusicMode = 'order' | 'loop' | 'single' | 'shuffle';
export const MUSIC_MODES: readonly MusicMode[] = ['order', 'loop', 'single', 'shuffle'];

export interface MusicTrack {
  /** Source-prefixed, e.g. `netease:123456`. */
  id: string;
  title: string;
  artists: string[];
  album: string;
  durationMs: number;
  coverUrl: string | null;
}

export interface MusicQueueItem {
  /** Unique per queue entry, so the same track may be queued twice. */
  key: string;
  track: MusicTrack;
  /** Member reference of whoever queued it. */
  addedBy: string;
  /** Member-facing reason when the source refused to provide audio. */
  unplayable?: string;
}

export interface MusicState {
  current: MusicQueueItem | null;
  queue: MusicQueueItem[];
  /** Keys already played in the current shuffle round. */
  history: string[];
  mode: MusicMode;
  /** 0–100. */
  volume: number;
  paused: boolean;
  positionMs: number;
  /** ISO time `positionMs` was measured at; null while paused or stopped. */
  positionAt: string | null;
  notice: string | null;
}

export type MusicSessionStatus = 'requested' | 'connecting' | 'active' | 'ended';

export type MusicCommandKind =
  | 'enqueue' | 'remove' | 'move_next' | 'clear'
  | 'play' | 'pause' | 'skip' | 'seek' | 'volume' | 'mode' | 'leave';
export const MUSIC_COMMAND_KINDS: readonly MusicCommandKind[] = [
  'enqueue', 'remove', 'move_next', 'clear', 'play', 'pause', 'skip', 'seek', 'volume', 'mode', 'leave',
];

export interface MusicAccountView { nickname: string; vip: boolean; expiresAt: string }

export interface MusicSessionView {
  ref: string;
  status: MusicSessionStatus;
  version: number;
  state: MusicState;
  /** The account lent to this session; `mine` is true for its owner and
   * `canStop` for whoever may detach it (its owner or an admin). */
  account: { nickname: string; vip: boolean; mine: boolean; canStop: boolean } | null;
}

/** Why a session ended. `offline` is set by the API when the music process
 * stopped reporting; every other reason is set by the music process. */
export type MusicEndReason =
  | 'left' | 'empty' | 'idle' | 'room_closed' | 'disconnected'
  | 'connect_failed' | 'bot_restarted' | 'shutdown' | 'offline';
export const MUSIC_END_REASONS: readonly MusicEndReason[] = [
  'left', 'empty', 'idle', 'room_closed', 'disconnected', 'connect_failed', 'bot_restarted', 'shutdown', 'offline',
];

export interface MusicView {
  room: { ref: string; name: string };
  bot: { online: boolean; busyElsewhere: boolean };
  session: MusicSessionView | null;
  myAccount: MusicAccountView | null;
  loginAvailable: boolean;
  canInvite: boolean;
  /** Member-facing reason the invite button is disabled, when it is. */
  inviteBlocked: string | null;
  /** Server clock (ISO), so a browser with a wrong clock can still place the progress bar. */
  serverNow: string;
  /** This room's most recent session, when it ended within the last few
   * minutes and no session is live. Lets the page say why Music left. */
  lastEnded: { reason: MusicEndReason; endedAt: string } | null;
  /** The caller's most recent command in the live session that failed after
   * it was accepted (within the last 30 seconds). `id` changes per failure. */
  myLastError: { id: string; message: string } | null;
}

export interface MusicProxyView {
  configured: boolean;
  /** Host and port only: never the credentials. */
  host: string | null;
  audio: boolean;
  /** False when the master key needed to store the address is missing. */
  available: boolean;
}

export type MusicQrStatus = 'waiting' | 'scanned' | 'expired' | 'done';

export const MUSIC_QUEUE_LIMIT = 200;
export const MUSIC_ACCOUNT_DAYS = 30;
export const MUSIC_VOLUME_MAX = 100;

export function defaultMusicState(): MusicState {
  return {
    current: null, queue: [], history: [], mode: 'order', volume: MUSIC_VOLUME_MAX, paused: false,
    positionMs: 0, positionAt: null, notice: null,
  };
}

/** How many more tracks fit: the current track counts towards the limit. */
export function musicQueueCapacity(state: Pick<MusicState, 'current' | 'queue'>): number {
  return Math.max(0, MUSIC_QUEUE_LIMIT - state.queue.length - (state.current ? 1 : 0));
}

export function isMusicTrackId(value: unknown): value is string {
  return typeof value === 'string' && /^netease:\d{1,20}$/.test(value);
}

/** Playback position at `nowMs`, derived without a server round trip. */
export function musicPosition(state: MusicState, nowMs: number): number {
  // `nowMs` must be on the server's clock: callers in a browser add the
  // offset derived from MusicView.serverNow.
  if (!state.current) return 0;
  const duration = state.current.track.durationMs;
  const anchor = state.paused || state.positionAt === null ? NaN : Date.parse(state.positionAt);
  const elapsed = Number.isFinite(anchor) ? Math.max(0, nowMs - anchor) : 0;
  return Math.min(duration, Math.max(0, state.positionMs + elapsed));
}
