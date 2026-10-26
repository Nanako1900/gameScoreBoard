// The API host (api.nanako.org): the Worker app, plus the Node-only Discord
// binding routes (link-routes.ts) in front of it for their own paths.

import type { Hono } from 'hono';
import { withForwardedProto } from './api';

export interface ApiHostParts {
  linkRoutes: Hono;
  workerFetch: (req: Request) => Promise<Response>;
}

function under(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * The path as Hono's router will see it — percent-decoded — so `/%6Cink/...`
 * cannot reach one app's routes while being sent to the other.
 */
function routedPath(url: string): string {
  const { pathname } = new URL(url);
  try {
    return decodeURI(pathname);
  } catch {
    return pathname;
  }
}

export function createApiHost(parts: ApiHostParts): (req: Request) => Promise<Response> {
  return async (request) => {
    // First, so both apps see the public https origin (CSRF allowlists, own-host checks).
    const req = withForwardedProto(request);
    const path = routedPath(req.url);
    if (under(path, '/link') || under(path, '/api/me/discord')) return parts.linkRoutes.fetch(req);
    return parts.workerFetch(req);
  };
}
