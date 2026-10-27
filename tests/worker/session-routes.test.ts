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

describe('POST /api/sessions/:id/invite (P2-1)', () => {
  const IN_3H = (): string => new Date(Date.now() + 3 * 3_600_000).toISOString();
  const json = { 'Content-Type': 'application/json' };

  /** `org` opens a session through the API; `a` and `b` exist. Returns its id. */
  async function openSession(): Promise<number> {
    await seedUser({ id: 'org' });
    await seedUser({ id: 'a' });
    await seedUser({ id: 'b', participant: false });
    const res = await call('/api/sessions', {
      method: 'POST',
      headers: await asUser('org', json),
      body: JSON.stringify({ starts_at: IN_3H() }),
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { session: { id: number } }).session.id;
  }

  async function invite(path: string, sub: string, body: unknown, overrides: Partial<Env> = {}): Promise<Response> {
    return call(path, { method: 'POST', headers: await asUser(sub, json), body: JSON.stringify(body) }, overrides);
  }

  async function rosterOf(id: number): Promise<string[]> {
    const res = await call(`/api/sessions/${id}`);
    const body = (await res.json()) as { session: { players: { user: { id: string } }[] } };
    return body.session.players.map((p) => p.user.id).sort();
  }

  it('invites, and answers exactly { session, added, skipped }', async () => {
    const id = await openSession();
    const res = await invite(`/api/sessions/${id}/invite`, 'org', { user_ids: ['a', 'b', 'ghost'] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      session: { id: number; players: { user: { id: string }; rsvp: string }[] };
      added: number;
      skipped: number;
    };
    expect(Object.keys(body).sort()).toEqual(['added', 'session', 'skipped']);
    expect(body).toMatchObject({ added: 2, skipped: 1, session: { id } });
    expect(body.session.players.filter((p) => p.rsvp === 'invited').map((p) => p.user.id).sort()).toEqual(['a', 'b']);
    // Nothing about who can be reached by DM (spec §11 #9).
    expect(JSON.stringify(body).toLowerCase()).not.toContain('discord');
  });

  it('answers 401 未登录 without a session cookie', async () => {
    const id = await openSession();
    const res = await call(`/api/sessions/${id}/invite`, {
      method: 'POST',
      headers: { Origin: 'https://score.example.com', ...json },
      body: JSON.stringify({ user_ids: ['a'] }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: '未登录' });
  });

  it('answers 400 for a bad id, 404 for a missing session, 403 for a stranger', async () => {
    const id = await openSession();
    const bad = await invite('/api/sessions/abc/invite', 'org', { user_ids: ['a'] });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: '无效的约局 ID' });
    const missing = await invite('/api/sessions/999999/invite', 'org', { user_ids: ['a'] });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: '约局不存在' });
    const stranger = await invite(`/api/sessions/${id}/invite`, 'a', { user_ids: ['b'] });
    expect(stranger.status).toBe(403);
    expect(await stranger.json()).toEqual({ error: '只有组织者可以操作这个约局' });
    const noList = await invite(`/api/sessions/${id}/invite`, 'org', {});
    expect(noList.status).toBe(400);
    expect(await noList.json()).toEqual({ error: 'user_ids 必须是数组' });
  });

  it('writes nothing for a cross-origin form-style post or while read-only', async () => {
    const id = await openSession();
    // text/plain needs no preflight, and readJsonBody still parses it: hono/csrf must stop it.
    const foreign = await call(`/api/sessions/${id}/invite`, {
      method: 'POST',
      headers: await asUser('org', { 'Content-Type': 'text/plain', Origin: 'https://evil.example.com' }),
      body: JSON.stringify({ user_ids: ['a'] }),
    });
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toEqual({ error: '请求来源不被允许' });
    const readOnly = await invite(`/api/sessions/${id}/invite`, 'org', { user_ids: ['a'] }, { READ_ONLY: '1' });
    expect(readOnly.status).toBe(503);
    expect(await readOnly.json()).toEqual({ error: '系统维护中（只读），请稍后再试' });
    expect(await rosterOf(id)).toEqual(['org']);
  });
});
