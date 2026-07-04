// Nanako OAuth (authorization-code) helpers. External JSON is parsed as
// `unknown` and narrowed with tolerant field mapping (see docs/CONTRACT.md).

import type { Env } from './types';

export interface OAuthProfile {
  id: string;
  username: string;
  avatar_url: string | null;
  email: string | null;
}

function base(env: Env): string {
  return env.OAUTH_BASE_URL.replace(/\/$/, '');
}

/** redirect_uri = APP_URL/auth/callback, else request-origin/auth/callback. */
export function resolveRedirectUri(env: Env, req: Request): string {
  const origin = env.APP_URL ? env.APP_URL.replace(/\/$/, '') : new URL(req.url).origin;
  return `${origin}/auth/callback`;
}

export function buildAuthorizeUrl(env: Env, redirectUri: string, state: string): string {
  const url = new URL(`${base(env)}/oauth/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', env.OAUTH_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', 'profile');
  url.searchParams.set('state', state);
  return url.toString();
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Pick the first present string/number field from a candidate key list. */
function pickString(obj: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.length > 0) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

/** Exchange the authorization code for an access token. */
export async function exchangeCode(
  env: Env,
  code: string,
  redirectUri: string,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: env.OAUTH_CLIENT_ID,
    client_secret: env.OAUTH_CLIENT_SECRET,
  });
  const res = await fetch(`${base(env)}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`token exchange failed: ${res.status}`);
  }
  const json: unknown = await res.json();
  if (!isRecord(json) || typeof json.access_token !== 'string') {
    throw new Error('token response missing access_token');
  }
  return json.access_token;
}

/** Fetch and tolerantly map the userinfo profile. */
export async function fetchUserInfo(env: Env, accessToken: string): Promise<OAuthProfile> {
  const res = await fetch(`${base(env)}/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`userinfo failed: ${res.status}`);
  }
  const json: unknown = await res.json();
  if (!isRecord(json)) {
    throw new Error('userinfo response is not an object');
  }
  const id = pickString(json, ['sub', 'id', 'user_id']);
  if (!id) {
    throw new Error('userinfo missing subject id');
  }
  const username = pickString(json, ['username', 'name', 'nickname', 'preferred_username']);
  const avatar = pickString(json, ['avatar', 'picture', 'avatar_url', 'photo']);
  const email = pickString(json, ['email']);
  return {
    id,
    username: username ?? id, // schema requires a non-null username
    avatar_url: avatar,
    email,
  };
}
