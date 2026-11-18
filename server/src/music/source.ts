// Source-agnostic music interface. The queue and the web player only see
// prefixed track ids (`netease:123`); each source resolves its own.
import { CommunityStoreError } from '../community/store';
import type { NeteaseClient } from './netease/client';

export type ResolveResult = { url: string } | { unplayable: string };

/** What the music process needs of a source: audio for a queued track. */
export interface MusicSource {
  resolve(trackId: string, cookie?: string | null): Promise<ResolveResult>;
}

const NETEASE_PREFIX = 'netease:';

export function neteaseSource(client: NeteaseClient): MusicSource {
  return {
    resolve: async (trackId, cookie) => {
      if (typeof trackId !== 'string' || !trackId.startsWith(NETEASE_PREFIX)) {
        throw new CommunityStoreError(400, 'invalid_input', '曲目无效');
      }
      return client.songUrl(trackId, cookie);
    },
  };
}
