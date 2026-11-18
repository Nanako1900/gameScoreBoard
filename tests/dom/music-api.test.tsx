import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/api';
import { musicApi } from '../../src/music-api';

const roomRef = 'ab4ce2dd-8bc9-4043-845c-d2aec97b4bfb';
const UUID = /^[0-9a-f-]{36}$/;

function lastCall(): { url: string; init: RequestInit | undefined; body: Record<string, unknown> } {
  const [url, init] = vi.mocked(fetch).mock.calls.at(-1)!;
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  return { url: String(url), init, body };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true, accepted: true, tracks: [] })));
});

describe('music api reads', () => {
  it('requests the view, search and playlist with credentials and encoded queries', async () => {
    await musicApi.view(roomRef);
    expect(lastCall().url).toBe(`/api/community/music/${roomRef}`);
    expect(lastCall().init?.credentials).toBe('include');
    await musicApi.search('周杰伦 & 七里香');
    expect(lastCall().url).toBe('/api/community/music/search?q=%E5%91%A8%E6%9D%B0%E4%BC%A6%20%26%20%E4%B8%83%E9%87%8C%E9%A6%99');
    await musicApi.playlist('https://music.163.com/playlist?id=1');
    expect(lastCall().url).toBe('/api/community/music/playlist?link=https%3A%2F%2Fmusic.163.com%2Fplaylist%3Fid%3D1');
    await musicApi.qrStatus('key/1');
    expect(lastCall().url).toBe('/api/community/music/login/qr/key%2F1');
    await musicApi.proxy();
    expect(lastCall().url).toBe('/api/admin/community/music/proxy');
  });
});

describe('music api writes', () => {
  it('sends a fresh requestKey with every POST', async () => {
    await musicApi.invite(roomRef, true);
    const first = lastCall();
    expect(first.url).toBe(`/api/community/music/${roomRef}/invite`);
    expect(first.init?.method).toBe('POST');
    expect(first.body).toMatchObject({ useMyAccount: true });
    expect(String(first.body.requestKey)).toMatch(UUID);
    await musicApi.invite(roomRef, true);
    expect(lastCall().body.requestKey).not.toBe(first.body.requestKey);
  });

  it('flattens command payloads next to kind', async () => {
    await musicApi.command(roomRef, { kind: 'volume', volume: 30 });
    expect(lastCall().url).toBe(`/api/community/music/${roomRef}/commands`);
    expect(lastCall().body).toMatchObject({ kind: 'volume', volume: 30 });
    await musicApi.command(roomRef, { kind: 'remove', key: 'k1' });
    expect(lastCall().body).toMatchObject({ kind: 'remove', key: 'k1' });
    await musicApi.command(roomRef, { kind: 'skip' });
    expect(String(lastCall().body.requestKey)).toMatch(UUID);
  });

  it('covers account, login, logout and proxy endpoints', async () => {
    await musicApi.account(roomRef, 'use');
    expect(lastCall()).toMatchObject({ url: `/api/community/music/${roomRef}/account`, body: expect.objectContaining({ action: 'use' }) });
    await musicApi.startQr();
    expect(lastCall().url).toBe('/api/community/music/login/qr');
    await musicApi.logout();
    expect(lastCall().url).toBe('/api/community/music/logout');
    await musicApi.saveProxy('socks5://u:p@h:1080', true);
    expect(lastCall()).toMatchObject({ url: '/api/admin/community/music/proxy', body: expect.objectContaining({ url: 'socks5://u:p@h:1080', audio: true }) });
    await musicApi.saveProxy(null, false);
    expect(lastCall().body).toMatchObject({ url: null, audio: false });
    await musicApi.testProxy();
    expect(lastCall().url).toBe('/api/admin/community/music/proxy/test');
  });
});

describe('music api errors', () => {
  it('maps non-2xx responses to ApiError with the server message and status', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ error: '搜索太频繁' }, { status: 429 }));
    const failure = await musicApi.search('x').catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 429, message: '搜索太频繁' });
  });
});
