import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export const engineSource = fileURLToPath(
  new URL('../../packages/review-engine/src/index.ts', import.meta.url),
);

export default defineConfig({
  resolve: { alias: { '@codelens/review-engine': engineSource } },
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/main.ts',
        'src/worker.ts',
        'src/container.ts',
        'src/cli/**',
        'src/**/*.spec.ts',
        'src/testing/**',
        // Thin adapters over PostgreSQL, MongoDB and Redis: covered by the integration tests.
        'src/infrastructure/**',
        'src/**/*.postgres.ts',
        'src/**/*.mongo.ts',
        'src/**/*.bullmq.ts',
        'src/**/*.redis.ts',
      ],
      reporter: ['text-summary', 'lcov', 'html'],
      thresholds: { lines: 85, statements: 85, functions: 85, branches: 80 },
    },
  },
});
