// Production collaborators of the music runtime: room lookup, NetEase access
// through the configured proxy, audio download and account cookies. Each call
// re-reads the proxy settings, so an admin change applies without a restart.
import type { Readable } from 'node:stream';
import { AiSecretError } from '../../../worker/ai/secrets';
import type { CommunityStore } from '../community/store';
import { openAudioStream } from './audio';
import { createNeteaseClient, type NeteaseClient, type NeteaseFailure } from './netease/client';
import { createMusicFetch, readMusicProxy } from './proxy';
import { openMusicSecret } from './secrets';
import { neteaseSource, type ResolveResult } from './source';
import type { MusicStore } from './store';
import type { MusicRooms } from './types';

/** How long a cookie NetEase accepted is trusted before asking again. */
export const MUSIC_ACCOUNT_CHECK_MS = 10 * 60_000;
const CLOSED_ROOM_STATUSES = new Set(['closing', 'closed']);

export class MusicProxyUnavailableError extends Error {
  constructor(code: string) {
    super(`the music proxy is configured but cannot be used (${code}); not falling back to a direct connection`);
    this.name = 'MusicProxyUnavailableError';
  }
}

export interface MusicMainDeps {
  db: D1Database;
  masterKey: string | undefined;
  store: Pick<MusicStore, 'account' | 'deleteAccount'>;
  community: Pick<CommunityStore, 'resource'>;
  now(): number;
  /** Why a NetEase request failed (path and reason only), for the process log. */
  onNeteaseFailure?: (failure: NeteaseFailure) => void;
}

export function communityRooms(community: Pick<CommunityStore, 'getRoom' | 'resource'>): MusicRooms {
  return {
    async channelFor(roomRef) {
      const room = await community.getRoom(roomRef);
      if (!room || CLOSED_ROOM_STATUSES.has(room.status) || !room.channelRef) return null;
      const voice = await community.resource(room.channelRef, 'voice');
      return voice && voice.available ? voice.externalId : null;
    },
  };
}

async function proxiedFetch(deps: MusicMainDeps, forAudio: boolean): Promise<typeof fetch> {
  const proxy = await readMusicProxy(deps.db, deps.masterKey);
  // Audio goes direct unless the admin asked otherwise: that is configuration, not a fallback.
  if (forAudio && !proxy.audio) return globalThis.fetch;
  if (proxy.error) throw new MusicProxyUnavailableError(proxy.error);
  return createMusicFetch(proxy.url);
}

async function netease(deps: MusicMainDeps): Promise<NeteaseClient> {
  return createNeteaseClient({ fetch: await proxiedFetch(deps, false), onFailure: deps.onNeteaseFailure });
}

export function createMusicIo(deps: MusicMainDeps): {
  resolveTrack(trackId: string, cookie: string | null): Promise<ResolveResult>;
  openAudio(url: string): Promise<Readable>;
  cookieFor(memberRef: string): Promise<string | null>;
} {
  let checkedAt: ReadonlyMap<string, number> = new Map();

  async function stillValid(memberRef: string, cookie: string): Promise<boolean> {
    const last = checkedAt.get(memberRef);
    if (last !== undefined && deps.now() - last < MUSIC_ACCOUNT_CHECK_MS) return true;
    try {
      const account = await (await netease(deps)).account(cookie);
      if (!account) return false;
    } catch {
      // NetEase or the proxy being down says nothing about the login: keep it.
      return true;
    }
    checkedAt = new Map([...checkedAt, [memberRef, deps.now()]]);
    return true;
  }

  async function forget(memberRef: string): Promise<null> {
    checkedAt = new Map([...checkedAt].filter(([ref]) => ref !== memberRef));
    await deps.store.deleteAccount(memberRef);
    return null;
  }

  /** Only a current member may lend an account: anyone who left takes it with them. */
  async function ownerAvailable(memberRef: string): Promise<boolean> {
    const member = await deps.community.resource(memberRef, 'member');
    return member?.available === true;
  }

  async function cookieFor(memberRef: string): Promise<string | null> {
    const account = await deps.store.account(memberRef);
    if (!account) return null;
    if (!(await ownerAvailable(memberRef))) return forget(memberRef);
    // Without the master key nothing can be decrypted; the stored logins are not at fault.
    if (!deps.masterKey) return null;
    let cookie: string;
    try {
      cookie = await openMusicSecret(account.cookieEncrypted, deps.masterKey, 'cookie');
    } catch (error) {
      // A bad master key is a deployment problem, not a broken login.
      if (error instanceof AiSecretError && error.code === 'master_key_invalid') throw error;
      return forget(memberRef);
    }
    return (await stillValid(memberRef, cookie)) ? cookie : forget(memberRef);
  }

  return {
    resolveTrack: async (trackId, cookie) => neteaseSource(await netease(deps)).resolve(trackId, cookie),
    openAudio: async (url) => openAudioStream(await proxiedFetch(deps, true), url),
    cookieFor,
  };
}
