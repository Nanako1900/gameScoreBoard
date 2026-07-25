// Unit tests: pure modules (shared/*, worker/ai/*, worker/time) under plain Node.
// D1-backed integration tests live in vitest.workers.config.ts, which needs the
// real Workers runtime.
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@shared': path.resolve(__dirname, 'shared') },
  },
  test: {
    name: 'unit',
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
});
