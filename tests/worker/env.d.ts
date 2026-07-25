// Ambient types for the D1-backed integration suite.
//
// Declared member-by-member rather than as `interface ProvidedEnv extends Env {}`:
// TypeScript does not merge a heritage clause into an already-declared interface,
// so the `extends` form silently leaves ProvidedEnv empty. Tests only ever touch
// the DB binding directly — anything needing the full Env goes through
// `noAiEnv()` in helpers.ts, which casts once in a single place.

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    DB: D1Database;
  }
}

// Vite's `?raw` suffix, used to load schema.sql into the test setup.
declare module '*.sql?raw' {
  const content: string;
  export default content;
}
