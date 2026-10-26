// Node backend (server/) tests: plain Node, no Workers runtime. Kept as its own
// project so the Worker suite's Miniflare setup never runs for them.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'server',
    environment: 'node',
    include: ['server/test/**/*.test.ts'],
  },
});
