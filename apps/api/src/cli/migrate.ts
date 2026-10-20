import { z } from 'zod';
import { createDatabase, runMigrations } from '../infrastructure/database.js';

// Only the database URL: migrations run as a one-off job, before the API and the worker start.
const env = z
  .object({ DATABASE_URL: z.string().regex(/^postgres(ql)?:[/][/]/) })
  .parse(process.env);

const { pool } = createDatabase(env.DATABASE_URL);
try {
  await runMigrations(pool);
  console.log('migrations applied');
} finally {
  await pool.end();
}
