// SOCKS proxy for the music bot's outbound traffic. The address may carry
// credentials, so it is stored sealed; callers only ever see host:port.
import { Agent, fetch as undiciFetch } from 'undici';
import type { MusicProxyView } from '../../../shared/music';
import { readSettings, writeSetting } from '../../../worker/ai/config';
import { AiSecretError } from '../../../worker/ai/secrets';
import { CommunityStoreError } from '../community/store';
import { openMusicSecret, sealMusicSecret } from './secrets';
import { bareHost, socksConnector } from './socks-connector';

export const MUSIC_PROXY_URL_KEY = 'music.proxy_url_encrypted';
export const MUSIC_PROXY_AUDIO_KEY = 'music.proxy_audio';

const MAX_PROXY_URL_LENGTH = 500;
const MIN_PORT = 1;
const MAX_PORT = 65535;
const SOCKS4_TYPE = 4;
const SOCKS5_TYPE = 5;
const AUDIO_ON = '1';
const AUDIO_OFF = '0';
const ALLOWED_PROTOCOLS: ReadonlyMap<string, 4 | 5> = new Map([
  ['socks5:', SOCKS5_TYPE],
  ['socks5h:', SOCKS5_TYPE],
  ['socks4:', SOCKS4_TYPE],
]);
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000- \u007f-\u009f]/;

const INVALID_PROXY_MESSAGE = '代理地址无效，请使用 socks5://主机:端口 的格式';
const KEY_UNAVAILABLE_MESSAGE = '服务器未配置主密钥，暂时无法保存代理地址';

export type MusicProxyError = 'master_key_missing' | 'master_key_invalid' | 'decrypt_failed';

export interface MusicProxyState {
  /** Plain address for runtime use; null when unset OR when it cannot be read. */
  url: string | null;
  audio: boolean;
  view: MusicProxyView;
  /** Set when an address is stored but unusable: callers must fail closed. */
  error: MusicProxyError | null;
}

function invalidProxy(): CommunityStoreError {
  return new CommunityStoreError(400, 'invalid_input', INVALID_PROXY_MESSAGE);
}

export function parseProxyUrl(input: unknown): { url: string; host: string } {
  if (typeof input !== 'string' || input.length === 0 || input.length > MAX_PROXY_URL_LENGTH) {
    throw invalidProxy();
  }
  if (UNSAFE_CHARS.test(input)) throw invalidProxy();
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw invalidProxy();
  }
  const port = Number(parsed.port);
  const hasExtras = (parsed.pathname !== '' && parsed.pathname !== '/') || parsed.search !== '' || parsed.hash !== '';
  if (
    !ALLOWED_PROTOCOLS.has(parsed.protocol) ||
    parsed.hostname === '' ||
    parsed.port === '' ||
    !Number.isInteger(port) ||
    port < MIN_PORT ||
    port > MAX_PORT ||
    hasExtras
  ) {
    throw invalidProxy();
  }
  return { url: input, host: `${parsed.hostname}:${parsed.port}` };
}

function hostOf(url: string): string {
  return parseProxyUrl(url).host;
}

function viewOf(url: string | null, configured: boolean, audio: boolean, available: boolean): MusicProxyView {
  return { configured, host: url === null ? null : hostOf(url), audio, available };
}

async function decryptStored(
  envelope: string,
  masterKey: string,
): Promise<{ url: string | null; error: MusicProxyError | null }> {
  try {
    return { url: await openMusicSecret(envelope, masterKey, 'proxy'), error: null };
  } catch (error) {
    const code = error instanceof AiSecretError ? error.code : 'decrypt_failed';
    return { url: null, error: code };
  }
}

export async function readMusicProxy(
  db: D1Database,
  masterKey: string | undefined,
): Promise<MusicProxyState> {
  const settings = await readSettings(db);
  const envelope = settings.get(MUSIC_PROXY_URL_KEY) ?? '';
  const audio = settings.get(MUSIC_PROXY_AUDIO_KEY) === AUDIO_ON;
  const configured = envelope.length > 0;
  if (!masterKey) {
    return {
      url: null,
      audio,
      view: viewOf(null, configured, audio, false),
      error: configured ? 'master_key_missing' : null,
    };
  }
  if (!configured) return { url: null, audio, view: viewOf(null, false, audio, true), error: null };
  const { url, error } = await decryptStored(envelope, masterKey);
  return { url, audio, view: viewOf(url, true, audio, true), error };
}

export async function saveMusicProxy(
  db: D1Database,
  masterKey: string | undefined,
  url: string | null,
  audio: boolean,
  updatedBy: string,
): Promise<MusicProxyView> {
  if (!masterKey) throw new CommunityStoreError(503, 'feature_disabled', KEY_UNAVAILABLE_MESSAGE);
  // Validate before any write so a bad address leaves existing settings intact.
  const parsed = url === null ? null : parseProxyUrl(url);
  const envelope = parsed === null ? '' : await sealMusicSecret(parsed.url, masterKey, 'proxy');
  await writeSetting(db, MUSIC_PROXY_URL_KEY, envelope, updatedBy);
  await writeSetting(db, MUSIC_PROXY_AUDIO_KEY, audio ? AUDIO_ON : AUDIO_OFF, updatedBy);
  return viewOf(parsed?.url ?? null, parsed !== null, audio, true);
}

/** Changes only the audio switch; the stored address is left untouched. */
export async function saveMusicProxyAudio(
  db: D1Database,
  masterKey: string | undefined,
  audio: boolean,
  updatedBy: string,
): Promise<MusicProxyView> {
  if (!masterKey) throw new CommunityStoreError(503, 'feature_disabled', KEY_UNAVAILABLE_MESSAGE);
  await writeSetting(db, MUSIC_PROXY_AUDIO_KEY, audio ? AUDIO_ON : AUDIO_OFF, updatedBy);
  return (await readMusicProxy(db, masterKey)).view;
}

export function createMusicFetch(proxyUrl: string | null): typeof fetch {
  if (proxyUrl === null) return globalThis.fetch;
  const parsed = new URL(proxyUrl);
  const type = ALLOWED_PROTOCOLS.get(parsed.protocol);
  if (type === undefined) throw invalidProxy();
  const dispatcher = new Agent({
    connect: socksConnector({
      type,
      host: bareHost(parsed.hostname),
      port: Number(parsed.port),
      userId: parsed.username ? decodeURIComponent(parsed.username) : undefined,
      password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    }),
  });
  return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
    undiciFetch(input as Parameters<typeof undiciFetch>[0], {
      ...(init as Parameters<typeof undiciFetch>[1]),
      dispatcher,
    })) as unknown as typeof fetch;
}
