// Discord OAuth2 with the `identify` scope only — enough to learn who the
// Discord user is, nothing more. Used once per binding (link-routes.ts): the
// access token goes straight from exchangeCode() into fetchMe() and is then
// dropped. It is never stored, logged or put into an error message.

import { isDiscordId } from './links';

const AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
const TOKEN_URL = 'https://discord.com/api/oauth2/token';
const ME_URL = 'https://discord.com/api/users/@me';
const TIMEOUT_MS = 10_000;

export interface DiscordIdentity {
  id: string;
  /** The unique handle (`@name`) — what gets stored. */
  username: string;
  /** For display only: the global display name when set, else the handle. */
  displayName: string;
}

export interface AuthorizeInput {
  clientId: string;
  redirectUri: string;
  state: string;
}

/**
 * prompt=consent: the user always sees Discord's own page saying which account
 * is about to be shared, even when they authorized this app before.
 */
export function authorizeUrl(input: AuthorizeInput): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('state', input.state);
  return url.toString();
}

export interface ExchangeInput {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

async function readJson(res: Response, what: string): Promise<Record<string, unknown>> {
  // Status only: Discord's error bodies are not ours to echo, and the request
  // itself carried the client secret / token.
  if (!res.ok) {
    // Unread, the body would hold its pooled connection until GC.
    await res.body?.cancel().catch(() => undefined);
    throw new Error(`Discord ${what} failed: HTTP ${res.status}`);
  }
  const json: unknown = await res.json().catch(() => null);
  if (!isRecord(json)) throw new Error(`Discord ${what} returned no JSON object`);
  return json;
}

/** Trade the authorization code for an access token. */
export async function exchangeCode(input: ExchangeInput, fetchImpl: typeof fetch = fetch): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    client_secret: input.clientSecret,
  });
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = await readJson(res, 'token exchange');
  if (typeof json.access_token !== 'string' || json.access_token.length === 0) {
    throw new Error('Discord token response has no access_token');
  }
  return json.access_token;
}

/** Who the token belongs to. */
export async function fetchMe(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<DiscordIdentity> {
  const res = await fetchImpl(ME_URL, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = await readJson(res, 'users/@me');
  const id = typeof json.id === 'string' ? json.id : '';
  // The id is what the binding is keyed on; anything but a snowflake is refused.
  if (!isDiscordId(id)) throw new Error('Discord users/@me returned no valid id');
  const username = typeof json.username === 'string' ? json.username.trim() : '';
  if (username.length === 0) throw new Error('Discord users/@me returned no username');
  const globalName = typeof json.global_name === 'string' ? json.global_name.trim() : '';
  return { id, username, displayName: globalName.length > 0 ? globalName : username };
}
