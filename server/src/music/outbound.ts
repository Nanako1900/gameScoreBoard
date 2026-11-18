// NetEase client for the app process, built per request so a proxy change in
// the admin page takes effect without a restart. A stored proxy that cannot be
// read fails closed: the request must not silently leave through another exit.
import { CommunityStoreError } from '../community/store';
import { createNeteaseClient, type NeteaseClient, type NeteaseFailure } from './netease/client';
import { createMusicFetch, readMusicProxy } from './proxy';

export const PROXY_UNAVAILABLE_MESSAGE = '出口代理不可用，请联系管理员检查代理设置';

export type NeteaseFactory = () => Promise<NeteaseClient>;

export function createProxiedNetease(db: D1Database, masterKey: string | undefined,
  onFailure?: (failure: NeteaseFailure) => void): NeteaseFactory {
  return async () => {
    const proxy = await readMusicProxy(db, masterKey);
    if (proxy.error !== null) throw new CommunityStoreError(503, 'proxy_unavailable', PROXY_UNAVAILABLE_MESSAGE);
    return createNeteaseClient({ fetch: createMusicFetch(proxy.url), onFailure });
  };
}
