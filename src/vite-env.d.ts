/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Base URL of the API backend.
   * - Empty (default): same-origin — used when the Worker serves the SPA itself,
   *   or when EdgeOne edge-functions reverse-proxy /api and /auth (Option A).
   * - Set to the Worker origin (e.g. https://api.example.com) for a direct
   *   cross-origin split (Option B/C).
   */
  readonly VITE_API_BASE?: string;
  /**
   * Public page that hands out a Discord invite (recommended
   * https://discord.nanako.org — the share page rotates its own invites).
   * Unset or not an absolute https: URL → the welcome card's 加入服务器 row is hidden.
   */
  readonly VITE_DISCORD_INVITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
