// The API host (capi.nanako.org): the Worker app, plus the Node-only Discord
// binding routes (link-routes.ts) in front of it for their own paths.

import type { Hono } from 'hono';
import { withForwardedProto } from './api';

export interface ApiHostParts {
  linkRoutes: Hono;
  communityRoutes?: { fetch: (request: Request) => Response | Promise<Response> };
  workerFetch: (req: Request) => Promise<Response>;
}

function under(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** Is this one of the binding routes' paths (/link/*, /api/me/discord*)? */
export function isBindingPath(url: string): boolean {
  const path = routedPath(url);
  return under(path, '/link') || under(path, '/api/me/discord');
}

export function isCommunityPath(url: string): boolean {
  const path = routedPath(url);
  return under(path, '/api/community') || under(path, '/api/admin/community');
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
    if (isCommunityPath(req.url) && parts.communityRoutes) return parts.communityRoutes.fetch(req);
    if (isBindingPath(req.url)) return parts.linkRoutes.fetch(req);
    return parts.workerFetch(req);
  };
}
