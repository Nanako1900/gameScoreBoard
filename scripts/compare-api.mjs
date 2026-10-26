// @ts-check
// Compares the public JSON API of two deployments — the Worker on D1 and the
// Node server on PostgreSQL — endpoint by endpoint, for the cutover's
// go / no-go. Read-only: GETs only, no cookies.
//
//   node scripts/compare-api.mjs <old-base> <new-base> [--new-host capi.nanako.org]
//
// --new-host: send this Host (and TLS SNI) to <new-base>, e.g. to check the app
// by IP or over an SSH tunnel before DNS points at it:
//   node scripts/compare-api.mjs https://capi.nanako.org http://127.0.0.1:8787 --new-host capi-next.nanako.org
//
// The PG port keeps D1's exact output (timestamps, 0/1 flags, ordering), so the
// comparison is strict: any difference is reported.

import http from 'node:http';
import https from 'node:https';

const [oldBase, newBase, ...rest] = process.argv.slice(2);
if (!oldBase || !newBase) {
  console.error('usage: node scripts/compare-api.mjs <old-base> <new-base> [--new-host <host>]');
  process.exit(1);
}
const hostFlag = rest.indexOf('--new-host');
const newHost = hostFlag >= 0 ? rest[hostFlag + 1] : undefined;

/**
 * GET with an explicit Host (and TLS SNI): fetch() silently drops a Host
 * header, so comparing against the app by IP / through an SSH tunnel before
 * DNS points at it needs node:http(s).
 * @param {string} url @param {string} host
 * @returns {Promise<{ status: number, type: string, text: string }>}
 */
function getWithHost(url, host) {
  const target = new URL(url);
  const client = target.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(
      target,
      { method: 'GET', headers: { Accept: 'application/json', Host: host }, servername: host },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? ''), text }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** @param {string} base @param {string} path @param {string | undefined} host */
async function get(base, path, host) {
  const url = `${base.replace(/\/$/, '')}${path}`;
  if (host) {
    const res = await getWithHost(url, host);
    return { status: res.status, body: res.type.includes('json') ? JSON.parse(res.text) : res.text };
  }
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text() };
}

/** First differing JSON path, or null. @param {unknown} a @param {unknown} b @returns {string | null} */
function diff(a, b, path = '$') {
  if (Object.is(a, b)) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
    return `${path}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: array vs object`;
  const keys = new Set([...Object.keys(a), ...Object.keys(/** @type {object} */ (b))]);
  for (const key of keys) {
    const d = diff(/** @type {Record<string, unknown>} */ (a)[key], /** @type {Record<string, unknown>} */ (b)[key], `${path}.${key}`);
    if (d) return d;
  }
  return null;
}

// Fixed endpoints, then every user, record and session the old API lists.
const paths = ['/api/leaderboard', '/api/records?limit=200', '/api/sessions?scope=past', '/api/sessions?scope=upcoming', '/api/report/latest'];
const old = await get(oldBase, '/api/leaderboard', undefined);
for (const p of /** @type {{ participants: Array<{ id: string }> }} */ (old.body).participants ?? []) {
  paths.push(`/api/users/${encodeURIComponent(p.id)}`);
}
const records = await get(oldBase, '/api/records?limit=200', undefined);
for (const r of /** @type {{ records: Array<{ id: number }> }} */ (records.body).records ?? []) paths.push(`/api/records/${r.id}`);
const past = await get(oldBase, '/api/sessions?scope=past', undefined);
for (const s of /** @type {{ sessions: Array<{ id: number }> }} */ (past.body).sessions ?? []) paths.push(`/api/sessions/${s.id}`);

let failures = 0;
for (const path of paths) {
  const [a, b] = [await get(oldBase, path, undefined), await get(newBase, path, newHost)];
  const d = a.status !== b.status ? `status ${a.status} ≠ ${b.status}` : diff(a.body, b.body);
  if (d) {
    failures += 1;
    console.log(`✗ ${path}  ${d}`);
  }
}
console.log(`${paths.length - failures}/${paths.length} endpoints identical`);
process.exit(failures === 0 ? 0 : 1);
