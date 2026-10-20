import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { MIGRATIONS_DIR } from './paths.js';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

export function createDatabase(url: string): { db: Database; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000 });
  return { db: drizzle(pool, { schema, casing: 'snake_case' }), pool };
}

// Arbitrary but fixed: every instance of CodeLens contends for the same lock.
const MIGRATION_LOCK = 7_243_118_201;

/**
 * Applies the pending migrations under an advisory lock, so that several replicas starting at once
 * never run the same migration twice.
 */
export async function runMigrations(
  pool: pg.Pool,
  migrationsFolder = MIGRATIONS_DIR,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => undefined);
    client.release();
  }
}
