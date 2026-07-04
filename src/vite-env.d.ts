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
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
