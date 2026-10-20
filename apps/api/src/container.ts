import type { Logger } from 'pino';
import type { ApiConfig } from './config.js';
import { createDatabase } from './infrastructure/database.js';
import { connectMongo, ensureIndexes } from './infrastructure/mongo.js';
import { createRedis } from './infrastructure/redis.js';
import { BullMqReviewQueue } from './modules/reviews/review-queue.bullmq.js';
import { PostgresReviewRepository } from './modules/reviews/review-repository.postgres.js';
import { MongoDeliveryStore } from './modules/webhooks/delivery-store.mongo.js';
import { WebhookHandler } from './modules/webhooks/webhook-handler.js';
import type { AppDeps } from './app.js';

type Connections = Pick<
  ApiConfig,
  'DATABASE_URL' | 'MONGODB_URL' | 'MONGODB_DATABASE' | 'REDIS_URL'
>;

/** Opens the connections shared by the API and the worker; `close` releases them all. */
export async function connect(config: Connections) {
  const { db, pool } = createDatabase(config.DATABASE_URL);
  const mongo = await connectMongo(config.MONGODB_URL, config.MONGODB_DATABASE);
  await ensureIndexes(mongo.db);
  const redis = createRedis(config.REDIS_URL);
  return {
    db,
    pool,
    mongo,
    redis,
    reviews: new PostgresReviewRepository(db),
    health: {
      postgres: () => pool.query('SELECT 1'),
      mongodb: () => mongo.db.command({ ping: 1 }),
      redis: () => redis.ping(),
    },
    close: async () => {
      await Promise.allSettled([pool.end(), mongo.client.close(), redis.quit()]);
    },
  };
}

export async function buildApiDeps(config: ApiConfig, logger: Logger) {
  const connections = await connect(config);
  const queue = BullMqReviewQueue.create(connections.redis);
  const deps: AppDeps = {
    config,
    logger,
    deliveries: new MongoDeliveryStore(connections.mongo.db),
    webhooks: new WebhookHandler({ reviews: connections.reviews, queue, logger }),
    health: connections.health,
  };
  return {
    deps,
    close: async () => {
      await queue.close();
      await connections.close();
    },
  };
}
