import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  DELIVERY_RETENTION_SECONDS,
  ensureIndexes,
  REPORT_RETENTION_SECONDS,
} from '../../src/infrastructure/mongo.js';
import { MongoReportStore } from '../../src/modules/reviews/report-store.mongo.js';
import { MongoDeliveryStore } from '../../src/modules/webhooks/delivery-store.mongo.js';

const client = new MongoClient(inject('mongoUrl'));
const db = client.db('codelens-tests');
const deliveries = new MongoDeliveryStore(db);
const reports = new MongoReportStore(db);

const delivery = (id: string) => ({
  id,
  event: 'pull_request',
  action: 'opened',
  installationId: 42,
  repositoryId: 1001,
  payload: { action: 'opened' },
  receivedAt: new Date(),
});

beforeAll(async () => {
  await client.connect();
  await ensureIndexes(db);
  await ensureIndexes(db);
});

afterAll(async () => {
  await db.dropDatabase();
  await client.close();
});

describe('MongoDeliveryStore', () => {
  it('lets exactly one of several concurrent identical deliveries through', async () => {
    const id = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => deliveries.begin(delivery(id))),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('handles a redelivery only when the previous attempt failed', async () => {
    const id = randomUUID();
    expect(await deliveries.begin(delivery(id))).toBe(true);
    await deliveries.fail(id, 'Redis unreachable');
    expect(await deliveries.begin(delivery(id))).toBe(true);
    await deliveries.finish(id, 'processed');
    expect(await deliveries.begin(delivery(id))).toBe(false);

    const stored = await db.collection('webhook_deliveries').findOne({ _id: id as never });
    expect(stored).toMatchObject({ status: 'processed', attempts: 2, event: 'pull_request' });
    expect(stored).not.toHaveProperty('error');
  });

  it('expires deliveries and reports through TTL indexes', async () => {
    const ttl = async (collection: string) =>
      (await db.collection(collection).indexes()).find((index) => index.name === 'ttl')
        ?.expireAfterSeconds;
    expect(await ttl('webhook_deliveries')).toBe(DELIVERY_RETENTION_SECONDS);
    expect(await ttl('review_reports')).toBe(REPORT_RETENTION_SECONDS);
  });
});

describe('MongoReportStore', () => {
  it('replaces the report of a retried run', async () => {
    const runId = randomUUID();
    const report = {
      runId,
      repository: 'acme/shop',
      pullRequest: 7,
      headSha: 'a'.repeat(40),
      configSource: 'default' as const,
      config: null,
      configErrors: [],
      result: null,
      createdAt: new Date(),
    };
    await reports.save(report);
    await reports.save({ ...report, configSource: 'file' });

    expect(await reports.find(runId)).toMatchObject({ runId, configSource: 'file' });
    expect(await db.collection('review_reports').countDocuments({ _id: runId as never })).toBe(1);
    expect(await reports.find(randomUUID())).toBeNull();
  });
});
