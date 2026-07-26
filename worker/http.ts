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

export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await req.json();
    return isRecordObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
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
  if (!csv) return [];
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function cookieConfig(env: Env): CookieConfig {
  return { sameSite: env.COOKIE_SAMESITE, domain: env.COOKIE_DOMAIN };
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

/** Naive eTLD+1 (fine for simple domains like `nanako.org`). */
export function registrableSuffix(host: string): string {
  const parts = host.split('.');
  return parts.length <= 2 ? host : parts.slice(-2).join('.');
}

/** Allow the avatar proxy to fetch only from the OAuth provider's domain family
 *  (or an explicit AVATAR_ALLOWED_HOSTS list) — prevents the proxy being an open
 *  relay / SSRF vector. */
export function isAllowedAvatarHost(env: Env, host: string): boolean {
  if (parseCsvList(env.AVATAR_ALLOWED_HOSTS).includes(host)) return true;
  try {
    const oauthHost = new URL(env.OAUTH_BASE_URL).hostname;
    return host === oauthHost || registrableSuffix(host) === registrableSuffix(oauthHost);
  } catch {
    return false;
  }
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
  if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, `无效的${label} ID`);
  return id;
}

export function statementWindowHours(env: Env): number {
  const n = Number(env.STATEMENT_WINDOW_HOURS);
  if (!Number.isFinite(n) || n <= 0 || n > 24 * 14) return STATEMENT_WINDOW_HOURS;
  return n;
}

