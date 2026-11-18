// Review fixes: offline detection, why a session ended, failed-command
// feedback, command flooding limits and the overview's music flag.
import { describe, expect, it } from 'vitest';
import { MUSIC_MAX_QUEUED_COMMANDS } from '../../server/src/music/store';
import {
  base, build, command, community, invite, liveRoom, loginAs, music, occupiedRoom, req, t, tickingClock, useMusicApi,
} from './music-api.helpers';
import { pool } from './cloudflare-test';

useMusicApi();

const staleHeartbeat = (seconds: number) =>
  pool.query(`UPDATE music_runtime SET heartbeat_at = now() - make_interval(secs => $1)`, [seconds]);
const account = (roomRef: string, action: string, user = 'alice') =>
  req(base(roomRef) + '/account', user, { requestKey: 'acct-' + Math.random(), action });

async function invitedRoom() {
  const room = await occupiedRoom();
  expect((await invite(room.ref)).status).toBe(202);
  return { room, session: (await music.sessionForRoom(room.ref))! };
}

describe('music process offline', () => {
  it('refuses commands and account changes with bot_offline once the heartbeat stops', async () => {
    const { room } = await invitedRoom();
    await loginAs('alice');
    await staleHeartbeat(30);
    for (const response of [await command(room.ref, { kind: 'pause' }), await account(room.ref, 'use')]) {
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ code: 'bot_offline', error: '音乐机器人当前离线，请稍后再试' });
    }
    expect((await pool.query('SELECT count(*)::int AS n FROM music_commands')).rows[0].n).toBe(0);
  });

  it('keeps a briefly silent session but ends a long-silent one as offline', async () => {
    const { room, session } = await invitedRoom();
    await staleHeartbeat(30);
    expect((await (await req(base(room.ref))).json()).session).toMatchObject({ ref: session.ref });
    await staleHeartbeat(120);
    const view = await (await req(base(room.ref))).json();
    expect(view).toMatchObject({ session: null, bot: { online: false, busyElsewhere: false }, canInvite: false });
    expect(view.lastEnded).toEqual({ reason: 'offline', endedAt: expect.any(String) });
    expect(await music.session(session.ref)).toMatchObject({ status: 'ended', endReason: 'offline' });
  });

  it('frees the bot for another room once the silent session is ended', async () => {
    const { session } = await invitedRoom();
    await staleHeartbeat(120);
    const other = await liveRoom('隔壁', 'open', t.bob);
    await community.setRoomAccess(other.ref, t.bob, { present: true });
    expect(await (await req(base(other.ref), 'bob')).json()).toMatchObject({ bot: { busyElsewhere: false } });
    expect((await music.session(session.ref))?.status).toBe('ended');
  });

  it('does not end sessions in read-only mode', async () => {
    const { room, session } = await invitedRoom();
    build({ env: { READ_ONLY: '1' } });
    await staleHeartbeat(120);
    expect((await req(base(room.ref))).status).toBe(200);
    expect((await music.session(session.ref))?.status).toBe('requested');
  });
});

describe('why Music left and which command failed', () => {
  it('reports the last ending for five minutes, narrowing unknown reasons', async () => {
    const { room, session } = await invitedRoom();
    await music.endSession(session.ref, 'something_new');
    let view = await (await req(base(room.ref), 'bob')).json();
    expect(view.lastEnded).toEqual({ reason: 'disconnected', endedAt: expect.any(String) });
    await pool.query(`UPDATE music_sessions SET ended_at = now() - interval '6 minutes'`);
    view = await (await req(base(room.ref), 'bob')).json();
    expect(view.lastEnded).toBeNull();
  });

  it('shows no ending while a new session is live in the room', async () => {
    const { room, session } = await invitedRoom();
    await music.endSession(session.ref, 'idle');
    expect((await invite(room.ref, 'alice', { requestKey: 'again' })).status).toBe(202);
    expect((await (await req(base(room.ref))).json()).lastEnded).toBeNull();
  });

  it('shows the caller their own latest failure only, for thirty seconds', async () => {
    const { room, session } = await invitedRoom();
    expect((await command(room.ref, { kind: 'skip' })).status).toBe(202);
    const [queued] = await music.claimCommands(session.ref, 1);
    await music.finishCommand(queued.id, '这首歌暂时无法播放');
    const mine = await (await req(base(room.ref))).json();
    expect(mine.myLastError).toEqual({ id: queued.id, message: '这首歌暂时无法播放' });
    expect((await (await req(base(room.ref), 'bob')).json()).myLastError).toBeNull();
    await pool.query(`UPDATE music_commands SET finished_at = now() - interval '31 seconds'`);
    expect((await (await req(base(room.ref))).json()).myLastError).toBeNull();
  });
});

describe('command flooding', () => {
  it('limits each member to one command per 250 ms', async () => {
    const now = Date.now();
    build({ now: () => now });
    const { room } = await invitedRoom();
    expect((await command(room.ref, { kind: 'pause' })).status).toBe(202);
    const limited = await command(room.ref, { kind: 'play' });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ code: 'rate_limited' });
    expect((await command(room.ref, { kind: 'play' }, 'bob')).status).toBe(202);
  });

  it('refuses new commands while the session already has fifty queued', async () => {
    build({ now: tickingClock() });
    const { room, session } = await invitedRoom();
    await pool.query(
      `INSERT INTO music_commands(session_ref, actor, kind, request_key)
       SELECT $1, $2, 'pause', 'bulk-' || n FROM generate_series(1, $3::int) AS n`,
      [session.ref, t.bob, MUSIC_MAX_QUEUED_COMMANDS],
    );
    const refused = await command(room.ref, { kind: 'skip' });
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ code: 'rate_limited', error: '操作太频繁，请稍后再试' });
    await pool.query(`UPDATE music_commands SET status = 'done', finished_at = now() WHERE request_key = 'bulk-1'`);
    expect((await command(room.ref, { kind: 'skip' })).status).toBe(202);
  });
});

describe('community overview and the generic room actions route', () => {
  it('tells the web whether the music player is offered', async () => {
    expect(await (await req('/api/community')).json()).toMatchObject({ musicEnabled: true });
    build({ music: false });
    expect(await (await req('/api/community')).json()).toMatchObject({ musicEnabled: false });
  });

  it('refuses music_access from members on the generic actions route', async () => {
    const room = await occupiedRoom();
    for (const user of ['alice', 'admin']) {
      const response = await req(`/api/community/rooms/${room.ref}/actions`, user,
        { action: 'music_access', requestKey: 'ma-' + user, expectedVersion: room.version });
      expect(response.status).toBe(400);
    }
    expect(await community.listOperations({ roomRef: room.ref })).toEqual([]);
  });
});
