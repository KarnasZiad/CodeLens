import { Redis } from 'ioredis';

/** BullMQ workers block on Redis commands, which requires no per-request retry limit. */
export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: true, lazyConnect: false });
}
