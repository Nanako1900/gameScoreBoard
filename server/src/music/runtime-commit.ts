// Persisting reducer output with optimistic versioning. The app process may bump
// a session's version too (lending or withdrawing an account), so a conflict is
// retried by re-running the pure reduction on the freshly read state.
import type { MusicState } from '../../../shared/music';
import { CommunityStoreError } from '../community/store';
import type { MusicEffect, MusicReduction } from './queue';
import type { StoredMusicSession } from './store';
import type { MusicRuntimeStore } from './types';

export const MUSIC_SAVE_ATTEMPTS = 3;
export const MUSIC_GENERIC_ERROR = '指令执行失败，请稍后重试';
export const MUSIC_SESSION_ENDED_ERROR = '会话已结束';

/** The session was ended underneath us (by the app, or by a racing end). */
export class MusicSessionGone extends Error {
  constructor() {
    super('music session already ended');
    this.name = 'MusicSessionGone';
  }
}

export interface Committed {
  session: StoredMusicSession;
  effect: MusicEffect;
}

function isConflict(error: unknown): boolean {
  return error instanceof CommunityStoreError && error.code === 'version_conflict';
}

export async function reloadSession(store: MusicRuntimeStore, ref: string): Promise<StoredMusicSession> {
  const fresh = await store.session(ref);
  if (!fresh || fresh.status === 'ended') throw new MusicSessionGone();
  return fresh;
}

export async function commit(
  store: MusicRuntimeStore,
  session: StoredMusicSession,
  reduce: (state: MusicState) => MusicReduction,
): Promise<Committed> {
  let current = session;
  for (let attempt = 1; ; attempt += 1) {
    const reduction = reduce(current.state);
    if (reduction.state === current.state) return { session: current, effect: reduction.effect };
    try {
      const saved = await store.saveState(current.ref, reduction.state, current.version);
      return { session: saved, effect: reduction.effect };
    } catch (error) {
      if (!isConflict(error)) throw error;
      current = await reloadSession(store, current.ref);
      if (attempt >= MUSIC_SAVE_ATTEMPTS) throw error;
    }
  }
}

/** Member-facing text for a failed command; anything unexpected goes to onError only. */
export function commandErrorText(error: unknown, onError: (error: unknown) => void): string {
  if (error instanceof CommunityStoreError) return error.message;
  if (error instanceof MusicSessionGone) return MUSIC_SESSION_ENDED_ERROR;
  onError(error);
  return MUSIC_GENERIC_ERROR;
}
