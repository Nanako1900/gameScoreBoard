// Track search, playlist import and the admin proxy settings. Every NetEase
// call goes through the per-request client so the configured proxy applies.
import type { MusicProxyView, MusicTrack } from '../../../shared/music';
import { CommunityStoreError } from '../community/store';
import { fail, invalidInput } from './http';
import type { NeteaseClient } from './netease/client';
import { readMusicProxy, saveMusicProxy, saveMusicProxyAudio } from './proxy';
import { createRateLimiter, type RateLimiter } from './rate-limit';
import type { MusicService } from './service';

const SEARCH_WINDOW_MS = 1_000;
const MAX_QUERY = 100;
const MAX_PLAYLIST_LINK = 500;
const PROXY_TEST_QUERY = '周杰伦';
const NETEASE_UNAVAILABLE = '网易云暂不可用，请稍后再试';
const PROXY_TEST_OK = '已通过代理成功访问网易云';
const PROXY_TEST_FAILED = '无法通过代理访问网易云，请检查代理地址与网络';
const PROXY_TEST_UNSET = '尚未配置出口代理';

function text(value: string | undefined, max: number, message: string): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed || trimmed.length > max || trimmed.includes('\u0000')) return invalidInput(message);
  return trimmed;
}

export class MusicCatalog {
  private readonly searchLimiter: RateLimiter;

  constructor(private readonly service: MusicService, now: () => number = Date.now) {
    this.searchLimiter = createRateLimiter(SEARCH_WINDOW_MS, now);
  }

  /** Member-facing errors pass through; anything unexpected becomes a fixed message. */
  private async withNetease<T>(work: (client: NeteaseClient) => Promise<T>): Promise<T> {
    const client = await this.service.deps.netease();
    try {
      return await work(client);
    } catch (error) {
      if (error instanceof CommunityStoreError) throw error;
      this.service.deps.onError?.('music netease request failed', error instanceof Error ? error.name : 'unknown');
      return fail(503, 'netease_unavailable', NETEASE_UNAVAILABLE);
    }
  }

  async search(userId: string, query: string | undefined): Promise<{ tracks: MusicTrack[] }> {
    await this.service.member(userId);
    const keyword = text(query, MAX_QUERY, '请输入搜索内容');
    this.searchLimiter.take(userId);
    return { tracks: await this.withNetease((client) => client.search(keyword)) };
  }

  async playlist(userId: string, link: string | undefined): Promise<{ name: string; tracks: MusicTrack[] }> {
    await this.service.member(userId);
    const input = text(link, MAX_PLAYLIST_LINK, '请输入歌单链接');
    this.searchLimiter.take(userId);
    const result = await this.withNetease((client) => client.playlist(input));
    return { name: result.name, tracks: result.tracks };
  }

  async proxy(userId: string): Promise<MusicProxyView> {
    await this.service.admin(userId);
    const { db, masterKey } = this.service.deps;
    return (await readMusicProxy(db, masterKey)).view;
  }

  async saveProxy(userId: string, url: unknown, audio: unknown): Promise<MusicProxyView> {
    await this.service.admin(userId);
    const keepAddress = url === undefined;
    if ((!keepAddress && url !== null && typeof url !== 'string') || typeof audio !== 'boolean') invalidInput('代理设置无效');
    const { db, masterKey } = this.service.deps;
    // An omitted address keeps the saved one: it is never sent back to the
    // browser, so the admin could not resubmit it just to flip the switch.
    if (keepAddress) return saveMusicProxyAudio(db, masterKey, audio, userId);
    return saveMusicProxy(db, masterKey, url as string | null, audio, userId);
  }

  async testProxy(userId: string): Promise<{ ok: boolean; message: string }> {
    await this.service.admin(userId);
    const { db, masterKey, netease, onError } = this.service.deps;
    if (!(await readMusicProxy(db, masterKey)).view.configured) return { ok: false, message: PROXY_TEST_UNSET };
    try {
      await (await netease()).search(PROXY_TEST_QUERY);
      return { ok: true, message: PROXY_TEST_OK };
    } catch (error) {
      onError?.('music proxy test failed', error instanceof CommunityStoreError ? error.code : 'request_failed');
      return { ok: false, message: PROXY_TEST_FAILED };
    }
  }
}
