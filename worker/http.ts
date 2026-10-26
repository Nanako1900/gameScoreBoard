// Shared request-parsing helpers for the route modules.
//
// Everything arriving from the network is `unknown` until it passes through one of
// these; keeping them in one place means the narrowing rules cannot drift between
// routes.ts and routes-admin.ts.

import type { Env, User } from './types';
import { ApiError } from './errors';
import { STATEMENT_WINDOW_HOURS } from '../shared/scoring';
import type { CookieConfig } from './session';

// --- input narrowing helpers -------------------------------------------------

export function isRecordObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** True if any string (or key) anywhere in a parsed JSON value contains U+0000. */
function containsNul(v: unknown): boolean {
  if (typeof v === 'string') return v.includes('\u0000');
  if (Array.isArray(v)) return v.some(containsNul);
  if (isRecordObject(v)) return Object.entries(v).some(([k, x]) => k.includes('\u0000') || containsNul(x));
  return false;
}

/** The message for a request carrying U+0000 (see hasNulInUrl). */
export const NUL_MESSAGE = '请求包含非法字符';

/**
 * U+0000 is refused at the edge, in the URL (hasNulInUrl) and in JSON bodies
 * here. PostgreSQL text cannot hold it and the database adapter strips it, so
 * 'alice\u0000' would look up alice while every JS comparison saw a different
 * id — enough to slip past a "not yourself" check. Refusing it gives the same
 * answer on D1 and on PostgreSQL.
 */
export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return {};
  }
  if (containsNul(parsed)) throw new ApiError(400, NUL_MESSAGE);
  return isRecordObject(parsed) ? parsed : {};
}

/** A NUL can only reach a URL percent-encoded. */
export function hasNulInUrl(url: string): boolean {
  return /%00/i.test(url);
}

export function optBool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

export function optNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export function optString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export function requireString(v: unknown, label: string): string {
  if (typeof v !== 'string' || v.trim().length === 0) {
    throw new ApiError(400, `缺少 ${label}`);
  }
  return v;
}

export function parseCsvList(csv: string | undefined): string[] {
  if (csv === undefined || csv === null) return [];
  // String(): a var written unquoted in TOML / dashboard JSON arrives as a number.
  return String(csv)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function cookieConfig(env: Env): CookieConfig {
  // String(): an unquoted TOML `HOST_ONLY_COOKIES = 1` arrives as a number.
  const hostOnly = ['1', 'true', 'yes'].includes(String(env.HOST_ONLY_COOKIES ?? '').trim().toLowerCase());
  if (hostOnly && env.COOKIE_DOMAIN) {
    // A __Host- cookie with a Domain attribute is silently dropped by the
    // browser: nobody could log in. Refuse loudly instead.
    throw new ApiError(500, '服务器配置错误：HOST_ONLY_COOKIES 不能与 COOKIE_DOMAIN 同时设置');
  }
  return { sameSite: env.COOKIE_SAMESITE, domain: env.COOKIE_DOMAIN, hostOnly };
}

/**
 * Where a non-API request should go once the SPA lives elsewhere (FRONTEND_URL,
 * e.g. on Cloudflare Pages): the same path and query there. Null when the SPA
 * is still served from here.
 */
export function legacySpaRedirect(env: Env, requestUrl: string): string | null {
  if (!env.FRONTEND_URL) return null;
  let frontend: URL;
  try {
    frontend = new URL(env.FRONTEND_URL);
  } catch {
    return null;
  }
  const url = new URL(requestUrl);
  if (url.origin === frontend.origin) return null;
  return `${frontend.origin}${url.pathname}${url.search}`;
}

/** READ_ONLY=1 / true: maintenance mode for the database cutover. */
export function isReadOnly(env: Env): boolean {
  // String(): `READ_ONLY = true` unquoted in TOML arrives as a boolean.
  return ['1', 'true', 'yes'].includes(String(env.READ_ONLY ?? '').trim().toLowerCase());
}

/**
 * Origins whose pages may make state-changing requests with the session
 * cookie: this request's own origin, APP_URL, and every FRONTEND_ORIGIN.
 */
export function allowedOrigins(env: Env, requestUrl: string): string[] {
  const configured = [...parseCsvList(env.FRONTEND_ORIGIN), ...(env.APP_URL ? [env.APP_URL] : [])];
  const origins = [new URL(requestUrl).origin];
  for (const entry of configured) {
    try {
      const url = new URL(entry);
      // 'app.example.com:8443' or 'capacitor://localhost' parse without error
      // but have the opaque origin 'null' — which is exactly what a sandboxed
      // iframe or data: URL sends as Origin. Only real web origins count.
      if (url.protocol === 'https:' || url.protocol === 'http:') origins.push(url.origin);
    } catch {
      // Malformed entries are skipped; a bad APP_URL also fails loudly on login.
    }
  }
  return origins;
}

/** Fail fast with a clear message when required config (the OAuth secrets) is
 *  missing, instead of surfacing an opaque 500 from a downstream undefined. */
export function requireEnv(env: Env, keys: readonly (keyof Env)[]): void {
  const missing = keys.filter((k) => {
    const v = env[k];
    return typeof v !== 'string' || v.length === 0;
  });
  if (missing.length > 0) {
    throw new ApiError(
      500,
      `服务器缺少配置：${missing.join('、')} —— 请在 Worker 的 Variables and Secrets 里以「机密(Secret)」设置`,
    );
  }
}

/**
 * Hostnames the avatar proxy may fetch from by name: the OAuth provider's own
 * host plus AVATAR_ALLOWED_HOSTS. Exact matches — not the whole registrable
 * domain, which would include this app once it lives on a sibling subdomain.
 */
export function avatarAllowedHosts(env: Env): string[] {
  const hosts = parseCsvList(env.AVATAR_ALLOWED_HOSTS).map((h) => h.toLowerCase());
  try {
    hosts.push(new URL(env.OAUTH_BASE_URL).hostname.toLowerCase());
  } catch {
    // No usable OAuth host: only the explicit list (and stored avatars) apply.
  }
  return hosts;
}

export function requireUser(caller: User | null): User {
  if (!caller) throw new ApiError(401, '未登录');
  return caller;
}

export function requireAdmin(caller: User | null): User {
  const user = requireUser(caller);
  if (!user.is_admin) throw new ApiError(403, '需要管理员权限');
  return user;
}

export function parseId(raw: string, label: string): number {
  const id = Number(raw);
  // Safe integers only: 1e20 is an "integer" to JS, but it overflows
  // PostgreSQL's bigint and the lookup would fail with a 500, not a 404.
  if (!Number.isSafeInteger(id) || id <= 0) throw new ApiError(400, `无效的${label} ID`);
  return id;
}

export function statementWindowHours(env: Env): number {
  const n = Number(env.STATEMENT_WINDOW_HOURS);
  if (!Number.isFinite(n) || n <= 0 || n > 24 * 14) return STATEMENT_WINDOW_HOURS;
  return n;
}

