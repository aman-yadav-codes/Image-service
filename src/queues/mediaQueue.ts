import { Queue, QueueEvents } from 'bullmq';
import { createRedisConnection } from '../config/redis.js';
import { config } from '../config/index.js';
import type { MediaJobData } from '../types/media.js';

export const mediaQueue = new Queue<MediaJobData>('media-processing', {
  connection: createRedisConnection(),
  defaultJobOptions: {
    attempts: config.queue.maxRetries,
    backoff: { type: 'exponential', delay: config.queue.backoffDelay },
    removeOnComplete: { age: Math.floor(config.queue.keepCompletedMs / 1000), count: 1000 },
    removeOnFail: { age: Math.floor(config.queue.keepFailedMs / 1000) },
  },
});

export const mediaQueueEvents = new QueueEvents('media-processing', {
  connection: createRedisConnection(),
});

export async function enqueueMediaJobs(data: Omit<MediaJobData, 'variant'>): Promise<void> {
  const variants = data.kind === 'video' ? ['720p', '480p', 'poster'] : ['lossless', 'balanced'];
  await mediaQueue.addBulk(variants.map((variant) => ({
    name: `process:${data.kind}:${variant}`,
    data: { ...data, variant } as MediaJobData,
  })));
}
