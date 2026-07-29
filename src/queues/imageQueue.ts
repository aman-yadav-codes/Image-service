import { Queue, QueueEvents } from 'bullmq';
import { createRedisConnection } from '../config/redis.js';
import { config } from '../config/index.js';
import type { ProcessingJobData } from '../types/index.js';

/**
 * BullMQ queue for image processing jobs.
 *
 * One queue, two job shapes:
 *   { imageId, variant: "display",   originalFilename, originalMimeType }
 *   { imageId, variant: "thumbnail", originalFilename, originalMimeType }
 *
 * Workers inspect `variant`, load the matching preset, run Sharp.
 * Workers fetch the original via storage.readFile() — no local path needed.
 */
export const imageQueue = new Queue<ProcessingJobData>(config.queue.name, {
  connection: createRedisConnection(),
  defaultJobOptions: {
    attempts: config.queue.maxRetries,
    backoff: {
      type: 'exponential',
      delay: config.queue.backoffDelay,
    },
    removeOnComplete: {
      age:   Math.floor(config.queue.keepCompletedMs / 1000),
      count: 1000,
    },
    removeOnFail: {
      age: Math.floor(config.queue.keepFailedMs / 1000),
    },
  },
});

/**
 * QueueEvents subscribes to worker-emitted events (completed, failed).
 * The API process uses this to update image metadata status in Redis.
 */
export const imageQueueEvents = new QueueEvents(config.queue.name, {
  connection: createRedisConnection(),
});

/**
 * Atomically enqueue processing jobs for all variants of a given image.
 */
export async function enqueueProcessingJobs(
  imageId: string,
  originalFilename: string,
  originalMimeType: string,
): Promise<void> {
  const variants = ['display', 'thumbnail'] as const;

  const jobs = variants.map((variant) => ({
    name: `process:${variant}`,
    data: {
      imageId,
      variant,
      originalFilename,
      originalMimeType,
    } satisfies ProcessingJobData,
  }));

  await imageQueue.addBulk(jobs);
}
