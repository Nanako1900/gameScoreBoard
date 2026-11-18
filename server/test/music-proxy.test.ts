import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { CommunityStoreError } from '../src/community/store';
import {
  createMusicFetch,
  parseProxyUrl,
  readMusicProxy,
  saveMusicProxy,
} from '../src/music/proxy';

const MASTER = Buffer.alloc(32, 5).toString('base64');
const OTHER_MASTER = Buffer.alloc(32, 6).toString('base64');

// Minimal in-memory stand-in for the D1 surface used by readSettings/writeSetting.
function fakeDb(): D1Database {
  const rows = new Map<string, string>();
  const db = {
    prepare(sql: string) {
      if (sql.startsWith('SELECT')) {
        return {
          all: async () => ({ results: Array.from(rows, ([key, value]) => ({ key, value })) }),
        };
      }
      return {
        bind: (key: string, value: string) => ({
          run: async () => {
            rows.set(key, value);
            return { success: true };
          },
        }),
      };
    },
  };
  return db as unknown as D1Database;
}

function statusOf(fn: () => unknown): number | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    expect(error).toBeInstanceOf(CommunityStoreError);
    return (error as CommunityStoreError).status;
  }
}

describe('parseProxyUrl', () => {
  it.each(['socks5', 'socks5h', 'socks4'])('accepts %s with and without credentials', (scheme) => {
    expect(parseProxyUrl(`${scheme}://127.0.0.1:1080`).host).toBe('127.0.0.1:1080');
    const withAuth = parseProxyUrl(`${scheme}://user:p%40ss@proxy.example:9050`);
    expect(withAuth.host).toBe('proxy.example:9050');
    expect(withAuth.host).not.toContain('user');
    expect(withAuth.url).toContain('proxy.example:9050');
  });

  it.each([
    ['http scheme', 'http://127.0.0.1:1080'],
    ['missing port', 'socks5://127.0.0.1'],
    ['port zero', 'socks5://127.0.0.1:0'],
    ['port too large', 'socks5://127.0.0.1:70000'],
    ['NUL', 'socks5://127.0.0.1:1080\u0000'],
    ['newline', 'socks5://127.0.0.1:1080\n'],
    ['too long', `socks5://${'a'.repeat(500)}.example:1080`],
    ['path', 'socks5://127.0.0.1:1080/path'],
    ['query', 'socks5://127.0.0.1:1080?x=1'],
    ['no host', 'socks5://:1080'],
    ['non-string', 42],
  ])('rejects %s with a 400', (_name, input) => {
    expect(statusOf(() => parseProxyUrl(input))).toBe(400);
  });
});

describe('music proxy storage', () => {
  it('reports unavailable without a master key and refuses to save', async () => {
    const db = fakeDb();
    const state = await readMusicProxy(db, undefined);
    expect(state.view).toEqual({ configured: false, host: null, audio: false, available: false });
    await expect(saveMusicProxy(db, undefined, 'socks5://127.0.0.1:1080', false, 'u1'))
      .rejects.toMatchObject({ status: 503 });
  });

  it('round-trips a saved address without exposing credentials', async () => {
    const db = fakeDb();
    const view = await saveMusicProxy(db, MASTER, 'socks5://bob:secret@127.0.0.1:1080', true, 'u1');
    expect(view).toEqual({ configured: true, host: '127.0.0.1:1080', audio: true, available: true });
    const state = await readMusicProxy(db, MASTER);
    expect(state.url).toContain('127.0.0.1:1080');
    expect(state.audio).toBe(true);
    expect(state.error).toBeNull();
    expect(JSON.stringify(state.view)).not.toContain('secret');
  });

  it('clears the address with null', async () => {
    const db = fakeDb();
    await saveMusicProxy(db, MASTER, 'socks5://127.0.0.1:1080', true, 'u1');
    const view = await saveMusicProxy(db, MASTER, null, false, 'u1');
    expect(view.configured).toBe(false);
    const state = await readMusicProxy(db, MASTER);
    expect(state.url).toBeNull();
    expect(state.view.host).toBeNull();
  });

  it('fails closed when the stored address cannot be decrypted', async () => {
    const db = fakeDb();
    await saveMusicProxy(db, MASTER, 'socks5://127.0.0.1:1080', false, 'u1');
    const state = await readMusicProxy(db, OTHER_MASTER);
    expect(state.url).toBeNull();
    expect(state.view.configured).toBe(true);
    expect(state.error).toBe('decrypt_failed');
  });
});

describe('createMusicFetch', () => {
  it('returns a function without a proxy', () => {
    expect(typeof createMusicFetch(null)).toBe('function');
  });

  it('returns a function for a proxy without connecting', () => {
    expect(typeof createMusicFetch('socks5://127.0.0.1:1')).toBe('function');
  });
});

const SOCKS_VERSION = 5;
const ATYP_IPV4 = 1;
const ATYP_DOMAIN = 3;
const ATYP_IPV6 = 4;

interface FakeSocks {
  port: number;
  destinations: string[];
  close(): Promise<void>;
}

function readDestination(request: Buffer): { host: string; port: number; length: number } | null {
  if (request.length < 5) return null;
  const atyp = request[3];
  let host: string;
  let offset: number;
  if (atyp === ATYP_IPV4) {
    host = [...request.subarray(4, 8)].join('.');
    offset = 8;
  } else if (atyp === ATYP_DOMAIN) {
    const size = request[4];
    host = request.subarray(5, 5 + size).toString('latin1');
    offset = 5 + size;
  } else if (atyp === ATYP_IPV6) {
    host = '::1';
    offset = 20;
  } else {
    return null;
  }
  if (request.length < offset + 2) return null;
  return { host, port: request.readUInt16BE(offset), length: offset + 2 };
}

/** No-auth SOCKS5 server that resolves every hostname to 127.0.0.1 itself. */
async function startFakeSocks(): Promise<FakeSocks> {
  const destinations: string[] = [];
  const server = net.createServer((client) => {
    let buffer = Buffer.alloc(0);
    let greeted = false;
    const onData = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!greeted) {
        if (buffer.length < 2 || buffer.length < 2 + buffer[1]) return;
        buffer = buffer.subarray(2 + buffer[1]);
        greeted = true;
        client.write(Buffer.from([SOCKS_VERSION, 0]));
      }
      const destination = readDestination(buffer);
      if (!destination) return;
      client.off('data', onData);
      destinations.push(`${destination.host}:${destination.port}`);
      const rest = buffer.subarray(destination.length);
      const upstream = net.connect(destination.port, '127.0.0.1', () => {
        client.write(Buffer.from([SOCKS_VERSION, 0, 0, ATYP_IPV4, 127, 0, 0, 1, 0, 0]));
        if (rest.length > 0) upstream.write(rest);
        client.pipe(upstream).pipe(client);
      });
      upstream.on('error', () => client.destroy());
      client.on('error', () => upstream.destroy());
    };
    client.on('data', onData);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    destinations,
    close: () => new Promise((resolve) => {
      server.close(() => resolve());
    }),
  };
}

async function startHttpTarget(): Promise<{ port: number; close(): Promise<void> }> {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain', connection: 'close' }).end(`hello ${req.url}`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    close: () => new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}

describe('createMusicFetch through a SOCKS5 proxy', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it('sends an http request through the proxy and lets it resolve the hostname (socks5h)', async () => {
    const socks = await startFakeSocks();
    const target = await startHttpTarget();
    cleanups.push(socks.close, target.close);
    const proxiedFetch = createMusicFetch(`socks5h://127.0.0.1:${socks.port}`);
    const response = await proxiedFetch(`http://music-target.invalid:${target.port}/ping`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('hello /ping');
    expect(socks.destinations).toEqual([`music-target.invalid:${target.port}`]);
  });

  it('rejects when the proxy cannot be reached', async () => {
    const closed = await startFakeSocks();
    await closed.close();
    const proxiedFetch = createMusicFetch(`socks5://127.0.0.1:${closed.port}`);
    await expect(proxiedFetch('http://music-target.invalid/')).rejects.toThrow();
  });
});
