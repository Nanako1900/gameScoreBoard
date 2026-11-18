import { expect, it, vi } from 'vitest';
import { CommunityStore } from '../../server/src/community/store';
import { forgetMusicAccount } from '../../server/src/music/forget';
import { MusicStore } from '../../server/src/music/store';
import { env as pgEnv, pool } from './cloudflare-test';

const GUILD = '111111111111111111';
const ALICE = '222222222222222221';
const BOB = '222222222222222222';
const community = new CommunityStore(pool, GUILD);
const store = new MusicStore(pool, GUILD);

async function memberWithAccount(external: string): Promise<string> {
  const ref = (await community.upsertResource('member', external, '成员')).ref;
  await store.saveAccount(ref, {
    cookieEncrypted: 'sealed', nickname: '昵称', vip: false, expiresAt: new Date(Date.now() + 86_400_000),
  });
  return ref;
}

it('deletes only the unlinked member\'s saved login', async () => {
  const alice = await memberWithAccount(ALICE);
  const bob = await memberWithAccount(BOB);
  const onError = vi.fn();

  await forgetMusicAccount(pgEnv.DB, ALICE, onError);

  expect(await store.account(alice)).toBeNull();
  expect(await store.account(bob)).not.toBeNull();
  expect(onError).not.toHaveBeenCalled();
});

it('does nothing for a Discord user without a saved login', async () => {
  const bob = await memberWithAccount(BOB);
  const onError = vi.fn();
  await forgetMusicAccount(pgEnv.DB, '333333333333333333', onError);
  expect(await store.account(bob)).not.toBeNull();
  expect(onError).not.toHaveBeenCalled();
});

it('reports a database failure instead of throwing', async () => {
  const onError = vi.fn();
  const broken = { prepare: () => { throw new Error('database down'); } } as unknown as D1Database;
  await expect(forgetMusicAccount(broken, ALICE, onError)).resolves.toBeUndefined();
  expect(onError).toHaveBeenCalledTimes(1);
});
