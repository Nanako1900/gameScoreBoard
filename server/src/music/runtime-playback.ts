// Turning reducer effects into voice playback: resolving and opening audio,
// skipping tracks that cannot be played and giving up after a run of failures.
import type { MusicState } from '../../../shared/music';
import { advance, type MusicEffect, type MusicReducerContext } from './queue';
import { commit, MusicSessionGone, type Committed } from './runtime-commit';
import type { StoredMusicSession } from './store';
import type { MusicRuntimeDeps } from './types';

export const MUSIC_MAX_CONSECUTIVE_FAILURES = 5;
/** A pipeline paused for longer than this is replaced on resume (its download may have timed out). */
export const MUSIC_RESUME_MAX_PAUSE_MS = 60_000;
export const MUSIC_AUDIO_UNAVAILABLE = '暂时无法获取音频';
export const MUSIC_PLAYBACK_INTERRUPTED = '播放中断';
export const MUSIC_FAILURE_PAUSE_NOTICE = `连续 ${MUSIC_MAX_CONSECUTIVE_FAILURES} 首无法播放，已暂停`;
export const MUSIC_ACCOUNT_DROPPED_NOTICE = '网易云登录已失效，已改为免登录播放，请账号主人重新扫码';

/** The stream the voice player is currently fed with. */
export interface PlayingTrack {
  key: string;
  playId: number;
  /** Volume the pipeline was spawned with: ffmpeg cannot change it later. */
  volume: number;
  /** When it was paused (runtime clock); null while it plays. */
  pausedAt: number | null;
}

/** What the playback helpers may read and change of the runtime's live session. */
export interface PlaybackScope {
  deps: MusicRuntimeDeps;
  failures(): number;
  playing(): PlayingTrack | null;
  update(patch: { failures?: number; playing?: PlayingTrack | null }): void;
}

export interface Playback {
  perform(session: StoredMusicSession, effect: MusicEffect): Promise<StoredMusicSession>;
  trackEnded(session: StoredMusicSession, error: Error | null): Promise<StoredMusicSession>;
  resetFailures(): void;
}

interface Attempt {
  session: StoredMusicSession;
  /** Null on success, the member-facing failure reason otherwise. */
  failure: string | null;
}

function pauseAfterFailures(state: MusicState): MusicState {
  if (!state.current) return { ...state, notice: MUSIC_FAILURE_PAUSE_NOTICE };
  return { ...state, paused: true, positionMs: 0, positionAt: null, notice: MUSIC_FAILURE_PAUSE_NOTICE };
}

function unchanged(state: MusicState): { state: MusicState; effect: 'none' } {
  return { state, effect: 'none' };
}

export function createPlayback(scope: PlaybackScope): Playback {
  const { deps } = scope;
  const ctx = (): MusicReducerContext => ({ now: deps.now(), random: deps.random, newKey: deps.newKey });

  const stopVoice = (): void => {
    deps.voice.stop();
    scope.update({ playing: null });
  };

  /** Detaches a lent account that cannot be used, so the session stops claiming it. */
  async function dropAccount(session: StoredMusicSession): Promise<StoredMusicSession> {
    const detached = await deps.store.setAccountOwner(session.ref, null);
    const noticed = await commit(deps.store, detached, (state) => (
      state.notice === MUSIC_ACCOUNT_DROPPED_NOTICE ? unchanged(state)
        : { state: { ...state, notice: MUSIC_ACCOUNT_DROPPED_NOTICE }, effect: 'none' }
    ));
    return noticed.session;
  }

  async function withAccount(session: StoredMusicSession): Promise<{ session: StoredMusicSession; cookie: string | null }> {
    if (!session.accountOwner) return { session, cookie: null };
    const cookie = await deps.cookieFor(session.accountOwner);
    if (cookie !== null) return { session, cookie };
    return { session: await dropAccount(session), cookie: null };
  }

  /** Moves the position anchor to "now": the stream started at `positionMs` just now. */
  async function anchor(session: StoredMusicSession, key: string): Promise<StoredMusicSession> {
    const at = new Date(deps.now()).toISOString();
    try {
      const anchored = await commit(deps.store, session, (state) => (
        state.current?.key !== key || state.paused || state.positionAt === at ? unchanged(state)
          : { state: { ...state, positionAt: at }, effect: 'none' }
      ));
      return anchored.session;
    } catch (error) {
      // The audio already plays: a failed anchor only skews the progress bar.
      if (error instanceof MusicSessionGone) throw error;
      deps.onError(error);
      return session;
    }
  }

  /** Plays the current item from exactly `positionMs`, whatever the resolve latency was. */
  async function attempt(session: StoredMusicSession): Promise<Attempt> {
    let current = session;
    try {
      const lent = await withAccount(current);
      current = lent.session;
      const item = current.state.current!;
      const resolved = await deps.resolveTrack(item.track.id, lent.cookie);
      if ('unplayable' in resolved) return { session: current, failure: resolved.unplayable };
      const stream = await deps.openAudio(resolved.url);
      const { positionMs, volume } = current.state;
      const playId = deps.voice.play({ stream, seekMs: positionMs, volume });
      scope.update({ playing: { key: item.key, playId, volume, pausedAt: null } });
      return { session: current, failure: null };
    } catch (error) {
      deps.onError(error);
      return { session: current, failure: MUSIC_AUDIO_UNAVAILABLE };
    }
  }

  async function fail(session: StoredMusicSession, reason: string): Promise<Committed> {
    const failures = scope.failures() + 1;
    scope.update({ failures, playing: null });
    const giveUp = failures >= MUSIC_MAX_CONSECUTIVE_FAILURES;
    return commit(deps.store, session, (state) => {
      const next = advance(state, ctx(), 'failed', reason);
      return giveUp ? { state: pauseAfterFailures(next.state), effect: 'stop' } : next;
    });
  }

  async function start(session: StoredMusicSession): Promise<StoredMusicSession> {
    let current = session;
    while (current.state.current && !current.state.paused) {
      const result = await attempt(current);
      if (result.failure === null) return anchor(result.session, result.session.state.current!.key);
      const failed = await fail(result.session, result.failure);
      current = failed.session;
      if (failed.effect !== 'start') break;
    }
    stopVoice();
    return current;
  }

  /** Unpausing the old pipeline is only right if it still plays what the state says. */
  function canResume(playing: PlayingTrack | null, state: MusicState): playing is PlayingTrack {
    return playing !== null
      && playing.key === state.current?.key
      && playing.volume === state.volume
      && playing.pausedAt !== null
      && deps.now() - playing.pausedAt <= MUSIC_RESUME_MAX_PAUSE_MS;
  }

  function resume(session: StoredMusicSession): Promise<StoredMusicSession> {
    const playing = scope.playing();
    if (!canResume(playing, session.state)) return start(session);
    deps.voice.resume();
    scope.update({ playing: { ...playing, pausedAt: null } });
    return Promise.resolve(session);
  }

  function pause(session: StoredMusicSession): StoredMusicSession {
    deps.voice.pause();
    const playing = scope.playing();
    if (playing && playing.pausedAt === null) scope.update({ playing: { ...playing, pausedAt: deps.now() } });
    return session;
  }

  async function perform(session: StoredMusicSession, effect: MusicEffect): Promise<StoredMusicSession> {
    switch (effect) {
      case 'start':
      case 'restart':
        return start(session);
      case 'resume':
        return resume(session);
      case 'pause':
        return pause(session);
      case 'stop':
        stopVoice();
        return session;
      default:
        return session;
    }
  }

  async function trackEnded(session: StoredMusicSession, error: Error | null): Promise<StoredMusicSession> {
    scope.update({ playing: null });
    if (error) {
      deps.onError(error);
      const failed = await fail(session, MUSIC_PLAYBACK_INTERRUPTED);
      return failed.effect === 'start' ? start(failed.session) : perform(failed.session, failed.effect);
    }
    scope.update({ failures: 0 });
    const next = await commit(deps.store, session, (state) => advance(state, ctx(), 'ended'));
    return perform(next.session, next.effect);
  }

  return { perform, trackEnded, resetFailures: () => scope.update({ failures: 0 }) };
}
