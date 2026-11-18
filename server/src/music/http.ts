// Request parsing for the music routes. Mirrors the community routes' rules
// (JSON only, no NUL, exact fields) with a larger body limit, because an
// imported playlist can carry up to MUSIC_QUEUE_LIMIT tracks in one command.
import type { Context } from 'hono';
import { CommunityStoreError } from '../community/store';

export type MusicRouteEnv = { Variables: { communityUserId: string } };
export type MusicBody = Readonly<Record<string, unknown>>;

const MAX_BODY_BYTES = 262_144;
const MAX_REQUEST_KEY = 200;
const JSON_CONTENT_TYPE = /^application\/json(?:;|$)/i;

export function fail(status: number, code: string, message: string): never {
  throw new CommunityStoreError(status, code, message);
}

export function invalidInput(message = '请求字段无效'): never {
  return fail(400, 'invalid_input', message);
}

export async function readBody(c: Context): Promise<MusicBody> {
  if (!JSON_CONTENT_TYPE.test(c.req.header('Content-Type') ?? '')) return fail(415, 'invalid_input', '请使用 JSON 请求');
  const raw = await c.req.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return fail(413, 'invalid_input', '请求内容过长');
  if (raw.includes('\u0000') || raw.includes('\\u0000')) return invalidInput('请求内容无效');
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return invalidInput('JSON 格式无效');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalidInput('请求内容无效');
  return value as MusicBody;
}

export function exactFields(body: MusicBody, allowed: readonly string[]): void {
  if (Object.keys(body).some((field) => !allowed.includes(field))) invalidInput();
}

export function requestKey(body: MusicBody): string {
  const value = body.requestKey;
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_REQUEST_KEY) {
    return invalidInput('缺少有效的请求标识');
  }
  return value;
}

export function userOf(c: Context<MusicRouteEnv>): string {
  return c.get('communityUserId');
}
