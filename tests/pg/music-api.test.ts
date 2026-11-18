import { describe, expect, it } from 'vitest';
import {
  base, build, command, community, invite, liveRoom, loginAs, music, MUSIC_BOT, occupiedRoom, req, t, tickingClock, track,
  useMusicApi,
} from './music-api.helpers';
import { pool } from './cloudflare-test';

useMusicApi();

describe('music API authentication and visibility', () => {
  it('requires a session, then a linked available member', async () => {
    const room = await occupiedRoom();
    expect((await req(base(room.ref), null)).status).toBe(401);
    const unlinked = await req(base(room.ref), 'carol');
    expect(unlinked.status).toBe(403);
    expect(await unlinked.json()).toMatchObject({ code: 'membership_required' });
    expect((await req('/api/community/music/search?q=x', 'carol')).status).toBe(403);
  });

  it('answers hidden and missing rooms with the same 404 body', async () => {
    const hidden = await occupiedRoom('秘密房', 'hidden');
    const hiddenResponse = await req(base(hidden.ref), 'bob');
    const missingResponse = await req(base('00000000-0000-4000-8000-000000000000'), 'bob');
    expect(hiddenResponse.status).toBe(404);
    expect(missingResponse.status).toBe(404);
    expect(await hiddenResponse.json()).toEqual(await missingResponse.json());
    expect((await req(base('not-a-ref'), 'bob')).status).toBe(404);
    expect((await invite(hidden.ref, 'bob')).status).toBe(404);
    expect((await req(base(hidden.ref), 'admin')).status).toBe(200);
  });

  it('answers every music path 404 when the feature is disabled', async () => {
    build({ music: false });
    const room = await occupiedRoom();
    expect((await req(base(room.ref))).status).toBe(404);
    expect((await req('/api/community/music/search?q=x')).status).toBe(404);
    expect((await req('/api/admin/community/music/proxy', 'admin')).status).toBe(404);
  });
});

describe('music view and invitations', () => {
  it('reports offline, empty rooms and an invitable room', async () => {
    const room = await liveRoom();
    let view = await (await req(base(room.ref))).json();
    expect(view).toMatchObject({
      room: { ref: room.ref, name: '朋友房' }, bot: { online: true, busyElsewhere: false },
      session: null, myAccount: null, loginAvailable: true, canInvite: false,
    });
    expect(view.inviteBlocked).toEqual(expect.any(String));
    expect((await invite(room.ref)).status).toBe(409);

    await community.setRoomAccess(room.ref, t.alice, { present: true });
    view = await (await req(base(room.ref))).json();
    expect(view).toEqual({
      room: { ref: room.ref, name: '朋友房' }, bot: { online: true, busyElsewhere: false }, session: null,
      myAccount: null, loginAvailable: true, canInvite: true, inviteBlocked: null,
      serverNow: expect.any(String), lastEnded: null, myLastError: null,
    });
    expect(Math.abs(Date.parse(view.serverNow) - Date.now())).toBeLessThan(60_000);

    await pool.query('TRUNCATE music_runtime');
    view = await (await req(base(room.ref))).json();
    expect(view).toMatchObject({ bot: { online: false }, canInvite: false });
    expect((await invite(room.ref)).status).toBe(409);
    expect(await music.activeSession()).toBeNull();
  });

  it('does not count bot members as people in the room', async () => {
    const room = await liveRoom();
    const bot = await community.upsertResource('member', MUSIC_BOT, 'Music', { available: true, metadata: { bot: true } });
    await community.setRoomAccess(room.ref, bot.ref, { present: true });
    expect(await (await req(base(room.ref))).json()).toMatchObject({ canInvite: false });
  });

  it('creates one session, asks for room access and stays idempotent', async () => {
    const room = await occupiedRoom();
    const first = await invite(room.ref);
    expect(first.status).toBe(202);
    const view = await first.json();
    expect(view).toMatchObject({ session: { status: 'requested', version: 0, account: null }, canInvite: false });
    expect(t.roomAccessCalls).toEqual([[t.alice, room.ref, 'invite-alice']]);
    expect((await invite(room.ref)).status).toBe(202);
    const sessions = await pool.query('SELECT count(*)::int AS n FROM music_sessions');
    expect(sessions.rows[0].n).toBe(1);
  });

  it('keeps the invite when the room access request fails', async () => {
    build({ requestRoomAccess: async () => { throw new Error('bot down'); } });
    const room = await occupiedRoom();
    expect((await invite(room.ref)).status).toBe(202);
    expect(t.errors).toHaveLength(1);
  });

  it('shows busy elsewhere without anything about the other room', async () => {
    const other = await occupiedRoom('隔壁的秘密房', 'hidden');
    await music.createSession(other.ref, t.alice, null);
    const room = await liveRoom('大厅', 'open', t.bob);
    await community.setRoomAccess(room.ref, t.bob, { present: true });
    const response = await req(base(room.ref), 'bob');
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ bot: { busyElsewhere: true }, session: null, canInvite: false });
    expect(text).not.toContain(other.ref);
    expect(text).not.toContain('隔壁的秘密房');
    const refused = await invite(room.ref, 'bob');
    expect(refused.status).toBe(409);
    const refusedText = await refused.text();
    expect(JSON.parse(refusedText)).toMatchObject({ code: 'music_busy' });
    expect(refusedText).not.toContain(other.ref);
    expect(refusedText).not.toContain('隔壁的秘密房');
  });

  it('refuses invites in read-only mode', async () => {
    build({ env: { READ_ONLY: '1' } });
    const room = await occupiedRoom();
    expect((await invite(room.ref)).status).toBe(503);
    expect((await req(base(room.ref))).status).toBe(200);
  });

  it('never exposes cookies or Discord ids in the view', async () => {
    const room = await occupiedRoom();
    expect((await loginAs('alice')).status).toBe(200);
    expect((await invite(room.ref, 'alice', { useMyAccount: true })).status).toBe(202);
    for (const user of ['alice', 'bob', 'admin']) {
      const text = await (await req(base(room.ref), user)).text();
      expect(text).not.toContain('MUSIC_U');
      expect(text).not.toContain('supersecretcookievalue');
      expect(text).not.toMatch(/cookie/i);
      expect(text).not.toMatch(/\b\d{17,20}\b/);
    }
    const mine = await (await req(base(room.ref), 'alice')).json();
    expect(mine.session.account).toEqual({ nickname: '小明', vip: true, mine: true, canStop: true });
    const theirs = await (await req(base(room.ref), 'bob')).json();
    expect(theirs.session.account).toEqual({ nickname: '小明', vip: true, mine: false, canStop: false });
    expect(theirs.myAccount).toBeNull();
    const admin = await (await req(base(room.ref), 'admin')).json();
    expect(admin.session.account).toEqual({ nickname: '小明', vip: true, mine: false, canStop: true });
  });
});

describe('music commands', () => {
  it('refuses commands without a live session in this room', async () => {
    const room = await occupiedRoom();
    const response = await command(room.ref, { kind: 'pause' });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'session_ended' });
  });

  it('accepts whitelisted commands with valid payloads and stores them idempotently', async () => {
    build({ now: tickingClock() });
    const room = await occupiedRoom();
    await invite(room.ref);
    const ok = [
      { kind: 'enqueue', tracks: [track(1), track(2)] }, { kind: 'remove', key: 'k1' }, { kind: 'move_next', key: 'k1' },
      { kind: 'clear' }, { kind: 'play' }, { kind: 'pause' }, { kind: 'skip' }, { kind: 'seek', positionMs: 1000 },
      { kind: 'volume', volume: 0 }, { kind: 'volume', volume: 100 }, { kind: 'mode', mode: 'shuffle' }, { kind: 'leave' },
    ];
    for (const body of ok) {
      const response = await command(room.ref, body, 'bob');
      expect(response.status, JSON.stringify(body)).toBe(202);
      expect(await response.json()).toEqual({ accepted: true });
    }
    const same = { requestKey: 'same', kind: 'pause' };
    expect((await req(base(room.ref) + '/commands', 'alice', same)).status).toBe(202);
    expect((await req(base(room.ref) + '/commands', 'alice', same)).status).toBe(202);
    const count = await pool.query('SELECT count(*)::int AS n FROM music_commands');
    expect(count.rows[0].n).toBe(ok.length + 1);
    const stored = await pool.query(`SELECT actor, payload FROM music_commands WHERE kind='enqueue'`);
    expect(stored.rows[0]).toMatchObject({ actor: t.bob, payload: { tracks: [track(1), track(2)] } });
  });

  it('rejects unknown kinds, unknown fields and out-of-range payloads', async () => {
    build({ now: tickingClock() });
    const room = await occupiedRoom();
    await invite(room.ref);
    const bad = [
      { kind: 'explode' }, { kind: 'pause', extra: 1 }, { kind: 'volume', volume: 101 }, { kind: 'volume', volume: -1 },
      { kind: 'volume', volume: 1.5 }, { kind: 'volume' }, { kind: 'seek', positionMs: -1 }, { kind: 'mode', mode: 'party' },
      { kind: 'remove' }, { kind: 'remove', key: '' }, { kind: 'move_next', key: 'x'.repeat(201) },
      { kind: 'enqueue', tracks: [] }, { kind: 'enqueue', tracks: Array.from({ length: 201 }, (_, i) => track(i + 1)) },
      { kind: 'enqueue', tracks: [{ ...track(1), id: '123' }] }, { kind: 'enqueue', tracks: [{ ...track(1), secret: 'x' }] },
      { kind: 'enqueue', tracks: [{ ...track(1), coverUrl: 'http://insecure.example/a.jpg' }] },
      { kind: 'clear', tracks: [] }, {},
    ];
    for (const body of bad) {
      const response = await command(room.ref, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    const count = await pool.query('SELECT count(*)::int AS n FROM music_commands');
    expect(count.rows[0].n).toBe(0);
    expect((await req(base(room.ref) + '/commands', 'alice', { kind: 'pause' })).status).toBe(400);
  });
});
