import { describe, expect, it, vi } from 'vitest';
import { createCommunityRoutes } from '../../server/src/community/routes';
import { createProxiedNetease } from '../../server/src/music/outbound';
import { saveMusicProxy } from '../../server/src/music/proxy';
import { MUSIC_ACCOUNT_DAYS } from '../../shared/music';
import {
  base, build, community, environment, fakeClient, invite, loginAs, MASTER_KEY, music, occupiedRoom, OTHER_KEY, req, t,
  track, useMusicApi,
} from './music-api.helpers';
import { env as pgEnv, pool } from './cloudflare-test';

const DAY_MS = 86_400_000;

useMusicApi();

describe('music accounts', () => {
  it('saves the account for about thirty days after a confirmed QR login', async () => {
    const response = await loginAs('alice');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ status: 'done', account: { nickname: '小明', vip: true } });
    const expires = Date.parse(body.account.expiresAt);
    expect(Math.abs(expires - (Date.now() + MUSIC_ACCOUNT_DAYS * DAY_MS))).toBeLessThan(60_000);
    const stored = await music.account(t.alice);
    expect(stored).toMatchObject({ nickname: '小明', vip: true });
    expect(stored?.cookieEncrypted).not.toContain('supersecretcookievalue');
    expect(JSON.stringify(body)).not.toMatch(/MUSIC_U|supersecret|cookie/i);
  });

  it('treats a login the account check cannot confirm as expired and saves nothing', async () => {
    t.client = fakeClient({ account: vi.fn(async () => null) });
    const response = await loginAs('alice');
    expect(await response.json()).toEqual({ status: 'expired' });
    expect(await music.account(t.alice)).toBeNull();
  });

  it('passes through pending QR states and refuses keys created by someone else', async () => {
    t.client = fakeClient({ qrCheck: vi.fn(async () => ({ status: 'scanned' as const })) });
    expect(await (await loginAs('alice')).json()).toEqual({ status: 'scanned' });
    expect(await (await req('/api/community/music/login/qr/qr-key-1', 'bob')).json()).toEqual({ status: 'expired' });
    expect((await req('/api/community/music/login/qr/bad key!', 'alice')).status).toBe(400);
  });

  it('disables QR login without a master key', async () => {
    build({ masterKey: undefined });
    const room = await occupiedRoom();
    expect(await (await req(base(room.ref))).json()).toMatchObject({ loginAvailable: false });
    const response = await req('/api/community/music/login/qr', 'alice', { requestKey: 'qr' });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'feature_disabled' });
  });

  it('rate limits QR creation per member', async () => {
    expect((await req('/api/community/music/login/qr', 'alice', { requestKey: 'a' })).status).toBe(200);
    expect((await req('/api/community/music/login/qr', 'alice', { requestKey: 'b' })).status).toBe(429);
    expect((await req('/api/community/music/login/qr', 'bob', { requestKey: 'c' })).status).toBe(200);
  });

  it('lets members swap accounts and only the owner or an admin stop one', async () => {
    const room = await occupiedRoom();
    await loginAs('alice');
    await invite(room.ref);
    const account = (body: Record<string, unknown>, user: string) =>
      req(base(room.ref) + '/account', user, { requestKey: 'acct-' + Math.random(), ...body });
    expect((await account({ action: 'use' }, 'bob')).status).toBe(409);
    const used = await account({ action: 'use' }, 'alice');
    expect(used.status).toBe(200);
    expect((await used.json()).session.account).toMatchObject({ mine: true });
    expect((await account({ action: 'stop' }, 'bob')).status).toBe(403);
    expect((await account({ action: 'other' }, 'alice')).status).toBe(400);
    const stopped = await account({ action: 'stop' }, 'admin');
    expect(stopped.status).toBe(200);
    expect((await stopped.json()).session.account).toBeNull();

    await account({ action: 'use' }, 'alice');
    await pool.query('UPDATE music_accounts SET member_ref=$1', [t.bob]);
    expect((await account({ action: 'use' }, 'bob')).status).toBe(200);
    expect((await music.sessionForRoom(room.ref))?.accountOwner).toBe(t.bob);
    expect((await account({ action: 'stop' }, 'bob')).status).toBe(200);
    expect((await music.sessionForRoom(room.ref))?.accountOwner).toBeNull();
  });

  it('logout deletes the account and detaches it from the live session', async () => {
    const room = await occupiedRoom();
    await loginAs('alice');
    await invite(room.ref, 'alice', { useMyAccount: true });
    expect((await music.sessionForRoom(room.ref))?.accountOwner).toBe(t.alice);
    const response = await req('/api/community/music/logout', 'alice', { requestKey: 'bye' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(await music.account(t.alice)).toBeNull();
    expect((await music.sessionForRoom(room.ref))?.accountOwner).toBeNull();
  });
});

describe('music QR polling and logout (review fixes)', () => {
  const poll = (key = 'qr-key-1', user = 'alice') => req(`/api/community/music/login/qr/${key}`, user);
  const start = (user = 'alice', key = 'qr') => req('/api/community/music/login/qr', user, { requestKey: key });

  it('reaches NetEase at most once per second per user and answers faster polls from memory', async () => {
    let now = Date.now();
    build({ now: () => now });
    t.client = fakeClient({ qrCheck: vi.fn(async () => ({ status: 'scanned' as const })) });
    expect((await start()).status).toBe(200);
    expect(await (await poll()).json()).toEqual({ status: 'scanned' });
    expect(await (await poll()).json()).toEqual({ status: 'scanned' });
    expect(t.client.qrCheck).toHaveBeenCalledTimes(1);
    now += 1_000;
    expect(await (await poll()).json()).toEqual({ status: 'scanned' });
    expect(t.client.qrCheck).toHaveBeenCalledTimes(2);
  });

  it('answers waiting for a key not yet checked while the user is throttled', async () => {
    let now = Date.now();
    build({ now: () => now });
    let next = 0;
    t.client = fakeClient({
      qrKey: vi.fn(async () => ({ key: `qr-key-${++next}`, url: 'https://music.163.com/login' })),
      qrCheck: vi.fn(async () => ({ status: 'scanned' as const })),
    });
    expect((await start('alice', 'a')).status).toBe(200);
    now += 5_000;
    expect((await start('alice', 'b')).status).toBe(200);
    expect(await (await poll('qr-key-1')).json()).toEqual({ status: 'scanned' });
    expect(await (await poll('qr-key-2')).json()).toEqual({ status: 'waiting' });
    expect(t.client.qrCheck).toHaveBeenCalledTimes(1);
  });

  it('keeps the key usable when the account confirmation fails transiently', async () => {
    let now = Date.now();
    build({ now: () => now });
    const account = vi.fn()
      .mockRejectedValueOnce(new Error('ETIMEDOUT'))
      .mockResolvedValue({ nickname: '小明', vip: true });
    t.client = fakeClient({ account });
    expect((await start()).status).toBe(200);
    expect(await (await poll()).json()).toEqual({ status: 'scanned' });
    expect(await music.account(t.alice)).toBeNull();
    expect(t.errors).toHaveLength(1);
    now += 1_000;
    expect(await (await poll()).json()).toMatchObject({ status: 'done', account: { nickname: '小明' } });
    expect(t.client.qrCheck).toHaveBeenCalledTimes(1);
    expect(await music.account(t.alice)).not.toBeNull();
    now += 1_000;
    expect(await (await poll()).json()).toEqual({ status: 'expired' });
  });

  it('lets a member who left the server delete their saved login', async () => {
    await loginAs('alice');
    const resource = (await community.resource(t.alice, 'member'))!;
    await community.upsertResource('member', resource.externalId, resource.name, { available: false, metadata: resource.metadata });
    expect((await req(base('00000000-0000-4000-8000-000000000000'), 'alice')).status).toBe(403);
    const response = await req('/api/community/music/logout', 'alice', { requestKey: 'bye' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect((await pool.query('SELECT count(*)::int AS n FROM music_accounts')).rows[0].n).toBe(0);
  });

  it('answers logout for a web user without any member link', async () => {
    const response = await req('/api/community/music/logout', 'carol', { requestKey: 'bye' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});

describe('music search', () => {
  it('searches and imports playlists with a per-member rate limit', async () => {
    const search = await req('/api/community/music/search?q=%E6%AD%8C');
    expect(search.status).toBe(200);
    expect(await search.json()).toEqual({ tracks: [track(1)] });
    expect(t.client.search).toHaveBeenCalledWith('歌');
    expect((await req('/api/community/music/search?q=again')).status).toBe(429);
    expect((await req('/api/community/music/playlist?link=123', 'bob')).status).toBe(200);
    expect((await req('/api/community/music/playlist?link=123', 'bob')).status).toBe(429);
  });

  it('rejects empty queries and fails closed on an unreadable proxy', async () => {
    expect((await req('/api/community/music/search?q=')).status).toBe(400);
    await saveMusicProxy(pgEnv.DB, OTHER_KEY, 'socks5://user:pw@proxy.example:1080', false, 'admin');
    t.app = createCommunityRoutes({
      store: community, db: pgEnv.DB, env: environment(), onError: () => undefined,
      music: { store: music, db: pgEnv.DB, masterKey: MASTER_KEY, netease: createProxiedNetease(pgEnv.DB, MASTER_KEY) },
    });
    const response = await req('/api/community/music/search?q=x', 'bob');
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'proxy_unavailable' });
  });
});

describe('music proxy administration', () => {
  it('is admin only and never echoes the password', async () => {
    expect((await req('/api/admin/community/music/proxy', 'alice')).status).toBe(403);
    expect((await req('/api/admin/community/music/proxy', 'alice', { requestKey: 'p', url: null, audio: false })).status).toBe(403);
    expect(await (await req('/api/admin/community/music/proxy', 'admin')).json())
      .toEqual({ configured: false, host: null, audio: false, available: true });
    const saved = await req('/api/admin/community/music/proxy', 'admin',
      { requestKey: 'p1', url: 'socks5://user:hunter2@proxy.example:1080', audio: true });
    expect(saved.status).toBe(200);
    const savedText = await saved.text();
    expect(JSON.parse(savedText)).toEqual({ configured: true, host: 'proxy.example:1080', audio: true, available: true });
    const read = await (await req('/api/admin/community/music/proxy', 'admin')).text();
    for (const text of [savedText, read]) {
      expect(text).not.toContain('hunter2');
      expect(text).not.toContain('user:');
    }
  });

  it('changes the audio switch alone and keeps the saved address', async () => {
    const save = (body: Record<string, unknown>) => req('/api/admin/community/music/proxy', 'admin', body);
    await save({ requestKey: 'a1', url: 'socks5://user:hunter2@proxy.example:1080', audio: false });
    const flipped = await save({ requestKey: 'a2', audio: true });
    expect(flipped.status).toBe(200);
    expect(await flipped.json()).toEqual({ configured: true, host: 'proxy.example:1080', audio: true, available: true });
    expect(await (await save({ requestKey: 'a3', url: null, audio: false })).json())
      .toEqual({ configured: false, host: null, audio: false, available: true });
  });

  it('rejects invalid proxy input', async () => {
    const save = (body: Record<string, unknown>) => req('/api/admin/community/music/proxy', 'admin', { requestKey: 'p', ...body });
    expect((await save({ url: 'http://proxy.example:8080', audio: false })).status).toBe(400);
    expect((await save({ url: 'socks5://proxy.example:1080', audio: 'yes' })).status).toBe(400);
    expect((await save({ url: 'socks5://proxy.example:1080', audio: false, extra: 1 })).status).toBe(400);
    expect((await save({ url: 5, audio: false })).status).toBe(400);
    expect((await save({})).status).toBe(400);
  });

  it('tests the proxy with a fixed message', async () => {
    const test = () => req('/api/admin/community/music/proxy/test', 'admin', { requestKey: 't' });
    expect((await req('/api/admin/community/music/proxy/test', 'alice', { requestKey: 't' })).status).toBe(403);
    await req('/api/admin/community/music/proxy', 'admin', { requestKey: 'p', url: 'socks5://proxy.example:1080', audio: false });
    const ok = await test();
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, message: expect.any(String) });
    t.client = fakeClient({ search: vi.fn(async () => { throw new Error('connect ECONNREFUSED 10.0.0.1:1080'); }) });
    const failed = await (await test()).json();
    expect(failed).toMatchObject({ ok: false });
    expect(failed.message).not.toContain('ECONNREFUSED');
  });
});

describe('music rate limiter', () => {
  it('limits per id within the window and stays bounded', async () => {
    const { createRateLimiter } = await import('../../server/src/music/rate-limit');
    let now = 0;
    const limiter = createRateLimiter(1_000, () => now, 3);
    limiter.take('a');
    expect(() => limiter.take('a')).toThrow(expect.objectContaining({ status: 429, code: 'rate_limited' }));
    limiter.take('b'); limiter.take('c'); limiter.take('d');
    now = 500;
    expect(() => limiter.take('d')).toThrow();
    // 'a' was evicted as the oldest entry once the map was full.
    expect(() => limiter.take('a')).not.toThrow();
    now = 2_000;
    expect(() => limiter.take('d')).not.toThrow();
  });
});
