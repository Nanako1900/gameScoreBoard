// @ts-check
// Writes <outDir>/_headers for the Cloudflare Pages build of the SPA.
//
// The CSP has to name the API origin (fetches, and avatars through the API's
// image proxy), which only exists as VITE_API_BASE at build time — so this file
// is generated after `vite build` instead of living in public/.
//
// It also guards the SPA fallback (P1-0): Cloudflare Pages serves index.html for
// unknown paths (/sessions/1, /players/x/cases/7) only when the deploy has no
// 404.html, so a dist that contains one fails the build here.
//
// Usage: VITE_API_BASE=https://capi.nanako.org node scripts/pages-headers.mjs [dist]

import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** @param {string | undefined} apiBase */
function apiOrigin(apiBase) {
  if (!apiBase) return null;
  const url = new URL(apiBase); // throws on a malformed value: fail the build
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error(`VITE_API_BASE must be https: ${apiBase}`);
  }
  return url.origin;
}

/** @param {string | null} api */
function contentSecurityPolicy(api) {
  const withApi = (/** @type {string} */ base) => (api ? `${base} ${api}` : base);
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    withApi("img-src 'self' data:"),
    withApi("connect-src 'self'"),
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'self'",
  ].join('; ');
}

/** @param {string | undefined} apiBase */
export function buildHeaders(apiBase) {
  const csp = contentSecurityPolicy(apiOrigin(apiBase));
  return [
    '/*',
    `  Content-Security-Policy: ${csp}`,
    '  Strict-Transport-Security: max-age=31536000',
    '  X-Content-Type-Options: nosniff',
    '  X-Frame-Options: DENY',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
    '',
    '# Hashed by Vite: safe to cache forever.',
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
  ].join('\n');
}

/** A top-level one switches Cloudflare Pages off SPA mode (spec §2.2 bans it anywhere). */
const NOT_FOUND_PAGE = '404.html';

/**
 * Every 404.html under dir, as a path relative to root with forward slashes.
 * Outside SPA mode Pages serves the nearest 404.html up the tree, so a nested
 * one is refused too: the build never ships a page that can shadow a route.
 * @param {string} root
 * @param {string} dir
 * @returns {string[]}
 */
function notFoundPages(root, dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return notFoundPages(root, full);
    if (entry.name !== NOT_FOUND_PAGE) return [];
    return [path.relative(root, full).split(path.sep).join('/')];
  });
}

/** @param {string} outDir */
function assertSpaFallback(outDir) {
  const found = notFoundPages(outDir, outDir);
  if (found.length === 0) return;
  throw new Error(
    `构建产物里不能有 ${NOT_FOUND_PAGE}（找到：${found.join('、')}）：` +
      'Cloudflare Pages 看到它就不再把未知路径回退到 index.html，/sessions/1 这类地址会变成 404。删掉它再构建。',
  );
}

const outDir = process.argv[2] ?? 'dist';
assertSpaFallback(outDir); // before writing anything: a refused dist never looks deployable
writeFileSync(path.join(outDir, '_headers'), buildHeaders(process.env.VITE_API_BASE));
console.log(`wrote ${path.join(outDir, '_headers')}`);
