// Component tests that need a DOM. Kept as a third project (alongside the node
// unit suite and the Miniflare worker suite) so the fast suites stay fast.
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@shared': path.resolve(__dirname, 'shared') },
  },
  test: {
    name: 'dom',
    environment: 'jsdom',
    globals: true,
    include: ['tests/dom/**/*.test.tsx'],
    setupFiles: ['./tests/dom/setup.ts'],
  },
});
