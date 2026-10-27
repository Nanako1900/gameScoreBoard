// HTTP layer of the P2 lobby endpoints, through the real app so middleware
// order (CSRF, READ_ONLY, auth) and error mapping are covered too. Runs on D1
// and, through vitest.pg.config.ts, on PostgreSQL.
//
// P2-2 creates this file with the shared helpers below; P2-1, P2-6, P2-3 and
// P2-4 each append one describe at the end and leave the rest as it is.

import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../../worker/index';
import { SESSION_COOKIE, signSession } from '../../worker/session';
import type { Env } from '../../worker/types';
import { noAiEnv, seedUser } from './helpers';

const BASE = 'https://score.example.com';
const SECRET = 'test-session-secret-0123456789abcdef';

function appEnv(overrides: Partial<Env> = {}): Env {
  return noAiEnv({
    SESSION_SECRET: SECRET,
    OAUTH_BASE_URL: 'https://idp.example.com',
    OAUTH_CLIENT_ID: 'client',
    OAUTH_CLIENT_SECRET: 'secret',
    ...overrides,
  });
}

async function call(path: string, init: RequestInit = {}, overrides: Partial<Env> = {}): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`${BASE}${path}`, init), appEnv(overrides), ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

/** Headers of a same-origin request signed in as `sub`. */
async function asUser(sub: string, extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const token = await signSession({ sub }, SECRET);
  return { Cookie: `${SESSION_COOKIE}=${token}`, Origin: BASE, ...extra };
}

describe('GET /api/me/invitable (P2-2)', () => {
  /** PostgreSQL only: bind `userId` to Discord. D1 has no discord_links table — the one error allowed. */
  async function bindDiscordWherePossible(userId: string): Promise<void> {
    try {
      await env.DB.prepare(
        "INSERT INTO discord_links (discord_user_id, user_id, discord_username) VALUES ('123456789012345678', ?, 'discordhandle')",
      )
        .bind(userId)
        .run();
    } catch (err) {
      expect(String(err)).toMatch(/no such table: discord_links/);
    }
  }

  it('answers 401 未登录 without a session', async () => {
    const res = await call('/api/me/invitable');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: '未登录' });
  });

  it('lists everyone but the caller, privately, with five keys and nothing about scores or Discord', async () => {
    await seedUser({ id: 'me' });
    await seedUser({ id: 'a', score: 37, judge: true });
    await seedUser({ id: 'b', participant: false });
    await env.DB.prepare("UPDATE users SET display_name = '阿杰', email = 'a@example.com' WHERE id = 'a'").run();
    await bindDiscordWherePossible('a');

    const res = await call('/api/me/invitable', { headers: await asUser('me') });

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      users: [
        { id: 'a', username: '阿杰', avatar_url: null, is_participant: true, last_played_with_me_at: null },
        { id: 'b', username: 'b', avatar_url: null, is_participant: false, last_played_with_me_at: null },
      ],
    });
    for (const leak of ['score', 'discord', '123456789012345678', 'email', 'judge']) {
      expect(text.toLowerCase(), leak).not.toContain(leak);
    }
  });

  it('still answers while the site is read-only: it writes nothing', async () => {
    await seedUser({ id: 'me' });
    await seedUser({ id: 'a' });

    const res = await call('/api/me/invitable', { headers: await asUser('me') }, { READ_ONLY: '1' });

    expect(res.status).toBe(200);
    expect(((await res.json()) as { users: { id: string }[] }).users.map((u) => u.id)).toEqual(['a']);
  });
});
