import { defineConfig } from 'drizzle-kit';

// `pnpm db:generate` diffs the schema against the previous migrations: no database needed.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/infrastructure/schema.ts',
  out: './drizzle',
  casing: 'snake_case',
  strict: true,
});
