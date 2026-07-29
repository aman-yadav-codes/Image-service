import { Redis } from 'ioredis';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const redisOptions = {
  host: config.redis.host,
  port: config.redis.port,
  ...(config.redis.password ? { password: config.redis.password } : {}),
  db: config.redis.db,
  ...(config.redis.tls ? { tls: {} } : {}),
  maxRetriesPerRequest: null, // required by BullMQ
  enableReadyCheck: false,
  lazyConnect: true,
  retryStrategy(times: number) {
    const delay = Math.min(times * 500, 5_000);
    logger.warn({ times, delay }, 'Redis reconnecting...');
    return delay;
  },
};

/**
 * Shared Redis connection for BullMQ queues and subscribers.
 * BullMQ requires separate connections per role (queue vs. worker vs. events).
 * Use createRedisConnection() to produce isolated connections.
 */
export function createRedisConnection(): Redis {
  const client = new Redis(redisOptions);

  client.on('connect', () => logger.info({ host: config.redis.host, port: config.redis.port }, 'Redis connected'));
  client.on('error', (err: Error) => logger.error({ err }, 'Redis error'));
  client.on('close', () => logger.warn('Redis connection closed'));

  return client;
}

/** Singleton connection for metadata reads/writes (not BullMQ) */
export const redis = createRedisConnection();
