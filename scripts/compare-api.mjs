// @ts-check
// Compares the public JSON API of two deployments — the Worker on D1 and the
// Node server on PostgreSQL — endpoint by endpoint, for the cutover's
// go / no-go. Read-only: GETs only, no cookies.
//
//   node scripts/compare-api.mjs <old-base> <new-base> [--new-host api.nanako.org]
//
// The PG port keeps D1's exact output (timestamps, 0/1 flags, ordering), so the
// comparison is strict: any difference is reported.

const [oldBase, newBase, ...rest] = process.argv.slice(2);
if (!oldBase || !newBase) {
  console.error('usage: node scripts/compare-api.mjs <old-base> <new-base> [--new-host <host>]');
  process.exit(1);
}
const hostFlag = rest.indexOf('--new-host');
const newHost = hostFlag >= 0 ? rest[hostFlag + 1] : undefined;

/** @param {string} base @param {string} path @param {string | undefined} host */
async function get(base, path, host) {
  const res = await fetch(`${base.replace(/\/$/, '')}${path}`, {
    headers: { Accept: 'application/json', ...(host ? { Host: host } : {}) },
  });
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
