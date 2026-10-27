// S1 retires session APIs while preserving historical data for existing cases.
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../../worker/index';
import { SESSION_COOKIE, signSession } from '../../worker/session';
import { noAiEnv, scoreOf, seedUser } from './helpers';

const BASE = 'https://score.example.com';
const SECRET = 'test-session-secret-0123456789abcdef';

async function call(method: string, path: string, body?: Record<string, unknown>): Promise<Response> {
  const token = await signSession({ sub: 'judge' }, SECRET);
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(`${BASE}${path}`, {
    method,
    headers: {
      Cookie: `${SESSION_COOKIE}=${token}`,
      Origin: BASE,
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), noAiEnv({ SESSION_SECRET: SECRET }), ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

describe('session APIs are retired', () => {
  it.each([
    ['GET', '/api/sessions'],
    ['GET', '/api/sessions/1'],
    ['POST', '/api/sessions'],
    ['PATCH', '/api/sessions/1'],
    ['POST', '/api/sessions/1/cancel'],
    ['POST', '/api/sessions/1/invite'],
    ['POST', '/api/sessions/1/rsvp'],
    ['POST', '/api/sessions/1/rollcall'],
    ['POST', '/api/sessions/1/settle'],
    ['GET', '/api/me/invites'],
    ['GET', '/api/me/invitable'],
  ])('%s %s returns the existing JSON 404', async (method, path) => {
    await seedUser({ id: 'judge', judge: true });
    const response = await call(method, path, method === 'GET' ? undefined : {});
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Not found' });
  });
});

describe('manual bonuses are retired', () => {
  it.each(['on_time_bonus', 'organizer_bonus'])('rejects %s without filing or changing the score', async (type) => {
    await seedUser({ id: 'judge', judge: true });
    await seedUser({ id: 'subject', score: 50 });
    const response = await call('POST', '/api/records', { subject_id: 'subject', type });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: '加分类型已停用' });
    expect(await scoreOf('subject')).toBe(50);
    const records = await env.DB.prepare('SELECT COUNT(*) AS n FROM records').first<{ n: number }>();
    const events = await env.DB.prepare('SELECT COUNT(*) AS n FROM score_events').first<{ n: number }>();
    expect(records?.n).toBe(0);
    expect(events?.n).toBe(0);
  });
});
