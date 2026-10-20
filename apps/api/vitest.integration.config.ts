import { defineConfig } from 'vitest/config';
import { engineSource } from './vitest.config.js';

// Real PostgreSQL, MongoDB and Redis started by Testcontainers (Docker required).
export default defineConfig({
  resolve: { alias: { '@codelens/review-engine': engineSource } },
  test: {
    include: ['test/integration/**/*.int-spec.ts'],
    environment: 'node',
    globalSetup: ['test/integration/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
