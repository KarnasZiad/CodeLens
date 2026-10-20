import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.spec.{ts,tsx}'],
    setupFiles: ['./test/setup.ts'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      // Pages are thin server components over these; they are exercised by the build.
      include: ['src/lib/**/*.ts', 'src/components/**/*.tsx'],
      exclude: ['src/**/*.spec.{ts,tsx}', 'src/lib/api.ts', 'src/lib/types.ts'],
      reporter: ['text-summary', 'lcov', 'html'],
      thresholds: { lines: 85, statements: 85, functions: 85, branches: 80 },
    },
  },
});
