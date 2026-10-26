// /api/avatar — a same-origin image proxy for upstream avatars whose
// Cross-Origin-Resource-Policy (e.g. `same-site` on nanako.org) blocks embedding
// them from this origin.
//
// Whatever this returns is served from the origin that holds the session cookie,
// so it must never be something a browser would render as a page or run as a
// script: only plain raster image types get through, always with nosniff and a
// sandboxing CSP. Redirects are followed by hand so every hop is re-checked —
// on a server with a private network behind it (the planned Node backend),
// `redirect: 'follow'` would let any allowed host bounce the proxy inwards.

import { ApiError } from './errors';

export const AVATAR_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
]);
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_TIMEOUT_MS = 5_000;
export const AVATAR_MAX_REDIRECTS = 2;

export interface AvatarPolicy {
  /** Exact hostnames the first request may target. */
  allowedHosts: readonly string[];
  /** This app's own hostnames: never fetched, so the proxy cannot call itself. */
  selfHosts: readonly string[];
  /** True when this exact URL is some user's stored avatar. */
  isStoredAvatar: (url: string) => Promise<boolean>;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Lowercased, without the trailing dot of a fully-qualified name ('localhost.'). */
function normalHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/\.+$/, '');
}

/** Checks every hop must pass, the first one included. */
function assertSafeHop(url: URL, policy: AvatarPolicy): void {
  if (url.protocol !== 'https:') throw new ApiError(400, '仅支持 https 头像');
  const host = normalHost(url);
  const isIpLiteral = IPV4.test(host) || host.includes(':') || host.startsWith('[');
  const isLocal = host === 'localhost' || host.endsWith('.localhost');
  if (isIpLiteral || isLocal || policy.selfHosts.includes(host)) {
    throw new ApiError(403, '不允许的头像来源');
  }
}

async function readCapped(body: ReadableStream<Uint8Array>, max: number): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new ApiError(502, '头像文件过大');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function imageHeaders(contentType: string): Headers {
  const headers = new Headers();
  headers.set('Content-Type', contentType);
  headers.set('Cache-Control', 'public, max-age=86400');
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
  headers.set('Content-Disposition', 'inline');
  return headers;
}

async function fetchHop(url: URL, fetchImpl: FetchLike, timeoutMs: number): Promise<Response> {
  try {
    return await fetchImpl(url.toString(), {
      headers: { Accept: 'image/*' },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ApiError(502, '头像获取失败');
  }
}

export async function proxyAvatar(
  raw: string | undefined,
  policy: AvatarPolicy,
  fetchImpl: FetchLike = fetch,
  timeoutMs: number = AVATAR_TIMEOUT_MS,
): Promise<Response> {
  if (!raw) throw new ApiError(400, '缺少头像地址');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ApiError(400, '无效的头像地址');
  }
  assertSafeHop(url, policy);
  // Exact hosts only: a whole registrable domain would include the app itself
  // once it moves to a subdomain. Any stored avatar URL is allowed verbatim,
  // which keeps unlisted avatar CDNs working with zero config.
  const listed = policy.allowedHosts.includes(normalHost(url));
  if (!listed && !(await policy.isStoredAvatar(raw))) {
    throw new ApiError(403, '不允许的头像来源');
  }

  for (let hop = 0; ; hop += 1) {
    const res = await fetchHop(url, fetchImpl, timeoutMs);
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('Location');
      if (!location || hop >= AVATAR_MAX_REDIRECTS) throw new ApiError(502, '头像获取失败');
      try {
        url = new URL(location, url);
      } catch {
        throw new ApiError(502, '头像获取失败');
      }
      assertSafeHop(url, policy);
      continue;
    }
    if (!res.ok || !res.body) throw new ApiError(502, '头像获取失败');

    const type = (res.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
    if (!AVATAR_TYPES.has(type)) throw new ApiError(415, '头像格式不受支持');
    const declared = Number(res.headers.get('Content-Length') ?? NaN);
    if (Number.isFinite(declared) && declared > AVATAR_MAX_BYTES) {
      throw new ApiError(502, '头像文件过大');
    }
    const bytes = await readCapped(res.body, AVATAR_MAX_BYTES);
    return new Response(bytes, { status: 200, headers: imageHeaders(type) });
  }
}
