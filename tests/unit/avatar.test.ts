// The avatar proxy serves upstream bytes from the origin that holds the session
// cookie, so every case below is a way it could be turned against that origin:
// serving HTML/SVG (stored XSS), being bounced to internal hosts (SSRF), calling
// itself, or streaming something huge.

import { describe, expect, it } from 'vitest';
import {
  AVATAR_MAX_BYTES,
  AVATAR_MAX_REDIRECTS,
  proxyAvatar,
  type AvatarPolicy,
  type FetchLike,
} from '../../worker/avatar';
import { ApiError } from '../../worker/errors';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

const POLICY: AvatarPolicy = {
  allowedHosts: ['nanako.org'],
  selfHosts: ['score.nanako.org', 'api.nanako.org'],
  isStoredAvatar: async (url) => url === 'https://cdn.example.com/stored.png',
};

interface FakeReply {
  status?: number;
  headers?: Record<string, string>;
  body?: BodyInit | null;
}

/** A fetch that answers from a script and records every URL and init it was given. */
function fakeFetch(
  replies: Record<string, FakeReply>,
): FetchLike & { calls: string[]; inits: RequestInit[] } {
  const calls: string[] = [];
  const inits: RequestInit[] = [];
  const impl = async (input: string, init: RequestInit): Promise<Response> => {
    calls.push(input);
    inits.push(init);
    const reply = replies[input];
    if (!reply) throw new TypeError(`unexpected fetch ${input}`);
    return new Response(reply.body === undefined ? PNG : reply.body, {
      status: reply.status ?? 200,
      headers: reply.headers ?? { 'Content-Type': 'image/png' },
    });
  };
  return Object.assign(impl, { calls, inits });
}

async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ApiError) return err;
    throw err;
  }
  throw new Error('expected the proxy to refuse');
}

describe('proxyAvatar — what it will fetch', () => {
  it('refuses a missing, malformed or non-https URL', async () => {
    const f = fakeFetch({});
    expect((await rejection(proxyAvatar(undefined, POLICY, f))).status).toBe(400);
    expect((await rejection(proxyAvatar('not a url', POLICY, f))).status).toBe(400);
    expect((await rejection(proxyAvatar('http://nanako.org/a.png', POLICY, f))).status).toBe(400);
    expect(f.calls).toEqual([]);
  });

  it('fetches an allowed host by exact name only — not its sibling subdomains', async () => {
    const ok = fakeFetch({ 'https://nanako.org/a.png': {} });
    expect((await proxyAvatar('https://nanako.org/a.png', POLICY, ok)).status).toBe(200);

    const sibling = fakeFetch({});
    const err = await rejection(proxyAvatar('https://evil.nanako.org/a.png', POLICY, sibling));
    expect(err.status).toBe(403);
    expect(sibling.calls).toEqual([]);
  });

  it('fetches any stored avatar URL verbatim, so unlisted CDNs need no config', async () => {
    const f = fakeFetch({ 'https://cdn.example.com/stored.png': {} });
    expect((await proxyAvatar('https://cdn.example.com/stored.png', POLICY, f)).status).toBe(200);
    const other = fakeFetch({});
    expect((await rejection(proxyAvatar('https://cdn.example.com/other.png', POLICY, other))).status).toBe(403);
  });

  it('never fetches its own hosts, even when one is stored as an avatar', async () => {
    const selfStored: AvatarPolicy = {
      ...POLICY,
      allowedHosts: ['api.nanako.org'],
      isStoredAvatar: async () => true,
    };
    const f = fakeFetch({});
    const url = 'https://api.nanako.org/api/avatar?u=https%3A%2F%2Fnanako.org%2Fa.png';
    expect((await rejection(proxyAvatar(url, selfStored, f))).status).toBe(403);
    expect(f.calls).toEqual([]);
  });

  it('refuses IP literals and localhost outright', async () => {
    const anything: AvatarPolicy = { ...POLICY, isStoredAvatar: async () => true };
    for (const url of [
      'https://127.0.0.1/a.png',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/a.png',
      'https://localhost/a.png',
      'https://db.localhost/a.png',
    ]) {
      expect((await rejection(proxyAvatar(url, anything, fakeFetch({})))).status).toBe(403);
    }
  });
});

describe('proxyAvatar — redirects', () => {
  it('asks the runtime NOT to follow redirects, with a timeout, on every hop', async () => {
    // With the default redirect: 'follow' the runtime would chase the 302
    // itself and none of the later hops would be re-checked.
    const f = fakeFetch({
      'https://nanako.org/a.png': { status: 302, headers: { Location: 'https://cdn.example.net/1' } },
      'https://cdn.example.net/1': {},
    });
    await proxyAvatar('https://nanako.org/a.png', POLICY, f);
    expect(f.inits).toHaveLength(2);
    for (const init of f.inits) {
      expect(init.redirect).toBe('manual');
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('treats a trailing-dot hostname like the name itself', async () => {
    for (const location of ['https://localhost./x.png', 'https://api.nanako.org./api/avatar']) {
      const f = fakeFetch({
        'https://nanako.org/a.png': { status: 302, headers: { Location: location } },
      });
      expect((await rejection(proxyAvatar('https://nanako.org/a.png', POLICY, f))).status).toBe(403);
    }
    const listed = fakeFetch({ 'https://nanako.org./a.png': {} });
    expect((await proxyAvatar('https://nanako.org./a.png', POLICY, listed)).status).toBe(200);
  });

  it('turns an unparseable Location into 502, not a crash', async () => {
    const f = fakeFetch({
      'https://nanako.org/a.png': { status: 302, headers: { Location: 'https://[bad' } },
    });
    expect((await rejection(proxyAvatar('https://nanako.org/a.png', POLICY, f))).status).toBe(502);
  });

  it(`follows up to ${AVATAR_MAX_REDIRECTS} redirects, re-checking each hop`, async () => {
    const f = fakeFetch({
      'https://nanako.org/a.png': { status: 302, headers: { Location: 'https://cdn.example.net/1' } },
      'https://cdn.example.net/1': { status: 301, headers: { Location: '/2' } },
      'https://cdn.example.net/2': {},
    });
    expect((await proxyAvatar('https://nanako.org/a.png', POLICY, f)).status).toBe(200);
    expect(f.calls).toHaveLength(3);
  });

  it('gives up after too many redirects', async () => {
    const f = fakeFetch({
      'https://nanako.org/a.png': { status: 302, headers: { Location: 'https://cdn.example.net/1' } },
      'https://cdn.example.net/1': { status: 302, headers: { Location: 'https://cdn.example.net/2' } },
      'https://cdn.example.net/2': { status: 302, headers: { Location: 'https://cdn.example.net/3' } },
    });
    expect((await rejection(proxyAvatar('https://nanako.org/a.png', POLICY, f))).status).toBe(502);
    expect(f.calls).toHaveLength(AVATAR_MAX_REDIRECTS + 1);
  });

  it('will not be bounced to http, an internal address, or itself', async () => {
    for (const location of [
      'http://nanako.org/a.png',
      'https://169.254.169.254/latest/meta-data',
      'https://localhost:8080/admin',
      'https://api.nanako.org/api/admin/ai-config',
    ]) {
      const f = fakeFetch({
        'https://nanako.org/a.png': { status: 302, headers: { Location: location } },
      });
      const err = await rejection(proxyAvatar('https://nanako.org/a.png', POLICY, f));
      expect(err.status).toBeGreaterThanOrEqual(400);
      expect(f.calls).toEqual(['https://nanako.org/a.png']);
    }
  });
});

describe('proxyAvatar — what it will serve', () => {
  it('serves raster images with nosniff and a sandboxing CSP', async () => {
    const f = fakeFetch({
      'https://nanako.org/a.webp': { headers: { 'Content-Type': 'image/webp; charset=binary' } },
    });
    const res = await proxyAvatar('https://nanako.org/a.webp', POLICY, f);
    expect(res.headers.get('Content-Type')).toBe('image/webp');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
    expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });

  it('refuses HTML, SVG and untyped bodies — they would run on this origin', async () => {
    for (const type of ['text/html', 'image/svg+xml', 'application/octet-stream', '']) {
      const f = fakeFetch({
        'https://nanako.org/a': { headers: type ? { 'Content-Type': type } : {}, body: '<script>1</script>' },
      });
      expect((await rejection(proxyAvatar('https://nanako.org/a', POLICY, f))).status).toBe(415);
    }
  });

  it('refuses an oversized body, declared or not', async () => {
    const big = new Uint8Array(AVATAR_MAX_BYTES + 1);
    // Declared too big: refused from the header alone — reading this body would throw.
    const declared = fakeFetch({
      'https://nanako.org/a.png': {
        headers: { 'Content-Type': 'image/png', 'Content-Length': String(AVATAR_MAX_BYTES + 1) },
        body: new ReadableStream({
          pull() {
            throw new Error('the body must not be read');
          },
        }),
      },
    });
    expect((await rejection(proxyAvatar('https://nanako.org/a.png', POLICY, declared))).status).toBe(502);

    const streamed = fakeFetch({
      'https://nanako.org/b.png': {
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(big);
            controller.close();
          },
        }),
      },
    });
    expect((await rejection(proxyAvatar('https://nanako.org/b.png', POLICY, streamed))).status).toBe(502);
  });

  it('gives up on an upstream that never answers', async () => {
    const hang: FetchLike = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    const err = await rejection(proxyAvatar('https://nanako.org/a.png', POLICY, hang, 30));
    expect(err.status).toBe(502);
  });

  it('turns an upstream error or network failure into 502', async () => {
    const notFound = fakeFetch({ 'https://nanako.org/a.png': { status: 404 } });
    expect((await rejection(proxyAvatar('https://nanako.org/a.png', POLICY, notFound))).status).toBe(502);
    const down = fakeFetch({}); // throws for every URL
    expect((await rejection(proxyAvatar('https://nanako.org/a.png', POLICY, down))).status).toBe(502);
  });
});
