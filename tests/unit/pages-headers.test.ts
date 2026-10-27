// scripts/pages-headers.mjs runs in the Cloudflare Pages build. It is executed
// here exactly as the build runs it, so a broken script fails CI, not a deploy.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT = path.resolve(__dirname, '../../scripts/pages-headers.mjs');

function run(apiBase: string | undefined): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'pages-headers-'));
  const env = { ...process.env };
  if (apiBase === undefined) delete env.VITE_API_BASE;
  else env.VITE_API_BASE = apiBase;
  execFileSync(process.execPath, [SCRIPT, dir], { env, stdio: 'pipe' });
  return readFileSync(path.join(dir, '_headers'), 'utf8');
}

function csp(headers: string): Record<string, string> {
  const line = headers.split('\n').find((l) => l.trim().startsWith('Content-Security-Policy:')) ?? '';
  const value = line.split('Content-Security-Policy:')[1] ?? '';
  return Object.fromEntries(
    value.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
      const [name, ...rest] = d.split(/\s+/);
      return [name, rest.join(' ')];
    }),
  );
}

describe('scripts/pages-headers.mjs', () => {
  it('lets the SPA reach the API origin — and nothing else — for fetches and avatars', () => {
    const policy = csp(run('https://api.nanako.org/'));
    expect(policy['connect-src']).toBe("'self' https://api.nanako.org");
    expect(policy['img-src']).toBe("'self' data: https://api.nanako.org");
    expect(policy['script-src']).toBe("'self'");
    expect(policy['frame-ancestors']).toBe("'none'");
  });

  it('uses only the origin of VITE_API_BASE, never a path', () => {
    expect(csp(run('https://api.nanako.org/v1/'))['connect-src']).toBe("'self' https://api.nanako.org");
  });

  it('falls back to same-origin when VITE_API_BASE is unset', () => {
    expect(csp(run(undefined))['connect-src']).toBe("'self'");
  });

  it('fails the build on a malformed or plain-http API base', () => {
    expect(() => run('not a url')).toThrow();
    expect(() => run('http://api.nanako.org')).toThrow();
    // Local split testing against wrangler dev is allowed over http.
    expect(csp(run('http://localhost:8787'))['connect-src']).toBe("'self' http://localhost:8787");
  });

  it('sends the standard security headers and caches hashed assets forever', () => {
    const headers = run('https://api.nanako.org');
    expect(headers).toContain('X-Frame-Options: DENY');
    expect(headers).toContain('X-Content-Type-Options: nosniff');
    expect(headers).toMatch(/\/assets\/\*\n\s+Cache-Control: public, max-age=31536000, immutable/);
  });
});

// P1-0: Cloudflare Pages only falls back to index.html (the SPA) when the deploy
// has no top-level 404.html; spec §2.2 bans one anywhere in dist, nested included.
describe('scripts/pages-headers.mjs refuses a dist with 404.html', () => {
  function distWith(files: readonly string[]): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'pages-dist-'));
    for (const file of files) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), '<!doctype html>');
    }
    return dir;
  }

  function buildFails(dir: string): { status: number | null; stderr: string } | null {
    try {
      execFileSync(process.execPath, [SCRIPT, dir], {
        env: { ...process.env, VITE_API_BASE: 'https://capi.nanako.org' },
        stdio: 'pipe',
      });
      return null;
    } catch (err) {
      const failure = err as { status: number | null; stderr: Buffer };
      return { status: failure.status, stderr: failure.stderr.toString('utf8') };
    }
  }

  it('fails on a top-level 404.html, names it, and writes no _headers', () => {
    const dir = distWith(['index.html', '404.html']);
    const failure = buildFails(dir);
    expect(failure).not.toBeNull();
    expect(failure?.status).not.toBe(0);
    expect(failure?.stderr).toContain('404.html');
    expect(existsSync(path.join(dir, '_headers'))).toBe(false);
  });

  it('fails on a nested 404.html too, naming its path inside dist', () => {
    const failure = buildFails(distWith(['index.html', 'assets/404.html']));
    expect(failure).not.toBeNull();
    expect(failure?.status).not.toBe(0);
    expect(failure?.stderr).toContain('assets/404.html');
  });

  it('passes a normal Vite output (index.html + assets/)', () => {
    const dir = distWith(['index.html', 'assets/index-abc123.js']);
    expect(buildFails(dir)).toBeNull();
    expect(readFileSync(path.join(dir, '_headers'), 'utf8')).toContain('Content-Security-Policy:');
  });
});
