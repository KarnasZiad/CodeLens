import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import { MongoClient } from 'mongodb';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { createDatabase } from '../../src/infrastructure/database.js';
import { createRedis } from '../../src/infrastructure/redis.js';
import { PermanentProviderError, RateLimitedError } from '../../src/modules/github/git-provider.js';
import { MongoReportStore } from '../../src/modules/reviews/report-store.mongo.js';
import {
  BullMqReviewQueue,
  startReviewWorker,
} from '../../src/modules/reviews/review-queue.bullmq.js';
import { REVIEW_QUEUE } from '../../src/modules/reviews/review-queue.js';
import { ReviewProcessor } from '../../src/modules/reviews/review-processor.js';
import { PostgresReviewRepository } from '../../src/modules/reviews/review-repository.postgres.js';
import { MongoDeliveryStore } from '../../src/modules/webhooks/delivery-store.mongo.js';
import { WebhookHandler } from '../../src/modules/webhooks/webhook-handler.js';
import { FakeGitProvider } from '../../src/testing/fake-git-provider.js';
import {
  githubHeaders,
  NEXT_SHA,
  pullRequestPayload,
  silentLogger,
  WEBHOOK_SECRET,
} from '../../src/testing/fixtures.js';

const { db, pool } = createDatabase(inject('postgresUrl'));
const mongo = new MongoClient(inject('mongoUrl'));
const redis = createRedis(inject('redisUrl'));
const reviews = new PostgresReviewRepository(db);
const queue = new BullMqReviewQueue(new Queue(REVIEW_QUEUE, { connection: redis }));
const provider = new FakeGitProvider();
const processor = new ReviewProcessor({
  reviews,
  reports: new MongoReportStore(mongo.db('codelens-pipeline')),
  provider,
  logger: silentLogger,
});
const worker = startReviewWorker({
  connection: redis,
  processor,
  concurrency: 2,
  logger: silentLogger,
});

const app = createApp({
  config: { GITHUB_WEBHOOK_SECRETS: [WEBHOOK_SECRET], TRUST_PROXY_HOPS: 0 },
  logger: silentLogger,
  deliveries: new MongoDeliveryStore(mongo.db('codelens-pipeline')),
  webhooks: new WebhookHandler({ reviews, queue, logger: silentLogger }),
  health: { postgres: () => pool.query('select 1'), redis: () => redis.ping() },
});

function deliver(payload: unknown, deliveryId: string = randomUUID()) {
  const body = JSON.stringify(payload);
  return request(app)
    .post('/webhooks/github')
    .set(githubHeaders('pull_request', body, deliveryId))
    .send(body);
}

async function runOf(runId: string) {
  const { rows } = await pool.query<{
    status: string;
    conclusion: string | null;
    error: string | null;
  }>('select status, conclusion, error from review_runs where id = $1', [runId]);
  return rows[0];
}

async function settled(runId: string) {
  await vi.waitFor(
    async () => {
      expect(['completed', 'failed']).toContain((await runOf(runId))?.status);
    },
    { timeout: 20_000, interval: 100 },
  );
  return runOf(runId);
}

beforeEach(async () => {
  await db.execute(sql`truncate installations cascade`);
  provider.files = [
    {
      path: 'src/cart.ts',
      status: 'modified',
      additions: 1,
      deletions: 0,
      patch: '@@ -0,0 +1 @@\n+debugger;',
    },
  ];
  provider.failures.clear();
});

afterAll(async () => {
  await worker.close();
  await queue.close();
  await redis.quit();
  await mongo.close();
  await pool.end();
});

describe('from webhook to published check', () => {
  it('reviews a pull request end to end', async () => {
    const response = await deliver(pullRequestPayload());
    expect(response.status).toBe(202);
    const { runId } = response.body as { runId: string };

    expect(await settled(runId)).toEqual({
      status: 'completed',
      conclusion: 'success',
      error: null,
    });
    const { rows } = await pool.query('select rule, severity from findings where run_id = $1', [
      runId,
    ]);
    expect(rows).toEqual([{ rule: 'debugger', severity: 'major' }]);
    const check = [...provider.checks.values()].find((item) => item.externalId === runId);
    expect(check?.result?.annotations).toHaveLength(1);

    const ready = await request(app).get('/health/ready');
    expect(ready.body).toEqual({ status: 'up', dependencies: { postgres: 'up', redis: 'up' } });
  });

  it('ignores a duplicate delivery and reviews each commit once', async () => {
    const deliveryId = randomUUID();
    const first = await deliver(pullRequestPayload(), deliveryId);
    const duplicate = await deliver(pullRequestPayload(), deliveryId);
    const sameCommit = await deliver(pullRequestPayload({ action: 'reopened' }));

    expect(duplicate.body).toEqual({ status: 'duplicate' });
    // Depending on how fast the worker is, the run is still queued or already reviewed.
    expect([
      { status: 'queued', runId: first.body.runId },
      { status: 'ignored', reason: 'commit already reviewed' },
    ]).toContainEqual(sameCommit.body);
    await settled(first.body.runId as string);
    const { rows } = await pool.query<{ count: string }>('select count(*) from review_runs');
    expect(Number(rows[0]?.count)).toBe(1);
  });

  it('waits out a GitHub rate limit without consuming an attempt', async () => {
    provider.failures.set('listFiles', new RateLimitedError(300));
    const response = await deliver(pullRequestPayload({ sha: NEXT_SHA }));

    expect(await settled(response.body.runId as string)).toMatchObject({ status: 'completed' });
  });

  it('fails at once, with a neutral check, when GitHub refuses access', async () => {
    provider.failures.set('listFiles', new PermanentProviderError('GitHub answered 403', 403));
    const response = await deliver(pullRequestPayload());
    const runId = response.body.runId as string;

    await vi.waitFor(
      async () => {
        expect(await runOf(runId)).toMatchObject({ status: 'failed', conclusion: 'neutral' });
        const check = [...provider.checks.values()].find((item) => item.externalId === runId);
        expect(check?.result).toMatchObject({ conclusion: 'neutral', title: 'Analyse impossible' });
      },
      { timeout: 20_000, interval: 100 },
    );
  });
});
