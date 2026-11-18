// The music process's command loop. Each tick reads the one live session from
// PostgreSQL, moves it through requested → connecting → active, applies queued
// commands in order and ends it when the room empties, idles or goes away.
// Ticks never overlap; a tick requested meanwhile runs right after. The
// heartbeat runs on its own interval so a slow tick never looks like an outage.
import type { MusicEndReason } from '../../../shared/music';
import { applyMusicCommand, type MusicReducerContext } from './queue';
import { commandErrorText, commit, MusicSessionGone, MUSIC_SESSION_ENDED_ERROR, reloadSession } from './runtime-commit';
import { createPlayback, type PlayingTrack } from './runtime-playback';
import type { StoredMusicCommand, StoredMusicSession } from './store';
import type { MusicRuntime, MusicRuntimeDeps, MusicTimers } from './types';

export { MUSIC_MAX_CONSECUTIVE_FAILURES } from './runtime-playback';

export const MUSIC_CONNECT_TIMEOUT_MS = 30_000;
export const MUSIC_EMPTY_TIMEOUT_MS = 60_000;
export const MUSIC_IDLE_TIMEOUT_MS = 10 * 60_000;
export const MUSIC_HEARTBEAT_INTERVAL_MS = 5_000;
export const MUSIC_PURGE_INTERVAL_MS = 60 * 60_000;
export const MUSIC_COMMAND_BATCH = 20;
export const MUSIC_MAINTENANCE_ERROR = '系统维护中，暂时无法操作音乐';

interface LiveSession {
  ref: string;
  channelId: string;
  playing: PlayingTrack | null;
  failures: number;
  emptySince: number | null;
  idleSince: number | null;
}

interface EndEvent {
  playId: number;
  error: Error | null;
}

const nodeTimers: MusicTimers = {
  every(ms, fn) {
    const timer = setInterval(fn, ms);
    return () => clearInterval(timer);
  },
};

export function createMusicRuntime(deps: MusicRuntimeDeps): MusicRuntime {
  const { store, voice } = deps;
  let live: LiveSession | null = null;
  let events: readonly EndEvent[] = [];
  let disconnected = false;
  let cleaned = false;
  let stopped = false;
  let stopHousekeeping: (() => void) | null = null;
  let housekeeping: Promise<void> | null = null;
  let lastPurge = Number.NEGATIVE_INFINITY;
  let lastJoinError: unknown = null;
  let running: Promise<void> | null = null;
  let rerun = false;

  const playback = createPlayback({
    deps,
    failures: () => live?.failures ?? 0,
    playing: () => live?.playing ?? null,
    update: (patch) => { if (live) live = { ...live, ...patch }; },
  });
  const ctx = (): MusicReducerContext => ({ now: deps.now(), random: deps.random, newKey: deps.newKey });

  voice.onEnd((playId, error) => {
    events = [...events, { playId, error }];
    void tick();
  });
  voice.onDisconnect(() => {
    disconnected = true;
    void tick();
  });

  const guarded = async (work: () => Promise<void>): Promise<void> => {
    try {
      await work();
    } catch (error) {
      deps.onError(error);
    }
  };

  function forget(): void {
    live = null;
    events = [];
    disconnected = false;
  }

  function dropVoice(): void {
    if (!live) return;
    forget();
    leaveVoice();
  }

  function leaveVoice(): void {
    try {
      voice.leave();
    } catch (error) {
      deps.onError(error);
    }
  }

  async function end(ref: string, reason: MusicEndReason): Promise<void> {
    forget();
    leaveVoice();
    await store.endSession(ref, reason);
  }

  async function beat(): Promise<void> {
    await guarded(() => store.heartbeat());
    const now = deps.now();
    if (now - lastPurge >= MUSIC_PURGE_INTERVAL_MS) {
      lastPurge = now;
      // Not awaited: a slow purge must not hold back the next heartbeat.
      void guarded(() => store.purgeExpired(new Date(now)));
    }
  }

  /** Skips a beat while the previous one is still waiting on the database. */
  function keepAlive(): void {
    if (housekeeping) return;
    housekeeping = beat().finally(() => { housekeeping = null; });
  }

  function start(): void {
    if (stopped || stopHousekeeping) return;
    stopHousekeeping = (deps.timers ?? nodeTimers).every(MUSIC_HEARTBEAT_INTERVAL_MS, keepAlive);
    keepAlive();
  }

  /** A fresh request may have been made just before this process started: claim it instead. */
  function isLeftover(session: StoredMusicSession): boolean {
    if (session.status !== 'requested') return true;
    return deps.now() - Date.parse(session.createdAt) >= MUSIC_CONNECT_TIMEOUT_MS;
  }

  async function endLeftover(): Promise<void> {
    const leftover = await store.activeSession();
    if (leftover && isLeftover(leftover)) await store.endSession(leftover.ref, 'bot_restarted');
    cleaned = true;
  }

  async function activate(session: StoredMusicSession, channelId: string): Promise<void> {
    const activated = await store.setStatus(session.ref, 'active');
    if (!activated) {
      leaveVoice();
      return;
    }
    live = { ref: session.ref, channelId, playing: null, failures: 0, emptySince: null, idleSince: deps.now() };
    lastJoinError = null;
    events = [];
    disconnected = false;
    // Not awaited: a slow Discord API must not hold up the tick.
    void Promise.resolve()
      .then(() => voice.announce(channelId, deps.playerUrl(session.roomRef)))
      .catch(deps.onError);
  }

  async function connect(session: StoredMusicSession): Promise<void> {
    if (session.status === 'requested' && deps.isReadOnly()) return;
    const channelId = await deps.rooms.channelFor(session.roomRef);
    if (!channelId) return end(session.ref, 'room_closed');
    if (deps.now() - Date.parse(session.createdAt) >= MUSIC_CONNECT_TIMEOUT_MS) {
      if (lastJoinError !== null) deps.onError(lastJoinError);
      lastJoinError = null;
      return end(session.ref, 'connect_failed');
    }
    const claimed = session.status === 'requested' ? await store.setStatus(session.ref, 'connecting') : session;
    if (!claimed) return;
    try {
      await voice.join(channelId);
    } catch (error) {
      // Retried on the next tick: the main bot may still be granting channel access.
      lastJoinError = error;
      return;
    }
    await activate(session, channelId);
  }

  async function runCommand(session: StoredMusicSession, command: StoredMusicCommand): Promise<StoredMusicSession | null> {
    try {
      const { session: saved, effect } = await commit(store, session, (state) => applyMusicCommand(state, command, ctx()));
      if (effect === 'leave') {
        await store.finishCommand(command.id, null);
        await end(saved.ref, 'left');
        return null;
      }
      if (effect !== 'none') playback.resetFailures();
      const performed = await playback.perform(saved, effect);
      await store.finishCommand(command.id, null);
      return performed;
    } catch (error) {
      if (error instanceof MusicSessionGone) {
        await store.finishCommand(command.id, MUSIC_SESSION_ENDED_ERROR);
        throw error;
      }
      await store.finishCommand(command.id, commandErrorText(error, deps.onError));
      return reloadSession(store, session.ref);
    }
  }

  /** Returns the session after its commands, or null once it has ended. */
  async function runCommands(session: StoredMusicSession): Promise<StoredMusicSession | null> {
    const commands = await store.claimCommands(session.ref, MUSIC_COMMAND_BATCH);
    let current: StoredMusicSession | null = session;
    for (const command of commands) {
      if (deps.isReadOnly()) {
        await store.finishCommand(command.id, MUSIC_MAINTENANCE_ERROR);
        continue;
      }
      current = await runCommand(current, command);
      if (!current) return null;
    }
    return current;
  }

  async function runEvents(session: StoredMusicSession): Promise<StoredMusicSession> {
    const pending = events;
    events = [];
    let current = session;
    for (const event of pending) {
      // Events of a replaced stream (seek, volume, resume restart) are stale.
      const playing = live?.playing;
      if (!playing || playing.playId !== event.playId || playing.key !== current.state.current?.key) continue;
      current = await playback.trackEnded(current, event.error);
    }
    return current;
  }

  async function checkTimers(session: StoredMusicSession, channelId: string): Promise<void> {
    if (!live) return;
    const now = deps.now();
    const humans = voice.humans(channelId);
    const idle = session.state.current === null && session.state.queue.length === 0;
    const emptySince = humans === 0 ? (live.emptySince ?? now) : null;
    const idleSince = idle ? (live.idleSince ?? now) : null;
    live = { ...live, emptySince, idleSince };
    if (emptySince !== null && now - emptySince >= MUSIC_EMPTY_TIMEOUT_MS) return end(session.ref, 'empty');
    if (idleSince !== null && now - idleSince >= MUSIC_IDLE_TIMEOUT_MS) return end(session.ref, 'idle');
  }

  async function runActive(session: StoredMusicSession): Promise<void> {
    const channelId = await deps.rooms.channelFor(session.roomRef);
    if (!channelId) return end(session.ref, 'room_closed');
    if (disconnected) return end(session.ref, 'disconnected');
    try {
      const afterEvents = await runEvents(session);
      const afterCommands = await runCommands(afterEvents);
      if (afterCommands) await checkTimers(afterCommands, channelId);
    } catch (error) {
      if (!(error instanceof MusicSessionGone)) throw error;
      dropVoice();
    }
  }

  async function step(): Promise<void> {
    if (!cleaned) await endLeftover();
    const session = await store.activeSession();
    if (!session) return dropVoice();
    if (live && live.ref !== session.ref) dropVoice();
    if (session.status === 'requested' || session.status === 'connecting') return connect(session);
    // Active without our voice connection: nothing can play it any more.
    if (!live) return end(session.ref, 'disconnected');
    return runActive(session);
  }

  async function drain(): Promise<void> {
    do {
      rerun = false;
      await guarded(step);
    } while (rerun && !stopped);
  }

  function tick(): Promise<void> {
    if (stopped) return running ?? Promise.resolve();
    if (running) {
      rerun = true;
      return running;
    }
    running = drain().finally(() => { running = null; });
    return running;
  }

  async function stop(): Promise<void> {
    stopped = true;
    stopHousekeeping?.();
    stopHousekeeping = null;
    if (running) await running;
    await guarded(async () => {
      if (live) return end(live.ref, 'shutdown');
      const session = await store.activeSession();
      if (session?.status === 'connecting') await end(session.ref, 'shutdown');
    });
  }

  return { start, tick, stop };
}
