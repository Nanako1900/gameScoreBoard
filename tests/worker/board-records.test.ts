import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { listRecords } from '../../worker/case-reads';
import { seedUser } from './helpers';

beforeEach(async () => { await seedUser({ id: 'subject' }); await seedUser({ id: 'judge', judge: true }); });
async function add(id: number, type: string, status = 'decided', delta = -3, at = '2026-10-20 12:00:00') {
  await env.DB.prepare('INSERT INTO records (id, subject_id, reporter_id, type, delta, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, 'subject', 'judge', type, delta, status, at).run();
}

describe('penalty-only record query shared by D1 and PostgreSQL', () => {
  it('filters before LIMIT so more than twenty-one newer bonuses cannot hide five penalties', async () => {
    for (let i = 1; i <= 5; i += 1) await add(i, 'late_minor');
    for (let i = 6; i <= 31; i += 1) await add(i, i % 2 ? 'on_time_bonus' : 'organizer_bonus');
    const records = await listRecords(env.DB, { status: 'decided', penaltyOnly: true, limit: 5 });
    expect(records.map((record) => record.id)).toEqual([5, 4, 3, 2, 1]);
  });
  it('keeps zero-delta penalties and the existing decided status semantics', async () => {
    await add(1, 'other', 'decided', 0);
    for (const [index, status] of ['awaiting_statement', 'judging', 'appealed', 'revoked', 'withdrawn'].entries()) await add(index + 2, 'no_show', status);
    const records = await listRecords(env.DB, { status: 'decided', penaltyOnly: true, limit: 5 });
    expect(records.map((record) => [record.id, record.delta])).toEqual([[1, 0]]);
  });
  it('retains created_at descending and then id descending after filtering', async () => {
    await add(3, 'late_minor', 'decided', -3, '2026-10-19 12:00:00');
    await add(1, 'late_minor'); await add(2, 'late_minor');
    expect((await listRecords(env.DB, { status: 'decided', penaltyOnly: true, limit: 5 })).map((record) => record.id)).toEqual([2, 1, 3]);
  });
  it('does not change existing callers that request historical bonuses', async () => {
    await add(1, 'on_time_bonus', 'decided', 2);
    expect((await listRecords(env.DB, { status: 'decided', limit: 5 })).map((record) => [record.type, record.delta])).toEqual([['on_time_bonus', 2]]);
  });
});
