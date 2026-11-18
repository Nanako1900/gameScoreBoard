// Minimal NetEase Cloud Music web ("weapi") client. Every response is treated
// as untrusted: fields are validated one by one and any surprise becomes the
// generic `netease_unavailable` error, never a leaked body, cookie or URL.
import { isMusicTrackId, MUSIC_QUEUE_LIMIT, type MusicTrack } from '../../../../shared/music';
import { CommunityStoreError } from '../../community/store';
import { neteaseCoverUrl } from '../cover';
import { weapi } from './crypto';

export interface NeteaseClientDeps {
  fetch: typeof fetch;
  timeoutMs?: number;
  /** Told why a request failed: the path plus an HTTP status, NetEase code or
   * transport reason. Never the body, a cookie or a URL. */
  onFailure?: (failure: NeteaseFailure) => void;
}

export interface NeteaseFailure { path: string; reason: string }

export type QrCheckResult =
  | { status: 'waiting' | 'scanned' | 'expired' }
  | { status: 'done'; cookie: string };

export type SongUrlResult = { url: string } | { unplayable: string };

export interface NeteaseClient {
  search(keyword: string, limit?: number): Promise<MusicTrack[]>;
  playlist(idOrUrl: string): Promise<{ name: string; tracks: MusicTrack[] }>;
  songUrl(trackId: string, cookie?: string | null): Promise<SongUrlResult>;
  qrKey(): Promise<{ key: string; url: string }>;
  qrCheck(key: string): Promise<QrCheckResult>;
  account(cookie: string): Promise<{ nickname: string; vip: boolean } | null>;
}

type JsonObject = Readonly<Record<string, unknown>>;

const API_BASE = 'https://music.163.com/weapi';
const REFERER = 'https://music.163.com/';
const QR_LOGIN_URL = 'https://music.163.com/login?codekey=';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const FIXED_COOKIE = 'os=pc';
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_BODY_CHARS = 5_000_000;

const CODE_OK = 200;
const CODE_NOT_FOUND = 404;
const CODE_NO_ACCESS = 401;
const CODE_NEED_LOGIN = 301;
const CODE_REGION_BLOCKED = -110;
/** NetEase refused this network or client as risky. Retrying from the same exit does not help. */
const CODE_RISK_CONTROL = -462;
const FEE_VIP = 1;
const FEE_PURCHASE = 4;
const QR_TYPE_WEB = 1;
const SEARCH_TYPE_SONG = 1;
const QR_STATUS: Readonly<Record<number, 'expired' | 'waiting' | 'scanned'>> = { 800: 'expired', 801: 'waiting', 802: 'scanned' };
const QR_CODE_DONE = 803;

const SEARCH_LIMIT_DEFAULT = 20;
const SEARCH_LIMIT_MAX = 50;
const KEYWORD_MAX = 100;
const LINK_MAX = 500;
const TITLE_MAX = 200;
const ALBUM_MAX = 200;
const ARTIST_MAX = 100;
const ARTISTS_MAX = 10;
const NICKNAME_MAX = 100;
const URL_MAX = 2000;
const DURATION_MAX_MS = 24 * 60 * 60 * 1000;

const DIGITS = /^\d{1,20}$/;
const QR_KEY_PATTERN = /^[A-Za-z0-9-]{1,100}$/;
const COOKIE_VALUE = '[A-Za-z0-9%._~+/=-]{1,4096}';
const MUSIC_U_COOKIE = new RegExp(`^MUSIC_U=${COOKIE_VALUE}$`);
const MUSIC_U_SET_COOKIE = new RegExp(`^MUSIC_U=(${COOKIE_VALUE})(?:;|$)`);
const PLAYLIST_PATH = /\/playlist\/(\d{1,20})(?:[/?#]|$)/;
const PLAYLIST_QUERY = /\/playlist\?(?:[^#]*&)?id=(\d{1,20})(?:[&#]|$)/;
const AUDIO_HOST_SUFFIX = '.126.net';

const UNPLAYABLE = {
  trial: '仅可试听',
  removed: '歌曲已下架',
  vip: '需要会员',
  purchase: '需要购买专辑',
  region: '当前地区不可播放',
  other: '暂时无法播放',
} as const;

// 503 rather than 502: gateways in front of the app replace a 502 with their
// own page, which drops the CORS headers and hides the message from the page.
function unavailable(): CommunityStoreError {
  return new CommunityStoreError(503, 'netease_unavailable', '网易云暂不可用，请稍后重试');
}

function blocked(): CommunityStoreError {
  return new CommunityStoreError(503, 'netease_blocked', '网易云拒绝了服务器的网络环境（风控），请联系管理员检查出口代理');
}

function invalid(message: string): CommunityStoreError {
  return new CommunityStoreError(400, 'invalid_input', message);
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clampText(value: unknown, max: number): string {
  return typeof value === 'string' ? [...value.trim()].slice(0, max).join('') : '';
}

function readDigits(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  return typeof value === 'string' && DIGITS.test(value) ? value : null;
}

function parseUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || value.length > URL_MAX) return null;
  try {
    const url = new URL(value);
    const webProtocol = url.protocol === 'https:' || url.protocol === 'http:';
    return webProtocol && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

/** NetEase serves covers over http too; only its image hosts pass, upgraded to https. */
function readCoverUrl(value: unknown): string | null {
  return neteaseCoverUrl(value, { upgradeHttp: true });
}

function readArtists(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((artist) => (isRecord(artist) ? clampText(artist.name, ARTIST_MAX) : ''))
    .filter((name) => name.length > 0)
    .slice(0, ARTISTS_MAX);
}

/** Null for a missing or non-positive duration: the queue cannot hold such a track. */
function readDuration(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded > 0 ? Math.min(DURATION_MAX_MS, rounded) : null;
}

function parseTrack(raw: unknown): MusicTrack | null {
  if (!isRecord(raw)) return null;
  const digits = readDigits(raw.id);
  const title = clampText(raw.name, TITLE_MAX);
  const durationMs = readDuration(raw.dt);
  if (!digits || !title || durationMs === null) return null;
  const album = isRecord(raw.al) ? raw.al : {};
  return {
    id: `netease:${digits}`,
    title,
    artists: readArtists(raw.ar),
    album: clampText(album.name, ALBUM_MAX),
    durationMs,
    coverUrl: readCoverUrl(album.picUrl),
  };
}

function parseTracks(value: unknown): MusicTrack[] {
  if (!Array.isArray(value)) throw unavailable();
  return value.map(parseTrack).filter((track): track is MusicTrack => track !== null);
}

function parseJsonObject(text: string): JsonObject | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    // The body must never be echoed: the caller reports only that it was unreadable.
    return null;
  }
}

function cookieHeader(cookie: string | null | undefined): string {
  if (cookie === undefined || cookie === null) return FIXED_COOKIE;
  if (typeof cookie !== 'string' || !MUSIC_U_COOKIE.test(cookie)) throw invalid('网易云登录状态无效');
  return `${FIXED_COOKIE}; ${cookie}`;
}

interface WeapiResponse {
  body: JsonObject;
  headers: Headers;
  /** The body when NetEase answered 200; otherwise reports the code and throws. */
  ok(): JsonObject;
  /** Reports a code this endpoint does not expect and returns the error to throw. */
  refused(): CommunityStoreError;
}

class Reported extends Error {}

function createPoster(deps: NeteaseClientDeps) {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return async (path: string, payload: object, cookie?: string | null): Promise<WeapiResponse> => {
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: REFERER,
      'User-Agent': USER_AGENT,
      Cookie: cookieHeader(cookie),
    };
    const body = new URLSearchParams({ ...weapi({ ...payload, csrf_token: '' }) }).toString();
    const report = (reason: string): void => { deps.onFailure?.({ path, reason }); };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await deps.fetch(`${API_BASE}${path}`, {
        method: 'POST', headers, body, signal: controller.signal, redirect: 'error',
      });
      if (response.status !== CODE_OK) { report(`http_${response.status}`); throw new Reported(); }
      const text = await response.text();
      const parsed = text.length > MAX_BODY_CHARS ? null : parseJsonObject(text);
      if (!parsed) { report('bad_body'); throw new Reported(); }
      const refused = (): CommunityStoreError => {
        report(typeof parsed.code === 'number' && Number.isSafeInteger(parsed.code) ? `code_${parsed.code}` : 'bad_body');
        return parsed.code === CODE_RISK_CONTROL ? blocked() : unavailable();
      };
      return { body: parsed, headers: response.headers, refused,
        ok: () => { if (parsed.code !== CODE_OK) throw refused(); return parsed; } };
    } catch (error) {
      if (!(error instanceof Reported)) report(controller.signal.aborted ? 'timeout' : 'network');
      throw unavailable();
    } finally {
      clearTimeout(timer);
    }
  };
}

type Post = ReturnType<typeof createPoster>;

function validateKeyword(keyword: unknown, limit: unknown): { keyword: string; limit: number } {
  const text = typeof keyword === 'string' ? keyword.trim() : '';
  if (!text || [...text].length > KEYWORD_MAX) throw invalid('请输入 1–100 字的搜索关键词');
  const size = limit ?? SEARCH_LIMIT_DEFAULT;
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 1 || size > SEARCH_LIMIT_MAX) {
    throw invalid('搜索数量无效');
  }
  return { keyword: text, limit: size };
}

async function search(post: Post, keyword: string, limit?: number): Promise<MusicTrack[]> {
  const input = validateKeyword(keyword, limit);
  const payload = { s: input.keyword, type: SEARCH_TYPE_SONG, limit: input.limit, offset: 0, total: true };
  const result = (await post('/cloudsearch/get/web', payload)).ok().result;
  if (!isRecord(result)) throw unavailable();
  return result.songs === undefined ? [] : parseTracks(result.songs).slice(0, input.limit);
}

function isPlaylistHost(hostname: string): boolean {
  return hostname === 'music.163.com' || hostname.endsWith('.music.163.com') || hostname === '163cn.tv';
}

export function parsePlaylistId(input: unknown): string {
  const text = typeof input === 'string' ? input.trim() : '';
  const rejected = invalid('请输入网易云歌单链接或歌单 ID');
  if (!text || text.length > LINK_MAX) throw rejected;
  if (DIGITS.test(text)) return text;
  const url = parseUrl(text);
  if (!url || !isPlaylistHost(url.hostname)) throw rejected;
  const route = `${url.pathname}${url.search}${url.hash}`;
  const match = PLAYLIST_PATH.exec(route) ?? PLAYLIST_QUERY.exec(route);
  if (!match) throw rejected;
  return match[1];
}

async function playlistTrackIds(post: Post, id: string): Promise<{ name: string; ids: string[] }> {
  const { body, ok } = await post('/v6/playlist/detail', { id, n: MUSIC_QUEUE_LIMIT, s: 0 });
  if (body.code === CODE_NOT_FOUND || body.code === CODE_NO_ACCESS) {
    throw new CommunityStoreError(404, 'resource_missing', '歌单不存在或无权查看');
  }
  const playlist = ok().playlist;
  if (!isRecord(playlist) || typeof playlist.name !== 'string' || !Array.isArray(playlist.trackIds)) {
    throw unavailable();
  }
  const ids = playlist.trackIds
    .map((entry) => (isRecord(entry) ? readDigits(entry.id) : null))
    .filter((entry): entry is string => entry !== null)
    .slice(0, MUSIC_QUEUE_LIMIT);
  return { name: clampText(playlist.name, TITLE_MAX), ids };
}

async function playlist(post: Post, idOrUrl: string): Promise<{ name: string; tracks: MusicTrack[] }> {
  const { name, ids } = await playlistTrackIds(post, parsePlaylistId(idOrUrl));
  if (ids.length === 0) return { name, tracks: [] };
  const c = `[${ids.map((id) => `{"id":${id}}`).join(',')}]`;
  const detail = (await post('/v3/song/detail', { c })).ok();
  const byId = new Map(parseTracks(detail.songs).map((track) => [track.id, track]));
  const tracks = ids
    .map((id) => byId.get(`netease:${id}`))
    .filter((track): track is MusicTrack => track !== undefined);
  return { name, tracks };
}

function unplayableReason(entry: JsonObject): string {
  if (entry.code === CODE_NOT_FOUND) return UNPLAYABLE.removed;
  if (entry.fee === FEE_VIP) return UNPLAYABLE.vip;
  if (entry.fee === FEE_PURCHASE) return UNPLAYABLE.purchase;
  if (entry.code === CODE_REGION_BLOCKED) return UNPLAYABLE.region;
  return UNPLAYABLE.other;
}

function readSongUrl(entry: JsonObject): SongUrlResult {
  if (entry.url === null || entry.url === undefined) return { unplayable: unplayableReason(entry) };
  const url = parseUrl(entry.url);
  if (!url || !url.hostname.endsWith(AUDIO_HOST_SUFFIX)) throw unavailable();
  if (isRecord(entry.freeTrialInfo)) return { unplayable: UNPLAYABLE.trial };
  return { url: url.toString() };
}

async function songUrl(post: Post, trackId: string, cookie?: string | null): Promise<SongUrlResult> {
  if (!isMusicTrackId(trackId)) throw invalid('曲目无效');
  const digits = trackId.slice('netease:'.length);
  const payload = { ids: `[${digits}]`, level: 'standard', encodeType: 'aac' };
  const data = (await post('/song/enhance/player/url/v1', payload, cookie)).ok().data;
  if (!Array.isArray(data) || !isRecord(data[0])) throw unavailable();
  return readSongUrl(data[0]);
}

async function qrKey(post: Post): Promise<{ key: string; url: string }> {
  const key = (await post('/login/qrcode/unikey', { type: QR_TYPE_WEB })).ok().unikey;
  if (typeof key !== 'string' || !QR_KEY_PATTERN.test(key)) throw unavailable();
  return { key, url: `${QR_LOGIN_URL}${key}` };
}

function extractMusicU(headers: Headers): string {
  // Typed locally: the Workers type set used by the shared test project
  // predates Headers.getSetCookie, which Node has had since 19.7.
  const lines = (headers as Headers & { getSetCookie(): string[] }).getSetCookie();
  const match = lines
    .map((line) => MUSIC_U_SET_COOKIE.exec(line.trim()))
    .find((result): result is RegExpExecArray => result !== null);
  if (!match) throw unavailable();
  return `MUSIC_U=${match[1]}`;
}

async function qrCheck(post: Post, key: string): Promise<QrCheckResult> {
  if (typeof key !== 'string' || !QR_KEY_PATTERN.test(key)) throw invalid('二维码已失效，请重新获取');
  const { body, headers, refused } = await post('/login/qrcode/client/login', { key, type: QR_TYPE_WEB });
  if (body.code === QR_CODE_DONE) return { status: 'done', cookie: extractMusicU(headers) };
  const status = typeof body.code === 'number' ? QR_STATUS[body.code] : undefined;
  if (!status) throw refused();
  return { status };
}

function isVip(...records: unknown[]): boolean {
  return records.some((record) => isRecord(record) && typeof record.vipType === 'number' && record.vipType > 0);
}

async function account(post: Post, cookie: string): Promise<{ nickname: string; vip: boolean } | null> {
  if (typeof cookie !== 'string') throw invalid('网易云登录状态无效');
  const response = await post('/nuser/account/get', {}, cookie);
  if (response.body.code === CODE_NEED_LOGIN) return null;
  const { profile, account: accountInfo } = response.ok();
  if (profile === null || profile === undefined) return null;
  const nickname = isRecord(profile) ? clampText(profile.nickname, NICKNAME_MAX) : '';
  if (!nickname) throw unavailable();
  return { nickname, vip: isVip(profile, accountInfo) };
}

export function createNeteaseClient(deps: NeteaseClientDeps): NeteaseClient {
  const post = createPoster(deps);
  return {
    search: (keyword, limit) => search(post, keyword, limit),
    playlist: (idOrUrl) => playlist(post, idOrUrl),
    songUrl: (trackId, cookie) => songUrl(post, trackId, cookie),
    qrKey: () => qrKey(post),
    qrCheck: (key) => qrCheck(post, key),
    account: (cookie) => account(post, cookie),
  };
}
