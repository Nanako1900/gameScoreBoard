// @ts-check
// Writes <outDir>/_headers for the Cloudflare Pages build of the SPA.
//
// The CSP has to name the API origin (fetches, and avatars through the API's
// image proxy), which only exists as VITE_API_BASE at build time — so this file
// is generated after `vite build` instead of living in public/.
//
// Usage: VITE_API_BASE=https://capi.nanako.org node scripts/pages-headers.mjs [dist]

import { writeFileSync } from 'node:fs';
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

const outDir = process.argv[2] ?? 'dist';
writeFileSync(path.join(outDir, '_headers'), buildHeaders(process.env.VITE_API_BASE));
console.log(`wrote ${path.join(outDir, '_headers')}`);
