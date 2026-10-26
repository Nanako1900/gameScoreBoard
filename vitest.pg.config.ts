// The D1 integration suite (tests/worker/**), run unchanged against
// PostgreSQL through the D1-compatible adapter the Node backend uses
// (server/src/db/d1.ts). Passing both suites is the port's main evidence that
// nothing changed behaviour.
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'shared'),
      'cloudflare:test': path.resolve(__dirname, 'tests/pg/cloudflare-test.ts'),
    },
  },
  test: {
    name: 'worker-pg',
    environment: 'node',
    // tests/pg/*.test.ts: PostgreSQL-only (the D1 → PG import itself).
    include: ['tests/worker/**/*.test.ts', 'tests/pg/**/*.test.ts'],
    globalSetup: ['./tests/pg/global-setup.ts'],
    setupFiles: ['./tests/pg/setup.ts'],
    // One database, emptied before every test: files must not overlap.
    fileParallelism: false,
  },
});
