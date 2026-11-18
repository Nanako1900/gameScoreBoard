// One rule for album covers, shared by the NetEase client (which produces them)
// and the queue reducer (which accepts them from the browser): https only, on
// NetEase's image hosts, without credentials and within the stored length.

export const MUSIC_COVER_HOST_SUFFIX = '.music.126.net';
export const MUSIC_COVER_URL_MAX = 500;
const INPUT_URL_MAX = 2_000;

/**
 * The normalised https cover URL, or null when the value is not an acceptable
 * cover. `upgradeHttp` lets the client take NetEase's own http links.
 */
export function neteaseCoverUrl(value: unknown, options: { upgradeHttp: boolean }): string | null {
  if (typeof value !== 'string' || value.length > INPUT_URL_MAX) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const httpAllowed = options.upgradeHttp && url.protocol === 'http:';
  if (url.protocol !== 'https:' && !httpAllowed) return null;
  if (url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (!host.endsWith(MUSIC_COVER_HOST_SUFFIX) || host.length === MUSIC_COVER_HOST_SUFFIX.length) return null;
  const normalised = `https://${host}${url.pathname}${url.search}`;
  return normalised.length <= MUSIC_COVER_URL_MAX ? normalised : null;
}
