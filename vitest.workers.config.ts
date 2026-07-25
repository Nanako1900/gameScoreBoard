// Integration tests against a real (Miniflare-backed) D1 database, so the case
// state machine and session settlement are exercised through actual SQL rather
// than a hand-written stub that could drift from D1's behaviour.
import path from 'node:path';
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  resolve: {
    alias: { '@shared': path.resolve(__dirname, 'shared') },
  },
  test: {
    name: 'worker',
    include: ['tests/worker/**/*.test.ts'],
    setupFiles: ['./tests/worker/setup.ts'],
    poolOptions: {
      workers: {
        singleWorker: true,
        miniflare: {
          compatibilityDate: '2025-05-01',
          compatibilityFlags: ['nodejs_compat'],
          d1Databases: ['DB'],
        },
      },
    },
  },
});
