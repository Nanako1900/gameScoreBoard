import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createNeteaseClient, type NeteaseClient } from '../src/music/netease/client';
import { weapi } from '../src/music/netease/crypto';
import { neteaseSource } from '../src/music/source';
import { CommunityStoreError } from '../src/community/store';

vi.mock('../src/music/netease/crypto', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/music/netease/crypto')>();
  return { weapi: vi.fn(real.weapi) };
});

const BASE = 'https://music.163.com/weapi';
const MUSIC_U = 'MUSIC_U=00ABCDEF1234567890secretvalue';
const GENERIC = '网易云暂不可用，请稍后重试';

interface Call { url: string; init: RequestInit }
type Responder = () => Response | Promise<Response>;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, ...init });
}

function setup(routes: Record<string, Responder>, timeoutMs?: number) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    const responder = routes[url];
    if (!responder) throw new Error(`unexpected url ${url}`);
    return responder();
  });
  const deps = Object.freeze({ fetch: fetch as unknown as typeof globalThis.fetch, timeoutMs });
  return { client: createNeteaseClient(deps), calls };
}

function header(call: Call, name: string): string | null {
  return new Headers(call.init.headers).get(name);
}

function lastPayload(): Record<string, unknown> {
  const calls = vi.mocked(weapi).mock.calls;
  return calls[calls.length - 1][0] as Record<string, unknown>;
}

async function expectUnavailable(promise: Promise<unknown>, forbidden: string[] = []) {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(CommunityStoreError);
  const storeError = error as CommunityStoreError;
  expect(storeError.status).toBe(502);
  expect(storeError.code).toBe('netease_unavailable');
  expect(storeError.message).toBe(GENERIC);
  for (const text of forbidden) expect(storeError.message).not.toContain(text);
}

async function expectInvalid(promise: Promise<unknown>) {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(CommunityStoreError);
  expect((error as CommunityStoreError).status).toBe(400);
  expect((error as CommunityStoreError).code).toBe('invalid_input');
}

const SEARCH_SONG = {
  id: 186016,
  name: '晴天',
  ar: [{ id: 6452, name: '周杰伦' }, { id: 1, name: '合唱' }],
  al: { id: 18905, name: '叶惠美', picUrl: 'http://p1.music.126.net/abc/109951.jpg' },
  dt: 269000,
  fee: 8,
};

beforeEach(() => {
  vi.mocked(weapi).mockClear();
});

describe('netease client requests', () => {
  it('posts form-encoded weapi params with web headers and no cookie when anonymous', async () => {
    const { client, calls } = setup({
      [`${BASE}/cloudsearch/get/web`]: () => jsonResponse({ code: 200, result: { songs: [], songCount: 0 } }),
    });
    await client.search('晴天');
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.init.method).toBe('POST');
    expect(header(call, 'Content-Type')).toBe('application/x-www-form-urlencoded');
    expect(header(call, 'Referer')).toBe('https://music.163.com/');
    expect(header(call, 'User-Agent')).toMatch(/^Mozilla\/5\.0 .*Chrome/);
    expect(header(call, 'Cookie')).toBe('os=pc');
    expect(call.init.redirect).toBe('error');
    const form = new URLSearchParams(String(call.init.body));
    expect([...form.keys()].sort()).toEqual(['encSecKey', 'params']);
    expect(form.get('encSecKey')).toMatch(/^[0-9a-f]{256}$/);
    expect(lastPayload()).toEqual({ s: '晴天', type: 1, limit: 20, offset: 0, total: true, csrf_token: '' });
  });

  it('sends only MUSIC_U plus the fixed cookies when a cookie is given', async () => {
    const { client, calls } = setup({
      [`${BASE}/song/enhance/player/url/v1`]: () => jsonResponse({
        code: 200, data: [{ id: 1, url: 'https://m701.music.126.net/a.m4a', code: 200, fee: 0, freeTrialInfo: null }],
      }),
    });
    await client.songUrl('netease:1', MUSIC_U);
    expect(header(calls[0], 'Cookie')).toBe(`os=pc; ${MUSIC_U}`);
    expect(lastPayload()).toEqual({ ids: '[1]', level: 'standard', encodeType: 'aac', csrf_token: '' });
  });

  it('rejects malformed cookies before any request', async () => {
    const { client, calls } = setup({});
    await expectInvalid(client.songUrl('netease:1', 'MUSIC_U=a; other=b'));
    await expectInvalid(client.account('SESSION=abc'));
    expect(calls).toHaveLength(0);
  });
});

describe('search', () => {
  it('maps a realistic response to MusicTrack and validates every field', async () => {
    const longName = 'x'.repeat(500);
    const { client } = setup({
      [`${BASE}/cloudsearch/get/web`]: () => jsonResponse({
        code: 200,
        result: {
          songCount: 4,
          songs: [
            SEARCH_SONG,
            { id: 2, name: longName, ar: [], al: { name: 'A', picUrl: 'https://evil.example.com/x.jpg' }, dt: 1000 },
            { id: 'not-a-number', name: 'bad', ar: [], al: {}, dt: 1 },
            { id: 3, name: 'cover-less', ar: [{ name: 7 }], al: null, dt: 1 },
            { id: 4, name: 'negative duration', ar: [], al: {}, dt: -5 },
            { id: 5, name: 'no duration', ar: [], al: {} },
            { id: 6, name: 'zero duration', ar: [], al: {}, dt: 0 },
            { id: 7, name: 'huge cover', ar: [], al: { picUrl: `http://p1.music.126.net/${'a'.repeat(600)}.jpg` }, dt: 1 },
          ],
        },
      }),
    });
    const tracks = await client.search('  晴天  ', 5);
    expect(tracks).toEqual([
      {
        id: 'netease:186016',
        title: '晴天',
        artists: ['周杰伦', '合唱'],
        album: '叶惠美',
        durationMs: 269000,
        coverUrl: 'https://p1.music.126.net/abc/109951.jpg',
      },
      { id: 'netease:2', title: 'x'.repeat(200), artists: [], album: 'A', durationMs: 1000, coverUrl: null },
      { id: 'netease:3', title: 'cover-less', artists: [], album: '', durationMs: 1, coverUrl: null },
      { id: 'netease:7', title: 'huge cover', artists: [], album: '', durationMs: 1, coverUrl: null },
    ]);
    expect(lastPayload()).toMatchObject({ s: '晴天', limit: 5 });
  });

  it('returns an empty list when the result has no songs', async () => {
    const { client } = setup({
      [`${BASE}/cloudsearch/get/web`]: () => jsonResponse({ code: 200, result: { songCount: 0 } }),
    });
    expect(await client.search('nothing')).toEqual([]);
  });

  it('rejects empty, overlong or non-string keywords and bad limits', async () => {
    const { client, calls } = setup({});
    await expectInvalid(client.search('   '));
    await expectInvalid(client.search('x'.repeat(101)));
    await expectInvalid(client.search(42 as unknown as string));
    await expectInvalid(client.search('ok', 0));
    await expectInvalid(client.search('ok', 51));
    await expectInvalid(client.search('ok', 1.5));
    expect(calls).toHaveLength(0);
  });
});

describe('playlist', () => {
  function playlistRoutes(trackCount: number) {
    const ids = Array.from({ length: trackCount }, (_, index) => index + 1);
    return {
      [`${BASE}/v6/playlist/detail`]: () => jsonResponse({
        code: 200, playlist: { id: 77, name: '我的歌单', trackIds: ids.map((id) => ({ id })) },
      }),
      [`${BASE}/v3/song/detail`]: () => jsonResponse({
        code: 200,
        songs: ids.slice(0, 200).reverse().map((id) => ({ ...SEARCH_SONG, id, name: `song ${id}` })),
      }),
    };
  }

  it.each([
    ['77'],
    ['https://music.163.com/#/playlist?id=77'],
    ['https://music.163.com/playlist?id=77&userid=123'],
    ['https://y.music.163.com/m/playlist?id=77&uct2=abc'],
    ['https://music.163.com/playlist/77/123456/?userid=1'],
    ['  https://163cn.tv/playlist?id=77  '],
  ])('accepts %s', async (input) => {
    const { client } = setup(playlistRoutes(3));
    const result = await client.playlist(input);
    expect(vi.mocked(weapi).mock.calls[0][0]).toMatchObject({ id: '77' });
    expect(result.name).toBe('我的歌单');
    expect(result.tracks.map((track) => track.id)).toEqual(['netease:1', 'netease:2', 'netease:3']);
  });

  it.each([
    [''],
    ['abc'],
    ['https://music.163.com/#/song?id=77'],
    ['https://evil.example.com/playlist?id=77'],
    ['javascript:alert(1)//music.163.com/playlist?id=77'],
    ['ftp://music.163.com/playlist?id=77'],
    ['https://music.163.com/playlist?id=abc'],
    [`https://music.163.com/playlist?id=7${'7'.repeat(600)}`],
  ])('rejects %s with 400', async (input) => {
    const { client, calls } = setup({});
    await expectInvalid(client.playlist(input));
    expect(calls).toHaveLength(0);
  });

  it('caps the playlist at MUSIC_QUEUE_LIMIT tracks and keeps playlist order', async () => {
    const { client } = setup(playlistRoutes(250));
    const result = await client.playlist('77');
    expect(result.tracks).toHaveLength(200);
    expect(result.tracks[0].id).toBe('netease:1');
    expect(result.tracks[199].id).toBe('netease:200');
    const detailPayload = lastPayload();
    expect(JSON.parse(String(detailPayload.c))).toHaveLength(200);
  });

  it('reports a missing playlist as 404', async () => {
    const { client } = setup({ [`${BASE}/v6/playlist/detail`]: () => jsonResponse({ code: 404, message: 'gone' }) });
    const error = await client.playlist('77').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CommunityStoreError);
    expect((error as CommunityStoreError).status).toBe(404);
  });
});

describe('songUrl', () => {
  function urlRoute(entry: Record<string, unknown>) {
    return { [`${BASE}/song/enhance/player/url/v1`]: () => jsonResponse({ code: 200, data: [{ id: 1, ...entry }] }) };
  }

  it('returns a playable audio url on a NetEase audio host unchanged', async () => {
    const audio = 'http://m801.music.126.net/20261117/abc/x.m4a?vuutv=token';
    const { client } = setup(urlRoute({ url: audio, code: 200, fee: 0, freeTrialInfo: null }));
    expect(await client.songUrl('netease:1')).toEqual({ url: audio });
  });

  it.each([
    [{ url: null, code: 404, fee: 0 }, '歌曲已下架'],
    [{ url: null, code: 200, fee: 1 }, '需要会员'],
    [{ url: null, code: 200, fee: 4 }, '需要购买专辑'],
    [{ url: null, code: -110, fee: 8 }, '当前地区不可播放'],
    [{ url: 'https://m801.music.126.net/x.m4a', code: 200, fee: 1, freeTrialInfo: { start: 0, end: 30 } }, '仅可试听'],
    [{ url: null, code: 200, fee: 0 }, '暂时无法播放'],
  ])('maps %o to unplayable %s', async (entry, reason) => {
    const { client } = setup(urlRoute(entry));
    expect(await client.songUrl('netease:1')).toEqual({ unplayable: reason });
  });

  it('treats audio urls on unknown hosts as an unexpected shape', async () => {
    const { client } = setup(urlRoute({ url: 'https://evil.example.com/x.mp3', code: 200, fee: 0 }));
    await expectUnavailable(client.songUrl('netease:1'));
  });

  it('rejects track ids that are not netease ids', async () => {
    const { client, calls } = setup({});
    await expectInvalid(client.songUrl('123'));
    await expectInvalid(client.songUrl('netease:abc'));
    expect(calls).toHaveLength(0);
  });
});

describe('QR login', () => {
  it('creates a QR key and login url', async () => {
    const { client } = setup({
      [`${BASE}/login/qrcode/unikey`]: () => jsonResponse({ code: 200, unikey: 'a1b2-c3d4' }),
    });
    expect(await client.qrKey()).toEqual({ key: 'a1b2-c3d4', url: 'https://music.163.com/login?codekey=a1b2-c3d4' });
    expect(lastPayload()).toEqual({ type: 1, csrf_token: '' });
  });

  it.each([
    [800, 'expired'],
    [801, 'waiting'],
    [802, 'scanned'],
  ])('maps code %i to %s', async (code, status) => {
    const { client } = setup({ [`${BASE}/login/qrcode/client/login`]: () => jsonResponse({ code }) });
    expect(await client.qrCheck('a1b2-c3d4')).toEqual({ status });
    expect(lastPayload()).toEqual({ key: 'a1b2-c3d4', type: 1, csrf_token: '' });
  });

  it('takes only MUSIC_U from several Set-Cookie headers on 803', async () => {
    const headers = new Headers();
    headers.append('Set-Cookie', '__csrf=csrfsecret; Max-Age=1296010; Path=/');
    headers.append('Set-Cookie', 'MUSIC_U=00ABCDEF1234567890secretvalue; Max-Age=15552000; Path=/; HTTPOnly');
    headers.append('Set-Cookie', 'MUSIC_R_T=refreshsecret; Path=/api/feedback');
    const { client } = setup({
      [`${BASE}/login/qrcode/client/login`]: () => jsonResponse({ code: 803, cookie: 'ignored' }, { headers }),
    });
    expect(await client.qrCheck('a1b2-c3d4')).toEqual({ status: 'done', cookie: MUSIC_U });
  });

  it('fails with 502 when 803 arrives without MUSIC_U', async () => {
    const headers = new Headers();
    headers.append('Set-Cookie', '__csrf=csrfsecret; Path=/');
    const { client } = setup({ [`${BASE}/login/qrcode/client/login`]: () => jsonResponse({ code: 803 }, { headers }) });
    await expectUnavailable(client.qrCheck('a1b2-c3d4'), ['csrfsecret']);
  });

  it('rejects malformed keys and unknown codes', async () => {
    const { client } = setup({ [`${BASE}/login/qrcode/client/login`]: () => jsonResponse({ code: 999 }) });
    await expectInvalid(client.qrCheck('bad key;'));
    await expectUnavailable(client.qrCheck('a1b2-c3d4'));
  });
});

describe('account', () => {
  it('returns nickname and vip status for a valid login', async () => {
    const { client, calls } = setup({
      [`${BASE}/nuser/account/get`]: () => jsonResponse({
        code: 200, account: { id: 1, vipType: 11 }, profile: { nickname: '小明'.repeat(100), vipType: 11 },
      }),
    });
    expect(await client.account(MUSIC_U)).toEqual({ nickname: '小明'.repeat(50), vip: true });
    expect(header(calls[0], 'Cookie')).toBe(`os=pc; ${MUSIC_U}`);
  });

  it('reports non-vip accounts', async () => {
    const { client } = setup({
      [`${BASE}/nuser/account/get`]: () => jsonResponse({
        code: 200, account: { id: 1, vipType: 0 }, profile: { nickname: 'A', vipType: 0 },
      }),
    });
    expect(await client.account(MUSIC_U)).toEqual({ nickname: 'A', vip: false });
  });

  it.each([
    [{ code: 200, account: null, profile: null }],
    [{ code: 301, msg: 'need login' }],
  ])('returns null for an invalid login %o', async (body) => {
    const { client } = setup({ [`${BASE}/nuser/account/get`]: () => jsonResponse(body) });
    expect(await client.account(MUSIC_U)).toBeNull();
  });
});

describe('failure normalisation', () => {
  const searchUrl = `${BASE}/cloudsearch/get/web`;
  const forbidden = ['secretvalue', 'BODY_SECRET', 'music.163.com'];

  async function run(responder: Responder) {
    const { client } = setup({ [searchUrl]: responder });
    await expectUnavailable(client.search('x'), forbidden);
  }

  it('times out with AbortController', async () => {
    const hanging = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted BODY_SECRET')));
    }));
    const slowClient = createNeteaseClient({ fetch: hanging as unknown as typeof fetch, timeoutMs: 20 });
    await expectUnavailable(slowClient.search('x'), forbidden);
    expect(hanging.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('normalises network errors', () => run(() => { throw new Error(`network BODY_SECRET ${MUSIC_U}`); }));
  it('normalises HTTP 500', () => run(() => new Response('BODY_SECRET', { status: 500 })));
  it('normalises HTML bodies', () => run(() => new Response('<html>BODY_SECRET</html>', { status: 200 })));
  it('normalises non-object JSON', () => run(() => jsonResponse(['BODY_SECRET'])));
  it('normalises missing result objects', () => run(() => jsonResponse({ code: 200, message: 'BODY_SECRET' })));
  it('normalises non-array songs', () => run(() => jsonResponse({ code: 200, result: { songs: 'BODY_SECRET' } })));
  it('normalises non-200 body codes', () => run(() => jsonResponse({ code: -460, message: 'BODY_SECRET' })));

  it('never leaks the cookie in errors from authenticated calls', async () => {
    const { client } = setup({
      [`${BASE}/nuser/account/get`]: () => new Response(`oops ${MUSIC_U}`, { status: 503 }),
    });
    await expectUnavailable(client.account(MUSIC_U), forbidden);
  });
});

describe('neteaseSource', () => {
  let client: NeteaseClient;

  beforeEach(() => {
    client = {
      search: vi.fn(async () => []),
      playlist: vi.fn(async () => ({ name: 'p', tracks: [] })),
      songUrl: vi.fn(async () => ({ url: 'https://m701.music.126.net/a.m4a' })),
      qrKey: vi.fn(),
      qrCheck: vi.fn(),
      account: vi.fn(),
    } as unknown as NeteaseClient;
  });

  it('delegates resolve to the client', async () => {
    const source = neteaseSource(client);
    expect(await source.resolve('netease:1', MUSIC_U)).toEqual({ url: 'https://m701.music.126.net/a.m4a' });
    expect(client.songUrl).toHaveBeenCalledWith('netease:1', MUSIC_U);
  });

  it('rejects track ids from other sources', async () => {
    const source = neteaseSource(client);
    await expectInvalid(source.resolve('bilibili:1'));
    expect(client.songUrl).not.toHaveBeenCalled();
  });
});
