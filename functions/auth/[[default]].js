// EdgeOne Pages edge function — reverse-proxy every /auth/* request (login,
// callback, logout) to the Cloudflare Worker backend. Kept as its own catch-all
// file because each path prefix needs its own [[default]].js.
//
// redirect:'manual' is essential HERE: the OAuth flow relies on the Worker's
// 302s (login → Nanako authorize, callback → SPA) and their Set-Cookie headers
// (state cookie, session cookie) reaching the browser unchanged. Following the
// redirect at the edge would swallow the cookies and break login.
//
// NOTE: newer EdgeOne layouts use `edge-functions/` — then place this at
// edge-functions/auth/[[default]].js. Routing/handler are identical.
//
// Set the Worker URL below, or provide it as an EdgeOne env var WORKER_UPSTREAM.

const UPSTREAM = 'https://REPLACE-WITH-YOUR-WORKER.workers.dev';

export async function onRequest(context) {
  const { request, env } = context;
  const upstream = ((env && env.WORKER_UPSTREAM) || UPSTREAM).replace(/\/+$/, '');
  const url = new URL(request.url);
  const proxied = new Request(upstream + url.pathname + url.search, request);
  return fetch(proxied, { redirect: 'manual' });
}
