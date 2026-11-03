import { describe, expect, it } from 'vitest';
import { CommunityStore } from '../../server/src/community/store';
import { pool } from './cloudflare-test';

const GUILD = '111111111111111111';
const store = new CommunityStore(pool, GUILD);
const actor = { source: 'web', userId: 'admin' } as const;

describe('targeted community operation claims', () => {
  it('claims the current entrance operation without consuming an older unrelated operation', async () => {
    const older = await store.enqueue('resources.sync', null, actor, {}, 'older');
    await pool.query("UPDATE community_operations SET created_at=now()-interval '1 second' WHERE ref=$1", [older.ref]);
    const member = await store.upsertResource('member', '222222222222222222', '入口成员');
    const entrance = await store.enqueue('room.create', null, { source: 'discord', memberRef: member.ref }, { creatorOnly: true }, 'entrance');

    expect(await store.claim(30, entrance.ref)).toMatchObject({ ref: entrance.ref, status: 'running', attempts: 1 });
    expect(await store.getOperation(older.ref)).toMatchObject({ status: 'queued', attempts: 0 });
  });

  it('keeps earlier queued, running and deferred retries authoritative within the same room scope', async () => {
    const member = await store.upsertResource('member', '222222222222222222', '房主');
    const room = await store.createRoom(member.ref, '房间');
    const first = await store.enqueue('room.rename', room.ref, actor, { name: '先改名' }, 'first');
    await pool.query("UPDATE community_operations SET created_at=now()-interval '1 second' WHERE ref=$1", [first.ref]);
    const second = await store.enqueue('room.rename', room.ref, actor, { name: '后改名' }, 'second');
    const unrelated = await store.enqueue('resources.sync', null, actor, {}, 'unrelated');

    expect(await store.claim(30, second.ref)).toBeNull();
    const claimed = await store.claim(30, first.ref);
    expect(claimed?.ref).toBe(first.ref);
    expect(await store.claim(30, second.ref)).toBeNull();
    await store.finish(first.ref, claimed!.claimToken!, { status: 'retry_wait', retryAfterSeconds: 3600 });
    expect(await store.claim(30, second.ref)).toBeNull();
    await pool.query("UPDATE community_operations SET available_at=now()-interval '1 second' WHERE ref=$1", [first.ref]);
    const retry = await store.claim(30, first.ref);
    await store.finish(first.ref, retry!.claimToken!, { status: 'succeeded' });
    expect((await store.claim(30, second.ref))?.ref).toBe(second.ref);
    expect(await store.getOperation(unrelated.ref)).toMatchObject({ status: 'queued', attempts: 0 });
  });

  it('keeps an expired executor in review and blocks its later scope until reconciliation', async () => {
    const first = await store.enqueue('resources.sync', null, actor, {}, 'first');
    await pool.query("UPDATE community_operations SET created_at=now()-interval '1 second' WHERE ref=$1", [first.ref]);
    const second = await store.enqueue('resources.sync', null, actor, {}, 'second');
    await store.claim(30, first.ref);
    await pool.query("UPDATE community_operations SET lease_until=now()-interval '1 second' WHERE ref=$1", [first.ref]);

    expect(await store.claim(30, second.ref)).toBeNull();
    expect(await store.getOperation(first.ref)).toMatchObject({ status: 'needs_review', claimToken: null });
    expect(await store.getOperation(second.ref)).toMatchObject({ status: 'queued', attempts: 0 });
    await store.resolveRecoveredOperation(first.ref, {});
    expect((await store.claim(30, second.ref))?.ref).toBe(second.ref);
  });

  it('never substitutes another operation for an invalid, absent or other-guild reference', async () => {
    const queued = await store.enqueue('resources.sync', null, actor, {}, 'local');
    const other = new CommunityStore(pool, '444444444444444444');
    const foreign = await other.enqueue('resources.sync', null, actor, {}, 'foreign');

    for (const ref of ['', 'not-a-ref', '00000000-0000-4000-8000-000000000001', foreign.ref])
      expect(await store.claim(30, ref)).toBeNull();
    expect(await store.getOperation(queued.ref)).toMatchObject({ status: 'queued', attempts: 0 });
    expect(await other.getOperation(foreign.ref)).toMatchObject({ status: 'queued', attempts: 0 });
  });

  it('never substitutes another operation when the target is deferred or already completed', async () => {
    const queued = await store.enqueue('resources.sync', null, actor, {}, 'unrelated');
    const target = await store.enqueue('resources.sync', null, { source: 'web', userId: 'target' }, {}, 'target');
    await pool.query("UPDATE community_operations SET status='retry_wait',available_at=now()+interval '1 hour' WHERE ref=$1", [target.ref]);
    expect(await store.claim(30, target.ref)).toBeNull();
    await pool.query("UPDATE community_operations SET available_at=now()-interval '1 second' WHERE ref=$1", [target.ref]);
    const claimed = await store.claim(30, target.ref);
    expect(claimed?.ref).toBe(target.ref);
    expect(await store.claim(30, target.ref)).toBeNull();
    await store.finish(target.ref, claimed!.claimToken!, { status: 'succeeded' });
    expect(await store.claim(30, target.ref)).toBeNull();
    expect(await store.getOperation(queued.ref)).toMatchObject({ status: 'queued', attempts: 0 });
  });

  it('cancels expired and retired targets without consuming unrelated work', async () => {
    const queued = await store.enqueue('resources.sync', null, actor, {}, 'unrelated');
    const expired = await store.enqueue('resources.sync', null, { source: 'web', userId: 'expired' }, {}, 'expired');
    const retired = await store.enqueue('fun.create', null, { source: 'web', userId: 'retired' }, {}, 'retired');
    await pool.query("UPDATE community_operations SET expires_at=now()-interval '1 second' WHERE ref=$1", [expired.ref]);

    expect(await store.claim(30, expired.ref)).toBeNull();
    expect(await store.claim(30, retired.ref)).toBeNull();
    expect(await store.getOperation(expired.ref)).toMatchObject({ status: 'canceled', errorCode: 'operation_expired', attempts: 0 });
    expect(await store.getOperation(retired.ref)).toMatchObject({ status: 'canceled', errorCode: 'feature_retired', attempts: 0 });
    expect(await store.getOperation(queued.ref)).toMatchObject({ status: 'queued', attempts: 0 });
  });

  it('grants only one execution lease to concurrent claimers targeting the same operation', async () => {
    const target = await store.enqueue('resources.sync', null, actor, {}, 'target');
    const claims = await Promise.all([store.claim(30, target.ref), store.claim(30, target.ref)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.find(Boolean)).toMatchObject({ ref: target.ref, attempts: 1 });
    expect(await store.getOperation(target.ref)).toMatchObject({ status: 'running', attempts: 1 });
  });

  it('does not let concurrent targeted claimers overtake the earlier operation in one scope', async () => {
    const first = await store.enqueue('resources.sync', null, actor, {}, 'first');
    await pool.query("UPDATE community_operations SET created_at=now()-interval '1 second' WHERE ref=$1", [first.ref]);
    const second = await store.enqueue('resources.sync', null, actor, {}, 'second');
    const claims = await Promise.all([store.claim(30, second.ref), store.claim(30, first.ref)]);

    expect(claims[0]).toBeNull();
    expect(claims[1]).toMatchObject({ ref: first.ref, attempts: 1 });
    expect(await store.getOperation(second.ref)).toMatchObject({ status: 'queued', attempts: 0 });
  });
});
