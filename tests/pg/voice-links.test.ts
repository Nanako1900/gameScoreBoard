import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { linkAccounts, unlinkAccounts } from '../../server/src/discord/links';
import { seedUser } from '../worker/helpers';
import { env, pool } from './cloudflare-test';
const OLD = '300000000000000001'; const NEXT = '300000000000000002';
async function bind(userId = 'owner', discordUserId = OLD) {
  return linkAccounts(env.DB, { userId, discordUserId, discordUsername: '玩家', replace: true, via: 'web' });
}
async function open(userId = 'owner', discord = OLD) {
  await pool.query(`INSERT INTO voice_sessions (user_id, discord_user_id, channel_id, channel_name, joined_at, start_reason)
    VALUES ($1, $2, 'voice-channel', '开黑一号', datetime('now', '-1 hour'), 'joined')`, [userId, discord]);
}
async function rows() { return (await pool.query('SELECT user_id, discord_user_id, joined_at, left_at, end_reason FROM voice_sessions ORDER BY id')).rows; }
function racingDb(before: () => Promise<void>): D1Database {
  return { prepare: (sql: string) => env.DB.prepare(sql), batch: async (statements: D1PreparedStatement[]) => {
    await before(); return env.DB.batch(statements);
  } } as unknown as D1Database;
}
describe('voice bindings and PG migration', () => {
  it('closes open evidence in the same unlink batch', async () => {
    await seedUser({ id: 'owner' }); await bind(); await open();
    expect(await unlinkAccounts(env.DB, { userId: 'owner' }, 'web')).not.toBeNull();
    const [row] = await rows(); expect(row.end_reason).toBe('unlinked'); expect(row.left_at >= row.joined_at).toBe(true);
  });
  it('closes only the replaced Discord account on relink', async () => {
    await seedUser({ id: 'owner' }); await bind(); await open();
    expect((await bind('owner', NEXT)).kind).toBe('relinked'); await open('owner', NEXT);
    expect((await rows()).map((row) => [row.discord_user_id, row.end_reason])).toEqual([[OLD, 'unlinked'], [NEXT, null]]);
  });
  it.each(['unlink', 'relink'])('does not write an end before a join newer than the transaction timestamp: %s', async (action) => {
    await seedUser({ id: 'owner' }); await bind(); await open();
    // Models a waiting transaction whose stable now() predates the opener.
    await pool.query("UPDATE voice_sessions SET joined_at = datetime('now', '+1 second')");
    if (action === 'unlink') await unlinkAccounts(env.DB, { userId: 'owner' }, 'web');
    else await bind('owner', NEXT);
    const [row] = await rows(); expect(row.end_reason).toBe('unlinked'); expect(row.left_at).toBe(row.joined_at);
  });
  it('does not close a new owner segment when an old unlink snapshot loses a race', async () => {
    await seedUser({ id: 'owner' }); await seedUser({ id: 'other' }); await bind(); await open();
    const db = racingDb(async () => { await unlinkAccounts(env.DB, { userId: 'owner' }, 'web'); await bind('other', OLD); await open('other', OLD); });
    expect(await unlinkAccounts(db, { userId: 'owner' }, 'web')).toBeNull();
    expect((await rows()).map((row) => [row.user_id, row.end_reason])).toEqual([['owner', 'unlinked'], ['other', null]]);
  });
  it('rolls evidence closure back when a concurrent replacement wins', async () => {
    await seedUser({ id: 'owner' }); await seedUser({ id: 'other' }); await bind(); await open();
    const db = racingDb(async () => { await bind('other', NEXT); });
    expect((await linkAccounts(db, { userId: 'owner', discordUserId: NEXT, discordUsername: '玩家', replace: true, via: 'web' })).kind).toBe('taken');
    expect((await rows())[0]).toMatchObject({ discord_user_id: OLD, left_at: null, end_reason: null });
    expect((await pool.query("SELECT discord_user_id FROM discord_links WHERE user_id = 'owner'")).rows[0].discord_user_id).toBe(OLD);
  });
  it('can reapply the PG migration twice without changing evidence', async () => {
    const sql = readFileSync(new URL('../../server/migrations/0010_voice.sql', import.meta.url), 'utf8');
    await pool.query(sql); await seedUser({ id: 'owner' }); await bind(); await open();
    await pool.query(sql); await pool.query(sql); expect(await rows()).toHaveLength(1);
  });
});
