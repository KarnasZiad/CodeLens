import { randomBytes, randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';
import { MongoClient } from 'mongodb';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { createDatabase } from '../../src/infrastructure/database.js';
import { createRedis } from '../../src/infrastructure/redis.js';
import { SecretBox } from '../../src/lib/secret-box.js';
import {
  RedisPendingSignInStore,
  RedisSessionStore,
} from '../../src/modules/auth/auth-stores.redis.js';
import { PostgresDashboardRepository } from '../../src/modules/dashboard/dashboard-repository.postgres.js';
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
import { FakeGitHubOAuth } from '../../src/testing/auth-doubles.js';
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

const oauth = new FakeGitHubOAuth();
const app = createApp({
  config: { GITHUB_WEBHOOK_SECRETS: [WEBHOOK_SECRET], TRUST_PROXY_HOPS: 0 },
  logger: silentLogger,
  deliveries: new MongoDeliveryStore(mongo.db('codelens-pipeline')),
  webhooks: new WebhookHandler({ reviews, queue, logger: silentLogger }),
  health: { postgres: () => pool.query('select 1'), redis: () => redis.ping() },
  auth: {
    oauth,
    sessions: new RedisSessionStore(redis, new SecretBox(randomBytes(32))),
    pending: new RedisPendingSignInStore(redis),
    config: { PUBLIC_URL: 'https://codelens.test', COOKIE_SECURE: true, SESSION_HOURS: 8 },
  },
  dashboard: new PostgresDashboardRepository(db),
});

/** The whole sign-in, through the real Redis stores: returns the session Cookie header. */
async function signIn(): Promise<string> {
  const login = await request(app).get('/api/auth/github/login');
  const state = new URL(String(login.headers.location)).searchParams.get('state') ?? '';
  const callback = await request(app)
    .get(`/api/auth/github/callback?code=${FakeGitHubOAuth.CODE}&state=${state}`)
    .set('cookie', `__Host-codelens_oauth=${state}`);
  const cookies = callback.headers['set-cookie'] as unknown as string[];
  const session = cookies.find((cookie) => cookie.startsWith('__Host-codelens_session='));
  return session?.split(';')[0] ?? '';
}

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

describe('dashboard on real data', () => {
  it('signs in, then shows repositories, pull requests, the review and the trends', async () => {
    const delivered = await deliver(pullRequestPayload());
    const runId = delivered.body.runId as string;
    await settled(runId);
    const cookie = await signIn();
    expect(cookie).toMatch(/^__Host-codelens_session=/);

    const repositories = await request(app).get('/api/repositories').set('cookie', cookie);
    expect(repositories.body.items).toEqual([
      expect.objectContaining({
        id: 1001,
        fullName: 'acme/shop',
        openPullRequests: 1,
        lastGate: 'passed',
      }),
    ]);

    const pulls = await request(app).get('/api/repositories/acme/shop/pulls').set('cookie', cookie);
    expect(pulls.body.items[0]).toMatchObject({
      number: 7,
      author: 'amina',
      latestRun: { id: runId, status: 'completed', gateStatus: 'passed', findingsCount: 1 },
    });

    const run = await request(app).get(`/api/runs/${runId}`).set('cookie', cookie);
    expect(run.body).toMatchObject({
      repository: { id: 1001, fullName: 'acme/shop' },
      pullRequest: { number: 7, title: 'Add the cart' },
      findings: [{ analyzer: 'debug-statements', rule: 'debugger', severity: 'major', line: 1 }],
    });

    const trends = await request(app)
      .get('/api/repositories/acme/shop/trends?days=30')
      .set('cookie', cookie);
    expect(trends.body).toMatchObject({
      days: 30,
      gate: { passed: 1, failed: 0 },
      weekly: [{ analyzer: 'debug-statements', findings: 1 }],
    });

    await request(app)
      .post('/api/auth/logout')
      .set('cookie', cookie)
      .set('origin', 'https://codelens.test')
      .expect(204);
    expect((await request(app).get('/api/repositories').set('cookie', cookie)).status).toBe(401);
  });

  it('hides the repositories the user cannot see on GitHub', async () => {
    const delivered = await deliver(pullRequestPayload());
    const runId = delivered.body.runId as string;
    await settled(runId);
    oauth.repositoriesByToken.set('ghu_amina', [999]);
    try {
      const cookie = await signIn();
      expect(
        (await request(app).get('/api/repositories').set('cookie', cookie)).body.items,
      ).toEqual([]);
      expect(
        (await request(app).get('/api/repositories/acme/shop/pulls').set('cookie', cookie)).status,
      ).toBe(404);
      expect((await request(app).get(`/api/runs/${runId}`).set('cookie', cookie)).status).toBe(404);
    } finally {
      oauth.repositoriesByToken.set('ghu_amina', [1001]);
    }
  });
});
