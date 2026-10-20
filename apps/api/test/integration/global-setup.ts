import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { GenericContainer, Wait } from 'testcontainers';
import type { TestProject } from 'vitest/node';
import { createDatabase, runMigrations } from '../../src/infrastructure/database.js';

declare module 'vitest' {
  export interface ProvidedContext {
    postgresUrl: string;
    mongoUrl: string;
    redisUrl: string;
  }
}

/** One PostgreSQL, MongoDB and Redis for the whole suite; migrations applied once. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const [postgres, mongo, redis] = await Promise.all([
    new PostgreSqlContainer('postgres:17-alpine').withDatabase('codelens').start(),
    // Standalone server: CodeLens needs no replica set (no multi-document transactions).
    new GenericContainer('mongo:8.0')
      .withExposedPorts(27017)
      // Waiting on the listening port, not on log lines: log streams proved unreliable on CI.
      .withWaitStrategy(Wait.forListeningPorts())
      .withStartupTimeout(60_000)
      .start(),
    new RedisContainer('redis:7.4-alpine').start(),
  ]);

  const { pool } = createDatabase(postgres.getConnectionUri());
  await runMigrations(pool);
  await pool.end();

  project.provide('postgresUrl', postgres.getConnectionUri());
  project.provide('mongoUrl', `mongodb://${mongo.getHost()}:${mongo.getMappedPort(27017)}`);
  project.provide('redisUrl', redis.getConnectionUrl());

  return async () => {
    await Promise.all([postgres.stop(), mongo.stop(), redis.stop()]);
  };
}
