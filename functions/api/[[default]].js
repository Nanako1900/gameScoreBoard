// EdgeOne Pages edge function — reverse-proxy every /api/* request to the
// Cloudflare Worker backend, so the browser only ever talks to the EdgeOne
// origin. Single-origin means the Worker's first-party httpOnly SameSite=Lax
// session cookie keeps working with no CORS and no third-party-cookie issues.
//
// File-based routing: functions/api/[[default]].js matches /api/** (one or more
// path segments). redirect:'manual' is REQUIRED so the Worker's 302 responses
// (OAuth login → IdP, callback → /) AND their Set-Cookie headers are returned to
// the browser intact instead of being followed here at the edge.
//
// NOTE: if your EdgeOne project uses the newer `edge-functions/` directory
// layout, put this file at edge-functions/api/[[default]].js instead — the
// routing rules and handler signature are identical.
//
// Set the Worker URL below, or provide it as an EdgeOne env var WORKER_UPSTREAM.

const UPSTREAM = 'https://gamescoreboard-bn.me-22e.workers.dev';

export async function onRequest(context) {
  const { request, env } = context;
  const upstream = ((env && env.WORKER_UPSTREAM) || UPSTREAM).replace(/\/+$/, '');
  const url = new URL(request.url);
  // Preserve the full path (/api/...) + query; swap only the origin/host.
  // new Request(target, request) carries method, headers (incl. Cookie) and body.
  const proxied = new Request(upstream + url.pathname + url.search, request);
  return fetch(proxied, { redirect: 'manual' });
}
