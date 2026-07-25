// Shared fixtures for the D1-backed integration tests.

import { env } from 'cloudflare:test';
import type { Env, User } from '../../worker/types';

export interface SeedUser {
  id: string;
  username?: string;
  participant?: boolean;
  judge?: boolean;
  admin?: boolean;
  score?: number;
}

export async function seedUser(seed: SeedUser): Promise<User> {
  await env.DB.prepare(
    `INSERT INTO users (id, username, is_participant, is_judge, is_admin, score)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      seed.id,
      seed.username ?? seed.id,
      seed.participant === false ? 0 : 1,
      seed.judge ? 1 : 0,
      seed.admin ? 1 : 0,
      seed.score ?? 100,
    )
    .run();
  return {
    id: seed.id,
    username: seed.username ?? seed.id,
    oauth_username: seed.username ?? seed.id,
    avatar_url: null,
    is_participant: seed.participant !== false,
    is_judge: seed.judge === true,
    is_admin: seed.admin === true,
    score: seed.score ?? 100,
    created_at: new Date().toISOString(),
  };
}

export async function scoreOf(id: string): Promise<number> {
  const row = await env.DB.prepare('SELECT score FROM users WHERE id = ?')
    .bind(id)
    .first<{ score: number }>();
  return row?.score ?? -1;
}

export async function statusOf(recordId: number): Promise<string> {
  const row = await env.DB.prepare('SELECT status FROM records WHERE id = ?')
    .bind(recordId)
    .first<{ status: string }>();
  return row?.status ?? 'missing';
}

export async function scoreEventCount(userId: string): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM score_events WHERE user_id = ?')
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Force a case's statement window into the past so the sweep will pick it up. */
export async function expireDeadline(recordId: number): Promise<void> {
  await env.DB.prepare(
    "UPDATE records SET deadline_at = datetime('now', '-1 hour') WHERE id = ?",
  )
    .bind(recordId)
    .run();
}

/** Env with AI switched off — verdicts then use the deterministic base sentence. */
export function noAiEnv(overrides: Partial<Env> = {}): Env {
  return { ...(env as unknown as Env), AI_ENABLED: 'false', ...overrides };
}

export const OFFSET_HOURS = 8;
