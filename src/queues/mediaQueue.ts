import { Queue, QueueEvents } from 'bullmq';
import { createRedisConnection } from '../config/redis.js';
import { config } from '../config/index.js';
import type { MediaJobData, MediaKind, MediaVariant } from '../types/media.js';

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

/**
 * Returns the list of variants to process for each media kind.
 *  - image  → 4 variants (thumbnail, display, large, print) via Sharp
 *  - video  → 3 variants (hd/720p, medium/480p, low/360p) via FFmpeg
 *  - pdf    → 1 variant  (compressed) via Ghostscript
 *  - excel  → 1 variant  (original — stored as-is, no processing)
 */
export function getVariantsForKind(kind: MediaKind): MediaVariant[] {
  switch (kind) {
    case 'image': return ['thumbnail', 'display', 'large', 'print'];
    case 'video': return ['hd', 'medium', 'low'];
    case 'pdf':   return ['compressed'];
    case 'excel': return ['original'];
  }
}

export async function enqueueMediaJobs(data: Omit<MediaJobData, 'variant'>): Promise<void> {
  const variants = getVariantsForKind(data.kind);
  await mediaQueue.addBulk(
    variants.map((variant) => ({
      name: `process:${data.kind}:${variant}`,
      data: { ...data, variant } as MediaJobData,
    })),
  );
}
