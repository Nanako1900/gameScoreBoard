import { beforeEach, describe, expect, it } from 'vitest';
import { defaultMusicState, type MusicState } from '../../shared/music';
import { CommunityStore } from '../../server/src/community/store';
import { MusicStore } from '../../server/src/music/store';
import { pool } from './cloudflare-test';

const GUILD = '111111111111111111';
const OTHER_GUILD = '999999999999999999';
const community = new CommunityStore(pool, GUILD);
const store = new MusicStore(pool, GUILD);

beforeEach(async () => {
  await pool.query('TRUNCATE music_runtime');
});

async function member(external: string): Promise<string> {
  return (await community.upsertResource('member', external, '成员')).ref;
}

async function newRoom(owner: string, name = '房间'): Promise<string> {
  return (await community.createRoom(owner, name)).ref;
}

async function fixture() {
  const alice = await member('222222222222222221');
  const bob = await member('222222222222222222');
  const room = await newRoom(alice);
  return { alice, bob, room };
}

const future = () => new Date(Date.now() + 86_400_000);

describe('music sessions', () => {
  it('rejects a second live session and allows one again after the first ends', async () => {
    const { alice, bob, room } = await fixture();
    const room2 = await newRoom(bob, '房间二');
    const first = await store.createSession(room, alice, null);
    expect(first).toMatchObject({ status: 'requested', version: 0, roomRef: room, accountOwner: null });
    expect(first.state).toEqual(defaultMusicState());
    await expect(store.createSession(room2, alice, null)).rejects.toMatchObject({ status: 409, code: 'music_busy' });
    expect(await store.endSession(first.ref, 'leave')).toBe(true);
    await expect(store.createSession(room2, alice, null)).resolves.toMatchObject({ roomRef: room2 });
  });

  it('finds the live session by guild and by room, never an ended one', async () => {
    const { alice, room } = await fixture();
    expect(await store.activeSession()).toBeNull();
    const created = await store.createSession(room, alice, null);
    expect((await store.activeSession())?.ref).toBe(created.ref);
    expect((await store.sessionForRoom(room))?.ref).toBe(created.ref);
    expect((await store.session(created.ref))?.ref).toBe(created.ref);
    await store.endSession(created.ref, 'leave');
    expect(await store.activeSession()).toBeNull();
    expect(await store.sessionForRoom(room)).toBeNull();
    expect((await store.session(created.ref))?.status).toBe('ended');
  });

  it('moves status only forward and returns null once ended', async () => {
    const { alice, room } = await fixture();
    const created = await store.createSession(room, alice, null);
    expect((await store.setStatus(created.ref, 'connecting'))?.status).toBe('connecting');
    expect((await store.setStatus(created.ref, 'active'))?.status).toBe('active');
    expect((await store.setStatus(created.ref, 'connecting'))?.status).toBe('active');
    await store.endSession(created.ref, 'leave');
    expect(await store.setStatus(created.ref, 'active')).toBeNull();
  });

  it('saves state optimistically and rejects stale versions and ended sessions', async () => {
    const { alice, room } = await fixture();
    const created = await store.createSession(room, alice, null);
    const state: MusicState = { ...defaultMusicState(), volume: 40, notice: '你好' };
    const saved = await store.saveState(created.ref, state, 0);
    expect(saved.version).toBe(1);
    expect(saved.state).toEqual(state);
    await expect(store.saveState(created.ref, state, 0)).rejects.toMatchObject({ status: 409, code: 'version_conflict' });
    await store.endSession(created.ref, 'leave');
    await expect(store.saveState(created.ref, state, 1)).rejects.toMatchObject({ status: 409, code: 'version_conflict' });
  });

  it('falls back to the default state when stored JSON is malformed', async () => {
    const { alice, room } = await fixture();
    const created = await store.createSession(room, alice, null);
    await pool.query(`UPDATE music_sessions SET state='{"mode":"bogus","queue":5}' WHERE ref=$1`, [created.ref]);
    expect((await store.session(created.ref))?.state).toEqual(defaultMusicState());
  });

  it('sets the account owner with a version bump and refuses ended sessions', async () => {
    const { alice, room } = await fixture();
    const created = await store.createSession(room, alice, null);
    const updated = await store.setAccountOwner(created.ref, alice);
    expect(updated).toMatchObject({ accountOwner: alice, version: 1 });
    expect(await store.setAccountOwner(created.ref, null)).toMatchObject({ accountOwner: null, version: 2 });
    await store.endSession(created.ref, 'leave');
    await expect(store.setAccountOwner(created.ref, alice)).rejects.toMatchObject({ status: 409, code: 'session_ended' });
  });

  it('ends idempotently, fails pending commands and clears the account owner', async () => {
    const { alice, room } = await fixture();
    const created = await store.createSession(room, alice, alice);
    const command = await store.addCommand(created.ref, alice, 'pause', {}, 'k1');
    expect(await store.endSession(created.ref, 'empty')).toBe(true);
    expect(await store.endSession(created.ref, 'empty')).toBe(false);
    const ended = await store.session(created.ref);
    expect(ended).toMatchObject({ status: 'ended', endReason: 'empty', accountOwner: null });
    expect(ended?.endedAt).not.toBeNull();
    const row = (await pool.query('SELECT status,error FROM music_commands WHERE id=$1', [command.id])).rows[0];
    expect(row.status).toBe('failed');
    expect(row.error).toBeTruthy();
  });
});

describe('music commands', () => {
  it('is idempotent per actor and request key', async () => {
    const { alice, bob, room } = await fixture();
    const created = await store.createSession(room, alice, null);
    const first = await store.addCommand(created.ref, alice, 'pause', {}, 'same');
    const again = await store.addCommand(created.ref, alice, 'pause', {}, 'same');
    const other = await store.addCommand(created.ref, bob, 'pause', {}, 'same');
    expect(first.created).toBe(true);
    expect(again).toEqual({ id: first.id, created: false });
    expect(other.created).toBe(true);
    expect(other.id).not.toBe(first.id);
    expect(typeof first.id).toBe('string');
  });

  it('refuses commands for an ended session', async () => {
    const { alice, room } = await fixture();
    const created = await store.createSession(room, alice, null);
    await store.endSession(created.ref, 'leave');
    await expect(store.addCommand(created.ref, alice, 'pause', {}, 'k')).rejects.toMatchObject({ status: 409, code: 'session_ended' });
  });

  it('claims queued commands in order and does not re-claim finished ones', async () => {
    const { alice, room } = await fixture();
    const created = await store.createSession(room, alice, null);
    const a = await store.addCommand(created.ref, alice, 'enqueue', { track: 1 }, 'a');
    const b = await store.addCommand(created.ref, alice, 'skip', {}, 'b');
    const c = await store.addCommand(created.ref, alice, 'pause', {}, 'c');
    const firstTwo = await store.claimCommands(created.ref, 2);
    expect(firstTwo.map((x) => x.id)).toEqual([a.id, b.id]);
    expect(firstTwo[0]).toMatchObject({ kind: 'enqueue', payload: { track: 1 }, actor: alice, requestKey: 'a' });
    await store.finishCommand(a.id, null);
    await store.finishCommand(b.id, '失败');
    expect((await store.claimCommands(created.ref, 10)).map((x) => x.id)).toEqual([c.id]);
    const rows = (await pool.query('SELECT id,status,error FROM music_commands ORDER BY id')).rows;
    expect(rows.map((r) => r.status)).toEqual(['done', 'failed', 'queued']);
    expect(rows[1].error).toBe('失败');
  });
});

describe('music accounts', () => {
  const input = (expiresAt: Date) => ({ cookieEncrypted: 'v1.cipher', nickname: '昵称', vip: true, expiresAt });

  it('round trips an account, upserts, and hides an expired one', async () => {
    const { alice } = await fixture();
    await store.saveAccount(alice, input(future()));
    expect(await store.account(alice)).toMatchObject({ memberRef: alice, cookieEncrypted: 'v1.cipher', nickname: '昵称', vip: true });
    await store.saveAccount(alice, { ...input(future()), nickname: '新昵称' });
    expect((await store.account(alice))?.nickname).toBe('新昵称');
    await store.saveAccount(alice, input(new Date(Date.now() - 1000)));
    expect(await store.account(alice)).toBeNull();
  });

  it('detaches a deleted account from the live session and bumps its version', async () => {
    const { alice, room } = await fixture();
    await store.saveAccount(alice, input(future()));
    const created = await store.createSession(room, alice, alice);
    await store.deleteAccount(alice);
    expect(await store.account(alice)).toBeNull();
    expect(await store.session(created.ref)).toMatchObject({ accountOwner: null, version: 1 });
  });

  it('purges expired accounts and sessions ended over seven days ago', async () => {
    const { alice, bob, room } = await fixture();
    const room2 = await newRoom(bob, '房间二');
    await store.saveAccount(alice, input(new Date(Date.now() - 1000)));
    await store.saveAccount(bob, input(future()));
    const oldSession = await store.createSession(room2, bob, null);
    await store.endSession(oldSession.ref, 'x');
    await pool.query(`UPDATE music_sessions SET ended_at=now()-interval '8 days' WHERE ref=$1`, [oldSession.ref]);
    const recent = await store.createSession(room2, bob, null);
    await store.endSession(recent.ref, 'x');
    const live = await store.createSession(room, alice, alice);

    await store.purgeExpired();

    expect((await pool.query('SELECT member_ref FROM music_accounts')).rows.map((r) => r.member_ref)).toEqual([bob]);
    expect(await store.session(oldSession.ref)).toBeNull();
    expect(await store.session(recent.ref)).not.toBeNull();
    expect(await store.session(live.ref)).toMatchObject({ accountOwner: null, version: 1 });
  });
});

describe('music runtime and guild isolation', () => {
  it('reports online only while the heartbeat is fresh', async () => {
    expect(await store.online(60_000)).toBe(false);
    await store.heartbeat();
    expect(await store.online(60_000)).toBe(true);
    await pool.query(`UPDATE music_runtime SET heartbeat_at=now()-interval '10 seconds' WHERE guild_id=$1`, [GUILD]);
    expect(await store.online(5_000)).toBe(false);
    expect(await store.online(60_000)).toBe(true);
  });

  it('cannot see or change rows of another guild', async () => {
    const { alice, room } = await fixture();
    const other = new MusicStore(pool, OTHER_GUILD);
    const created = await store.createSession(room, alice, alice);
    await store.saveAccount(alice, { cookieEncrypted: 'c', nickname: 'n', vip: false, expiresAt: future() });
    const command = await store.addCommand(created.ref, alice, 'pause', {}, 'k');
    await store.heartbeat();

    expect(await other.activeSession()).toBeNull();
    expect(await other.session(created.ref)).toBeNull();
    expect(await other.sessionForRoom(room)).toBeNull();
    expect(await other.account(alice)).toBeNull();
    expect(await other.online(60_000)).toBe(false);
    expect(await other.setStatus(created.ref, 'active')).toBeNull();
    expect(await other.endSession(created.ref, 'x')).toBe(false);
    expect(await other.claimCommands(created.ref, 10)).toEqual([]);
    await other.finishCommand(command.id, null);
    await other.deleteAccount(alice);
    await expect(other.saveState(created.ref, defaultMusicState(), 0)).rejects.toMatchObject({ code: 'version_conflict' });
    await expect(other.addCommand(created.ref, alice, 'pause', {}, 'z')).rejects.toMatchObject({ code: 'session_ended' });

    expect(await store.account(alice)).not.toBeNull();
    expect((await store.session(created.ref))?.status).toBe('requested');
    expect(await store.claimCommands(created.ref, 10)).toHaveLength(1);
  });
});

describe('music review fixes', () => {
  const age = (table: string, column: string, seconds: number) =>
    pool.query(`UPDATE ${table} SET ${column}=now()-make_interval(secs => $1)`, [seconds]);

  it('ends a live session as offline only while the heartbeat is stale', async () => {
    const { alice, room } = await fixture();
    const created = await store.createSession(room, alice, alice);
    const command = await store.addCommand(created.ref, alice, 'pause', {}, 'k');
    await store.heartbeat();
    expect(await store.endStaleSession(created.ref, 90_000)).toBe(false);
    await age('music_runtime', 'heartbeat_at', 120);
    expect(await new MusicStore(pool, OTHER_GUILD).endStaleSession(created.ref, 90_000)).toBe(false);
    expect(await store.endStaleSession(created.ref, 90_000)).toBe(true);
    expect(await store.endStaleSession(created.ref, 90_000)).toBe(false);
    expect(await store.session(created.ref)).toMatchObject({ status: 'ended', endReason: 'offline', accountOwner: null });
    expect((await pool.query('SELECT status FROM music_commands WHERE id=$1', [command.id])).rows[0].status).toBe('failed');
  });

  it('treats a missing heartbeat row as stale', async () => {
    const { alice, room } = await fixture();
    const created = await store.createSession(room, alice, null);
    expect(await store.endStaleSession(created.ref, 90_000)).toBe(true);
  });

  it('reports the room’s most recent ending inside the window only', async () => {
    const { alice, room } = await fixture();
    expect(await store.lastEnded(room, 300_000)).toBeNull();
    const first = await store.createSession(room, alice, null);
    await store.endSession(first.ref, 'idle');
    await age('music_sessions', 'ended_at', 60);
    const second = await store.createSession(room, alice, null);
    await store.endSession(second.ref, 'empty');
    const last = await store.lastEnded(room, 300_000);
    expect(last).toEqual({ reason: 'empty', endedAt: expect.any(String) });
    expect(Math.abs(Date.parse(last!.endedAt) - Date.now())).toBeLessThan(60_000);
    expect(await new MusicStore(pool, OTHER_GUILD).lastEnded(room, 300_000)).toBeNull();
    await age('music_sessions', 'ended_at', 400);
    expect(await store.lastEnded(room, 300_000)).toBeNull();
  });

  it('reports the actor’s latest failed command inside the window only', async () => {
    const { alice, bob, room } = await fixture();
    const created = await store.createSession(room, alice, null);
    const a = await store.addCommand(created.ref, alice, 'pause', {}, 'a');
    const b = await store.addCommand(created.ref, alice, 'skip', {}, 'b');
    const c = await store.addCommand(created.ref, bob, 'skip', {}, 'c');
    expect(await store.lastFailedCommand(created.ref, alice, 30_000)).toBeNull();
    await store.finishCommand(a.id, '第一次失败');
    await store.finishCommand(b.id, '第二次失败');
    await store.finishCommand(c.id, null);
    expect(await store.lastFailedCommand(created.ref, alice, 30_000)).toEqual({ id: b.id, error: '第二次失败' });
    expect(await store.lastFailedCommand(created.ref, bob, 30_000)).toBeNull();
    expect(await new MusicStore(pool, OTHER_GUILD).lastFailedCommand(created.ref, alice, 30_000)).toBeNull();
    await age('music_commands', 'finished_at', 60);
    expect(await store.lastFailedCommand(created.ref, alice, 30_000)).toBeNull();
  });

  it('caps queued commands per session but still answers replays', async () => {
    const { alice, room } = await fixture();
    const created = await store.createSession(room, alice, null);
    const first = await store.addCommand(created.ref, alice, 'pause', {}, 'a', 2);
    await store.addCommand(created.ref, alice, 'play', {}, 'b', 2);
    await expect(store.addCommand(created.ref, alice, 'skip', {}, 'c', 2)).rejects.toMatchObject({ status: 429, code: 'rate_limited' });
    expect(await store.addCommand(created.ref, alice, 'pause', {}, 'a', 2)).toEqual({ id: first.id, created: false });
    await store.finishCommand(first.id, null);
    await expect(store.addCommand(created.ref, alice, 'skip', {}, 'c', 2)).resolves.toMatchObject({ created: true });
    await store.endSession(created.ref, 'left');
    await expect(store.addCommand(created.ref, alice, 'skip', {}, 'd', 2)).rejects.toMatchObject({ code: 'session_ended' });
  });

  it('fails a stored command of an unknown kind instead of treating it as leave', async () => {
    const { alice, room } = await fixture();
    const created = await store.createSession(room, alice, null);
    const a = await store.addCommand(created.ref, alice, 'pause', {}, 'a');
    const unknown = (await pool.query(
      `INSERT INTO music_commands(session_ref, actor, kind, request_key) VALUES ($1, $2, 'explode', 'x') RETURNING id`,
      [created.ref, alice],
    )).rows[0].id;
    const b = await store.addCommand(created.ref, alice, 'skip', {}, 'b');
    expect((await store.claimCommands(created.ref, 10)).map((command) => command.kind)).toEqual(['pause', 'skip']);
    expect((await store.claimCommands(created.ref, 10)).map((command) => command.id)).toEqual([a.id, b.id]);
    const row = (await pool.query('SELECT status, error FROM music_commands WHERE id=$1', [unknown])).rows[0];
    expect(row).toEqual({ status: 'failed', error: expect.any(String) });
    expect((await store.session(created.ref))?.status).toBe('requested');
  });
});
