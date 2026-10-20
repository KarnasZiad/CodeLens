import { type Db, MongoClient } from 'mongodb';

export const DELIVERY_RETENTION_SECONDS = 7 * 24 * 3600;
export const REPORT_RETENTION_SECONDS = 90 * 24 * 3600;

export async function connectMongo(
  url: string,
  database: string,
): Promise<{ client: MongoClient; db: Db }> {
  const client = new MongoClient(url, { serverSelectionTimeoutMS: 5000, appName: 'codelens' });
  await client.connect();
  return { client, db: client.db(database) };
}

/** Idempotent: TTL indexes make MongoDB itself enforce the retention periods. */
export async function ensureIndexes(db: Db): Promise<void> {
  await db
    .collection('webhook_deliveries')
    .createIndex(
      { receivedAt: 1 },
      { name: 'ttl', expireAfterSeconds: DELIVERY_RETENTION_SECONDS },
    );
  await db
    .collection('review_reports')
    .createIndex({ createdAt: 1 }, { name: 'ttl', expireAfterSeconds: REPORT_RETENTION_SECONDS });
}
