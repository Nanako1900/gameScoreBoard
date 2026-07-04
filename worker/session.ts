// Session (HS256 JWT) + cookie helpers using Web Crypto only (Workers-safe).

export const SESSION_COOKIE = 'edg_session';
export const STATE_COOKIE = 'edg_oauth_state';

const SESSION_MAX_AGE_SEC = 30 * 24 * 3600; // ~30 days
const STATE_MAX_AGE_SEC = 600; // 10 minutes

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// --- base64url helpers -------------------------------------------------------

function bytesToB64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(s: string): Uint8Array {
  const norm = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = norm.length % 4 === 0 ? '' : '='.repeat(4 - (norm.length % 4));
  const bin = atob(norm + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function strToB64url(s: string): string {
  return bytesToB64url(encoder.encode(s));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function hmacSign(data: string, secret: string): Promise<string> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return bytesToB64url(new Uint8Array(sig));
}

async function hmacVerify(data: string, sig: string, secret: string): Promise<boolean> {
  const key = await hmacKey(secret);
  return crypto.subtle.verify('HMAC', key, b64urlToBytes(sig), encoder.encode(data));
}

// --- JWT session token -------------------------------------------------------

export interface SessionPayload {
  sub: string;
  iat: number;
  exp: number;
}

function isSessionPayload(v: unknown): v is SessionPayload {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.sub === 'string' && typeof o.iat === 'number' && typeof o.exp === 'number';
}

export async function signSession(
  claims: { sub: string },
  secret: string,
  maxAgeSec: number = SESSION_MAX_AGE_SEC,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = strToB64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload: SessionPayload = { sub: claims.sub, iat: now, exp: now + maxAgeSec };
  const body = strToB64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  // Domain-separate the session HMAC from the OAuth-state HMAC (same secret).
  const sig = await hmacSign(`session.${data}`, secret);
  return `${data}.${sig}`;
}

export async function verifySession(
  token: string,
  secret: string,
): Promise<SessionPayload | null> {
  // Total verification: any malformed/tampered cookie yields null (treated as
  // logged-out) instead of throwing — a corrupt cookie must not 500 every route.
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const ok = await hmacVerify(`session.${header}.${body}`, sig, secret);
    if (!ok) return null;
    const payload: unknown = JSON.parse(decoder.decode(b64urlToBytes(body)));
    if (!isSessionPayload(payload)) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// --- Signed OAuth state ------------------------------------------------------

function randomToken(bytes: number = 16): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return bytesToB64url(buf);
}

/** Create a fresh random state plus its signed cookie value. */
export async function makeSignedState(
  secret: string,
): Promise<{ state: string; cookieValue: string }> {
  const state = randomToken();
  const sig = await hmacSign(`state.${state}`, secret);
  return { state, cookieValue: `${state}.${sig}` };
}

/** Verify a signed state cookie; returns the embedded state, or null. */
export async function readSignedState(
  cookieValue: string,
  secret: string,
): Promise<string | null> {
  try {
    const idx = cookieValue.lastIndexOf('.');
    if (idx <= 0) return null;
    const state = cookieValue.slice(0, idx);
    const sig = cookieValue.slice(idx + 1);
    const ok = await hmacVerify(`state.${state}`, sig, secret);
    return ok ? state : null;
  } catch {
    return null;
  }
}

// --- Cookie helpers ----------------------------------------------------------

const BASE_ATTRS = 'HttpOnly; Secure; SameSite=Lax; Path=/';

export function buildSessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; ${BASE_ATTRS}; Max-Age=${SESSION_MAX_AGE_SEC}`;
}

export function buildClearSessionCookie(): string {
  return `${SESSION_COOKIE}=; ${BASE_ATTRS}; Max-Age=0`;
}

export function buildStateCookie(value: string): string {
  return `${STATE_COOKIE}=${value}; ${BASE_ATTRS}; Max-Age=${STATE_MAX_AGE_SEC}`;
}

export function buildClearStateCookie(): string {
  return `${STATE_COOKIE}=; ${BASE_ATTRS}; Max-Age=0`;
}

/** Read a single cookie value from the request's Cookie header. */
export function getCookie(req: Request, name: string): string | null {
  const header = req.headers.get('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) return part.slice(eq + 1).trim();
  }
  return null;
}
