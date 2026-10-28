import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../worker/index';
import { SESSION_COOKIE, signSession } from '../../worker/session';
import { noAiEnv, seedUser } from './helpers';

const SECRET = 'admin-filing-local-test-secret-123456789';
const BASE = 'https://score.example';
const CLAIM = '说好八点一起开黑，等到八点四十也没上线，消息也没有回复。';
beforeEach(async () => {
  await seedUser({ id: 'admin', admin: true, participant: false });
  await seedUser({ id: 'ordinary' });
  await seedUser({ id: 'a' }); await seedUser({ id: 'b' });
});
async function post(actor: string, body: unknown) {
  const context = createExecutionContext();
  const cookie = `${SESSION_COOKIE}=${await signSession({ sub: actor }, SECRET)}`;
  const response = await worker.fetch(new Request(BASE + '/api/records', {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify(body),
  }), noAiEnv({ SESSION_SECRET: SECRET }), context);
  await waitOnExecutionContext(context); return response;
}

describe('judge or administrator filing through the real HTTP route', () => {
  it('lets a nonjudge, unlisted admin file the actual multi-subject dialog shape', async () => {
    const response = await post('admin', { subject_ids: ['a', 'b'], claim: CLAIM });
    expect(response.status).toBe(200);
    const body = await response.json() as { records: { subject: { id: string }; reporter: { id: string }; status: string }[]; failed: unknown[] };
    expect(body.failed).toEqual([]); expect(body.records.map(record => record.subject.id)).toEqual(['a', 'b']);
    expect(body.records.every(record => record.reporter.id === 'admin' && record.status === 'awaiting_statement')).toBe(true);
    expect((await env.DB.prepare('SELECT subject_id, reporter_id, status FROM records ORDER BY id').all()).results)
      .toEqual([{ subject_id: 'a', reporter_id: 'admin', status: 'awaiting_statement' }, { subject_id: 'b', reporter_id: 'admin', status: 'awaiting_statement' }]);
    expect((await env.DB.prepare("SELECT score FROM users WHERE id IN ('a','b') ORDER BY id").all()).results).toEqual([{ score: 100 }, { score: 100 }]);
  });
  it.each([false, true])('lets the same admin use the single-subject shape, explicit type=%s', async (explicit) => {
    const response = await post('admin', { subject_id: 'a', claim: CLAIM, ...(explicit ? { type: 'late_minor' } : {}) });
    expect(response.status).toBe(200);
    const body = await response.json() as { records: { subject: { id: string } }[]; failed: unknown[] };
    expect(body.failed).toEqual([]); expect(body.records.map(record => record.subject.id)).toEqual(['a']);
    expect((await env.DB.prepare('SELECT reporter_id FROM records').first())?.reporter_id).toBe('admin');
  });
  it.each(['single', 'batch'])('still rejects an ordinary participant on the %s path', async (shape) => {
    const response = await post('ordinary', { claim: CLAIM, ...(shape === 'batch' ? { subject_ids: ['a'] } : { subject_id: 'a' }) });
    expect(response.status).toBe(403); expect(await response.json()).toEqual({ error: '需要裁判或管理员权限' });
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM records').first())?.n).toBe(0);
  });
  it('does not bypass the ban on recording oneself for administrators', async () => {
    const response = await post('admin', { subject_id: 'admin', claim: CLAIM });
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: '不能记录自己' });
  });
  it.each(['on_time_bonus', 'organizer_bonus'])('keeps the retired %s HTTP branch disabled for administrators', async (type) => {
    expect((await post('admin', { subject_id: 'a', type })).status).toBe(403);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM records').first())?.n).toBe(0);
  });
});
