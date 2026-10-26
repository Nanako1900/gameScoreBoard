// P8: a case's private parts — the statement, the appeal reason and the
// verdict's words — reach only its subject, its reporter, judges and admins,
// through every web route that returns cases. Runs on D1 and on PostgreSQL.

import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../../worker/index';
import { SESSION_COOKIE, signSession } from '../../worker/session';
import type { Env } from '../../worker/types';
import { noAiEnv, seedUser } from './helpers';

const SECRET = 'record-privacy-test-session-secret';
const ORIGIN = 'https://edg.test';
const MARKERS = ['SECRETSTMT', 'SECRETAPPEAL', 'SECRETHEAD', 'SECRETREASON', 'SECRETFACTOR'];

async function get(path: string, as?: string): Promise<{ status: number; text: string; json: Record<string, unknown>; cache: string | null }> {
  const headers = new Headers();
  if (as) headers.set('Cookie', `${SESSION_COOKIE}=${await signSession({ sub: as }, SECRET)}`);
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`${ORIGIN}${path}`, { headers }), noAiEnv({ SESSION_SECRET: SECRET }) as Env, ctx);
  await waitOnExecutionContext(ctx);
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) as Record<string, unknown>, cache: res.headers.get('Cache-Control') };
}

/** A decided, appealed case with every private part filled in, inside a session. */
async function cast(): Promise<{ recordId: number; sessionId: number }> {
  await seedUser({ id: 'subject' });
  await seedUser({ id: 'reporter', judge: true });
  await seedUser({ id: 'judge2', judge: true });
  await seedUser({ id: 'admin', admin: true });
  await seedUser({ id: 'outsider' });
  const session = await env.DB.prepare(
    "INSERT INTO game_sessions (organizer_id, title, starts_at, status) VALUES ('reporter', '周五五排', ?, 'settled')",
  )
    .bind(new Date(Date.now() - 86_400_000).toISOString())
    .run();
  const sessionId = Number(session.meta.last_row_id);
  const record = await env.DB.prepare(
    `INSERT INTO records (subject_id, reporter_id, type, delta, claim, claim_summary, statement, statement_at,
                          appeal_reason, verdict_source, verdict_headline, verdict_reason, verdict_factors, status, session_id)
     VALUES ('subject', 'reporter', 'no_show', -12, '说好八点五排结果没来', '八点没来', 'SECRETSTMT 家里有事', datetime('now'),
             'SECRETAPPEAL 不服', 'ai', 'SECRETHEAD', 'SECRETREASON 情有可原', ?, 'appealed', ?)`,
  )
    .bind(JSON.stringify([{ kind: 'mitigating', text: 'SECRETFACTOR' }]), sessionId)
    .run();
  return { recordId: Number(record.meta.last_row_id), sessionId };
}

function routes(recordId: number, sessionId: number): Array<{ path: string; pick: (json: Record<string, unknown>) => Record<string, unknown> }> {
  const first = (json: Record<string, unknown>) => (json.records as Array<Record<string, unknown>>)[0];
  return [
    { path: '/api/records', pick: first },
    { path: `/api/records/${recordId}`, pick: (json) => json.record as Record<string, unknown> },
    { path: '/api/users/subject', pick: first },
    { path: `/api/sessions/${sessionId}`, pick: first },
  ];
}

describe('a case’s private parts on the web', () => {
  for (const viewer of [undefined, 'outsider'] as const) {
    it(`are hidden from ${viewer ?? 'a visitor who is not logged in'}, on every route`, async () => {
      const { recordId, sessionId } = await cast();
      for (const route of routes(recordId, sessionId)) {
        const res = await get(route.path, viewer);
        expect(res.status, route.path).toBe(200);
        for (const marker of MARKERS) expect(res.text, `${route.path} leaks ${marker}`).not.toContain(marker);
        const record = route.pick(res.json);
        expect(record, route.path).toMatchObject({
          statement: null,
          appeal_reason: null,
          redacted: true,
          // The outcome stays public.
          delta: -12,
          type: 'no_show',
          status: 'appealed',
          claim: '说好八点五排结果没来',
          verdict: { source: 'ai', headline: '', reasoning: '', factors: [] },
        });
        expect(record.statement_at, route.path).not.toBeNull();
      }
    });
  }

  for (const viewer of ['subject', 'reporter', 'judge2', 'admin']) {
    it(`are shown to the ${viewer}`, async () => {
      const { recordId, sessionId } = await cast();
      for (const route of routes(recordId, sessionId)) {
        const res = await get(route.path, viewer);
        for (const marker of MARKERS) expect(res.text, `${route.path} for ${viewer}`).toContain(marker);
        expect(route.pick(res.json).redacted, route.path).toBe(false);
      }
    });
  }

  it('follow the role as it is now: a reporter who stepped down still sees their case; a removed judge does not', async () => {
    const { recordId } = await cast();
    await env.DB.prepare("UPDATE users SET is_judge = 0 WHERE id IN ('reporter', 'judge2')").run();
    expect((await get(`/api/records/${recordId}`, 'reporter')).text).toContain('SECRETSTMT');
    expect((await get(`/api/records/${recordId}`, 'judge2')).text).not.toContain('SECRETSTMT');
  });

  it('are decided case by case in one list', async () => {
    await cast();
    // outsider is the subject of a second case: theirs is shown, the first is not.
    await env.DB.prepare(
      `INSERT INTO records (subject_id, reporter_id, type, delta, claim, statement, statement_at, status)
       VALUES ('outsider', 'reporter', 'late_minor', -3, '迟到了', 'OWNWORDS', datetime('now'), 'decided')`,
    ).run();
    const res = await get('/api/records', 'outsider');
    const byStatement = (res.json.records as Array<Record<string, unknown>>).map((r) => [r.subject && (r.subject as { id: string }).id, r.redacted]);
    expect(byStatement.sort()).toEqual([
      ['outsider', false],
      ['subject', true],
    ]);
    expect(res.text).toContain('OWNWORDS');
    expect(res.text).not.toContain('SECRETSTMT');
  });

  it('are not kept by a shared cache: every case route answers private, no-store', async () => {
    const { recordId, sessionId } = await cast();
    for (const route of routes(recordId, sessionId)) {
      expect((await get(route.path)).cache, route.path).toBe('private, no-store');
    }
  });
});

describe('cases returned by writes', () => {
  async function post(path: string, as: string, body: unknown) {
    const headers = new Headers({ 'Content-Type': 'application/json', Cookie: `${SESSION_COOKIE}=${await signSession({ sub: as }, SECRET)}` });
    const ctx = createExecutionContext();
    const res = await worker.fetch(
      new Request(`${ORIGIN}${path}`, { method: 'POST', headers, body: JSON.stringify(body) }),
      noAiEnv({ SESSION_SECRET: SECRET }) as Env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    return JSON.parse(await res.text()) as Record<string, unknown>;
  }

  it('carry redacted: false for those who may read them (batch filing, an appeal)', async () => {
    await seedUser({ id: 'judge', judge: true });
    await seedUser({ id: 'p' });
    const filed = await post('/api/records', 'judge', { subject_ids: ['p'], claim: '说好八点五排结果没来也没说一声' });
    expect((filed.records as Array<Record<string, unknown>>)[0].redacted).toBe(false);
    await env.DB.prepare(
      "INSERT INTO records (subject_id, reporter_id, type, delta, claim, status, verdict_source) VALUES ('p', 'judge', 'no_show', -15, '没来', 'decided', 'ai')",
    ).run();
    const id = Number((await env.DB.prepare("SELECT id FROM records WHERE status = 'decided'").first<{ id: number }>())?.id);
    const appealed = await post(`/api/records/${id}/appeal`, 'p', { reason: '不服' });
    expect((appealed.record as Record<string, unknown>).redacted).toBe(false);
  });
});

