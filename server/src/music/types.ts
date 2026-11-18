// Collaborator contracts of the music runtime. Everything that touches Discord,
// ffmpeg, NetEase or the database is injected through these, so the runtime
// itself is a plain state machine that tests drive with in-memory fakes.
import type { Readable } from 'node:stream';
import type { ResolveResult } from './source';
import type { MusicStore } from './store';

export interface MusicVoice {
  /** Resolves once the voice connection is ready; rejects (and cleans up) otherwise. */
  join(channelId: string): Promise<void>;
  /** Replaces any current stream; returns this stream's play id (strictly increasing). */
  play(input: { stream: Readable; seekMs: number; volume: number }): number;
  pause(): void;
  resume(): void;
  stop(): void;
  leave(): void;
  /** Called once per played stream with its play id: error null on a natural end. */
  onEnd(cb: (playId: number, error: Error | null) => void): void;
  /** Called after the adapter's own reconnect attempts have failed. */
  onDisconnect(cb: () => void): void;
  /** Non-bot members in that voice channel; null when the snapshot is unavailable. */
  humans(channelId: string): number | null;
  /** Posts the player link into the voice channel's text chat. */
  announce(channelId: string, url: string): Promise<void>;
}

/** Repeating timer; the returned function cancels it. */
export interface MusicTimers {
  every(ms: number, fn: () => void): () => void;
}

export type MusicRuntimeStore = Pick<
  MusicStore,
  | 'activeSession' | 'session' | 'setStatus' | 'saveState' | 'setAccountOwner' | 'endSession'
  | 'claimCommands' | 'finishCommand' | 'heartbeat' | 'purgeExpired'
>;

export interface MusicRooms {
  /** Discord voice channel id of the room; null when the room is closed or unavailable. */
  channelFor(roomRef: string): Promise<string | null>;
}

export interface MusicRuntimeDeps {
  store: MusicRuntimeStore;
  rooms: MusicRooms;
  voice: MusicVoice;
  /** May throw; a throw counts as one failed track. */
  resolveTrack(trackId: string, cookie: string | null): Promise<ResolveResult>;
  openAudio(url: string): Promise<Readable>;
  /** Null when the lent account cannot be used (missing, undecryptable, no longer
   * valid, its owner gone, or no master key); the runtime then detaches it. */
  cookieFor(memberRef: string): Promise<string | null>;
  now(): number;
  random(): number;
  newKey(): string;
  playerUrl(roomRef: string): string;
  isReadOnly(): boolean;
  onError(error: unknown): void;
  /** Heartbeat interval; defaults to Node's setInterval. */
  timers?: MusicTimers;
}

export interface MusicRuntime {
  /** Starts the heartbeat (and hourly purge); ticks are driven by the caller. */
  start(): void;
  tick(): Promise<void>;
  /** Stops the heartbeat, waits for a running tick and ends the live session. */
  stop(): Promise<void>;
}
