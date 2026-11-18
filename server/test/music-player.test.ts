// The pure edges of the Discord/ffmpeg side: argument building, the ffmpeg
// pipeline's error handling, the audio download guard and the process config.
import { EventEmitter } from 'node:events';
import { PassThrough, Readable } from 'node:stream';
import type { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { isAllowedAudioUrl, MusicAudioError, openAudioStream } from '../src/music/audio';
import { musicPlayerUrl, musicWanted, readMusicConfig } from '../src/music/config';
import { buildFfmpegArgs, startFfmpeg } from '../src/music/ffmpeg';
import { communityRooms, createMusicIo } from '../src/music/main-deps';
import { sealMusicSecret } from '../src/music/secrets';

const MASTER = Buffer.alloc(32, 7).toString('base64');

describe('buildFfmpegArgs', () => {
  it('builds the Ogg/Opus pipeline with seek seconds and a 0..1 gain', () => {
    expect(buildFfmpegArgs(83_456, 40)).toEqual([
      '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'pipe', '-i', 'pipe:0', '-ss', '83.456', '-vn',
      '-af', 'volume=0.40', '-c:a', 'libopus', '-b:a', '96k', '-f', 'ogg', 'pipe:1',
    ]);
  });

  it('clamps out-of-range and non-finite input', () => {
    const args = buildFfmpegArgs(-5, 250);
    expect(args[args.indexOf('-ss') + 1]).toBe('0.000');
    expect(args).toContain('volume=1.00');
    expect(buildFfmpegArgs(Number.NaN, Number.NaN)).toContain('volume=0.00');
  });
});

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed: string[] = [];
  kill(signal: string) { this.killed = [...this.killed, signal]; return true; }
}

function fakeSpawn(): { spawn: typeof spawn; child: FakeChild; args: () => string[] } {
  const child = new FakeChild();
  let seen: string[] = [];
  const fn = ((_command: string, args: string[]) => { seen = args; return child; }) as unknown as typeof spawn;
  return { spawn: fn, child, args: () => seen };
}

describe('startFfmpeg', () => {
  it('reports a clean exit as null and a failed exit with stderr', () => {
    const ok = fakeSpawn();
    const results: Array<Error | null> = [];
    startFfmpeg(new PassThrough(), { seekMs: 0, volume: 100, done: (e) => results.push(e) }, ok.spawn);
    ok.child.emit('close', 0, null);
    const bad = fakeSpawn();
    startFfmpeg(new PassThrough(), { seekMs: 0, volume: 100, done: (e) => results.push(e) }, bad.spawn);
    bad.child.stderr.write('Invalid data found');
    bad.child.emit('close', 1, null);
    expect(results[0]).toBeNull();
    expect(results[1]?.message).toContain('Invalid data found');
  });

  it('ignores EPIPE on stdin but fails on an input stream error', () => {
    const f = fakeSpawn();
    const input = new PassThrough();
    const results: Array<Error | null> = [];
    startFfmpeg(input, { seekMs: 0, volume: 100, done: (e) => results.push(e) }, f.spawn);
    f.child.stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
    expect(f.child.killed).toEqual([]);
    input.emit('error', Object.assign(new Error('fetch failed for https://m7.music.126.net/secret.mp3?token=1'), {
      code: 'ECONNRESET',
    }));
    expect(f.child.killed).toEqual(['SIGKILL']);
    f.child.emit('close', null, 'SIGKILL');
    expect(results).toHaveLength(1);
    expect(results[0]?.message).toBe('audio download failed (ECONNRESET)');
  });

  it('never reports after kill()', () => {
    const f = fakeSpawn();
    const results: Array<Error | null> = [];
    const pipeline = startFfmpeg(new PassThrough(), { seekMs: 0, volume: 100, done: (e) => results.push(e) }, f.spawn);
    pipeline.kill();
    pipeline.kill();
    f.child.emit('close', null, 'SIGKILL');
    expect(results).toEqual([]);
  });
});

describe('isAllowedAudioUrl', () => {
  it('accepts http(s) on *.126.net only', () => {
    expect(isAllowedAudioUrl('https://m701.music.126.net/a/b.mp3?x=1')).toBe(true);
    expect(isAllowedAudioUrl('http://m10.music.126.net/a.flac')).toBe(true);
    expect(isAllowedAudioUrl('https://126.net/a.mp3')).toBe(false);
    expect(isAllowedAudioUrl('https://evil126.net/a.mp3')).toBe(false);
    expect(isAllowedAudioUrl('https://m701.music.126.net.evil.com/a.mp3')).toBe(false);
    expect(isAllowedAudioUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedAudioUrl('https://user:pw@m701.music.126.net/a.mp3')).toBe(false);
    expect(isAllowedAudioUrl('not a url')).toBe(false);
  });
});

function response(status: number, body: string | null, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}

async function readAll(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

describe('openAudioStream', () => {
  it('returns the body as a Node stream and follows redirects within the CDN', async () => {
    const seen: string[] = [];
    const fetcher = (async (url: string) => {
      seen.push(url);
      return seen.length === 1
        ? response(302, null, { location: 'https://m8.music.126.net/b.mp3' })
        : response(200, 'audio-bytes');
    }) as unknown as typeof fetch;
    const stream = await openAudioStream(fetcher, 'https://m7.music.126.net/a.mp3');
    expect(await readAll(stream)).toBe('audio-bytes');
    expect(seen).toEqual(['https://m7.music.126.net/a.mp3', 'https://m8.music.126.net/b.mp3']);
  });

  it('fetches NetEase CDN audio over https even when the API or a redirect says http', async () => {
    const seen: string[] = [];
    const fetcher = (async (url: string) => {
      seen.push(url);
      return seen.length === 1
        ? response(302, null, { location: 'http://m8.music.126.net/b.mp3' })
        : response(200, 'audio-bytes');
    }) as unknown as typeof fetch;
    await openAudioStream(fetcher, 'http://m7.music.126.net/a.mp3?x=1');
    expect(seen).toEqual(['https://m7.music.126.net/a.mp3?x=1', 'https://m8.music.126.net/b.mp3']);
  });

  it('refuses a disallowed host, including after a redirect, without fetching it', async () => {
    const seen: string[] = [];
    const fetcher = (async (url: string) => {
      seen.push(url);
      return response(302, null, { location: 'http://169.254.169.254/latest' });
    }) as unknown as typeof fetch;
    await expect(openAudioStream(fetcher, 'https://example.com/a.mp3')).rejects.toBeInstanceOf(MusicAudioError);
    await expect(openAudioStream(fetcher, 'https://m7.music.126.net/a.mp3')).rejects.toThrow('allowed host');
    expect(seen).toEqual(['https://m7.music.126.net/a.mp3']);
  });

  it('turns HTTP and network failures into messages without the URL', async () => {
    const notFound = (async () => response(403, 'denied')) as unknown as typeof fetch;
    await expect(openAudioStream(notFound, 'https://m7.music.126.net/secret.mp3')).rejects.toThrow('HTTP 403');
    const broken = (async (url: string) => { throw new TypeError(`fetch failed for ${url}`); }) as unknown as typeof fetch;
    await expect(openAudioStream(broken, 'https://m7.music.126.net/secret.mp3')).rejects.toThrow(/^audio request failed$/);
  });
});

describe('music config', () => {
  const env = {
    MUSIC_ENABLED: 'true', MUSIC_DISCORD_TOKEN: 'token-value', GUILD_ID: '123456789012345678',
    DATABASE_URL: 'postgres://u@h/db', FRONTEND_URL: 'https://edg.example/', READ_ONLY: '',
  };

  it('idles without a token or when disabled', () => {
    expect(musicWanted(env)).toBe(true);
    expect(musicWanted({ ...env, MUSIC_DISCORD_TOKEN: ' ' })).toBe(false);
    expect(musicWanted({ ...env, MUSIC_ENABLED: '' })).toBe(false);
  });

  it('treats a malformed MUSIC_ENABLED as disabled with one warning instead of throwing', () => {
    const warnings: string[] = [];
    expect(musicWanted({ ...env, MUSIC_ENABLED: 'maybe' }, (line) => { warnings.push(line); })).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('MUSIC_ENABLED');
  });

  it('reads a valid environment and reports every problem without echoing the token', () => {
    const config = readMusicConfig(env);
    expect(config.frontendUrl).toBe('https://edg.example');
    expect(config.masterKey).toBeUndefined();
    expect(musicPlayerUrl(config.frontendUrl, 'r 1')).toBe('https://edg.example/community/music/r%201');
    const error = (() => { try { readMusicConfig({ ...env, MUSIC_DISCORD_TOKEN: 'Bot secret', GUILD_ID: 'x' }); } catch (e) { return e as Error; } return null; })();
    expect(error?.message).toContain('GUILD_ID');
    expect(error?.message).not.toContain('secret');
  });
});

describe('communityRooms', () => {
  const room = { ref: 'r1', status: 'active', channelRef: 'c1' };
  const voice = { externalId: '999999999999999999', available: true };
  const make = (r: unknown, v: unknown) => communityRooms({
    getRoom: async () => r as never,
    resource: async () => v as never,
  });

  it('maps an active room to its Discord channel id', async () => {
    expect(await make(room, voice).channelFor('r1')).toBe(voice.externalId);
  });

  it('returns null for a closed, missing or channel-less room', async () => {
    expect(await make({ ...room, status: 'closed' }, voice).channelFor('r1')).toBeNull();
    expect(await make(null, voice).channelFor('r1')).toBeNull();
    expect(await make({ ...room, channelRef: null }, voice).channelFor('r1')).toBeNull();
    expect(await make(room, { ...voice, available: false }).channelFor('r1')).toBeNull();
  });
});

function memberCommunity(available: boolean | null) {
  return {
    resource: async () => (available === null ? null : { available }) as never,
  };
}

describe('createMusicIo cookieFor', () => {
  const account = (cookieEncrypted: string) => ({ memberRef: 'm1', cookieEncrypted, nickname: 'n', vip: false,
    expiresAt: '2026-12-01T00:00:00.000Z', createdAt: '2026-11-01T00:00:00.000Z' });

  it('returns null for a missing account and deletes an undecryptable one', async () => {
    let deleted: string[] = [];
    const store = {
      account: async (ref: string) => (ref === 'm1' ? account('garbage') : null),
      deleteAccount: async (ref: string) => { deleted = [...deleted, ref]; },
    };
    const io = createMusicIo({ db: {} as D1Database, masterKey: MASTER, store, community: memberCommunity(true), now: () => 0 });
    expect(await io.cookieFor('nobody')).toBeNull();
    expect(await io.cookieFor('m1')).toBeNull();
    expect(deleted).toEqual(['m1']);
  });

  it('keeps stored logins when the master key is absent', async () => {
    const sealed = await sealMusicSecret('MUSIC_U=abc', MASTER, 'cookie');
    let deleted = 0;
    const store = { account: async () => account(sealed), deleteAccount: async () => { deleted += 1; } };
    const io = createMusicIo({ db: {} as D1Database, masterKey: undefined, store, community: memberCommunity(true), now: () => 0 });
    expect(await io.cookieFor('m1')).toBeNull();
    expect(deleted).toBe(0);
  });

  it.each([
    ['left the server', false],
    ['no longer known', null],
  ])('refuses and forgets the account of an owner who %s', async (_name, available) => {
    const sealed = await sealMusicSecret('MUSIC_U=abc', MASTER, 'cookie');
    let deleted: string[] = [];
    const store = {
      account: async () => account(sealed),
      deleteAccount: async (ref: string) => { deleted = [...deleted, ref]; },
    };
    const io = createMusicIo({
      db: {} as D1Database, masterKey: MASTER, store, community: memberCommunity(available), now: () => 0,
    });
    expect(await io.cookieFor('m1')).toBeNull();
    expect(deleted).toEqual(['m1']);
  });
});
