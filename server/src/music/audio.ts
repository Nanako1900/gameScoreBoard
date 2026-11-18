// Downloading a resolved track for ffmpeg. Only NetEase's CDN may be fetched:
// the URL comes from an untrusted API response, so every hop (including
// redirects) is checked, and no error message ever carries the URL itself.
import { Readable } from 'node:stream';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';

export const MUSIC_AUDIO_HOST_SUFFIX = '.126.net';
export const MUSIC_AUDIO_MAX_REDIRECTS = 3;
export const MUSIC_AUDIO_HEADERS_TIMEOUT_MS = 10_000;
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const MAX_URL_LENGTH = 2_000;
const REDIRECT_MIN = 300;
const REDIRECT_MAX = 399;

/** Our own failures: their messages are safe to log (no URL, no response body). */
export class MusicAudioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MusicAudioError';
  }
}

export function isAllowedAudioUrl(value: string): boolean {
  if (typeof value !== 'string' || value.length > MAX_URL_LENGTH) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  return ALLOWED_PROTOCOLS.has(parsed.protocol)
    && parsed.username === '' && parsed.password === ''
    && host.endsWith(MUSIC_AUDIO_HOST_SUFFIX) && host.length > MUSIC_AUDIO_HOST_SUFFIX.length;
}

/**
 * NetEase hands out http links to a CDN that also serves https (open-source
 * players such as YesPlayMusic rewrite them the same way), so always use https.
 */
function preferHttps(url: string): string {
  const parsed = new URL(url);
  return parsed.protocol === 'http:' ? `https:${parsed.href.slice('http:'.length)}` : parsed.href;
}

async function fetchHop(fetcher: typeof fetch, url: string, signal: AbortSignal): Promise<Response> {
  if (!isAllowedAudioUrl(url)) throw new MusicAudioError('audio URL is not on an allowed host');
  return fetcher(preferHttps(url), { redirect: 'manual', signal });
}

function isRedirect(response: Response): boolean {
  return response.status >= REDIRECT_MIN && response.status <= REDIRECT_MAX;
}

/** Fetches the audio and returns its body as a Node stream; headers must arrive in time. */
export async function openAudioStream(
  fetcher: typeof fetch,
  url: string,
  timeoutMs: number = MUSIC_AUDIO_HEADERS_TIMEOUT_MS,
): Promise<Readable> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let target = url;
    for (let hop = 0; hop <= MUSIC_AUDIO_MAX_REDIRECTS; hop += 1) {
      const response = await fetchHop(fetcher, target, controller.signal);
      if (isRedirect(response)) {
        const location = response.headers.get('location');
        await response.body?.cancel().catch(() => undefined);
        if (!location) throw new MusicAudioError(`audio redirect without a location (HTTP ${response.status})`);
        target = new URL(location, target).toString();
        continue;
      }
      if (!response.ok || !response.body) {
        await response.body?.cancel().catch(() => undefined);
        throw new MusicAudioError(`audio request failed (HTTP ${response.status})`);
      }
      return Readable.fromWeb(response.body as unknown as NodeWebReadableStream<Uint8Array>);
    }
    throw new MusicAudioError('too many audio redirects');
  } catch (error) {
    if (error instanceof MusicAudioError) throw error;
    // Network errors may quote the URL: replace them with a fixed message.
    throw new MusicAudioError(controller.signal.aborted ? 'audio request timed out' : 'audio request failed');
  } finally {
    clearTimeout(timer);
  }
}
