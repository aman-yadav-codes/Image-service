import 'dotenv/config';
import { Worker } from 'bullmq';
import sharp from 'sharp';
import { createRedisConnection } from '../config/redis.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { storage } from '../storage/index.js';
import { getPreset } from '../presets/index.js';
import type { ProcessingJobData } from '../types/index.js';

// ─── Worker ───────────────────────────────────────────────────────────────────

logger.info(
  { concurrency: config.queue.concurrency, queue: config.queue.name, storageDriver: config.storage.driver },
  '🔧 Image worker starting',
);

const worker = new Worker<ProcessingJobData>(
  config.queue.name,

  async (job) => {
    const { imageId, variant, originalFilename } = job.data;
    const log = logger.child({ imageId, variant, jobId: job.id });

    log.info('Job started');
    await job.updateProgress(10);

    // ── Load Original from Storage (local disk or MinIO) ──────────────────────
    // storage.readFile abstracts the source — no local path required.
    const originalBuffer = await storage.readFile(imageId, originalFilename);
    log.debug({ bytes: originalBuffer.length }, 'Original loaded from storage');
    await job.updateProgress(30);

    // ── Load Preset ───────────────────────────────────────────────────────────
    const preset = getPreset(variant);

    // ── Transform with Sharp ──────────────────────────────────────────────────
    const pipeline    = sharp(originalBuffer, {
      failOn: 'error',
      limitInputPixels: config.image.maxImagePixels,
    });
    const outputBuffer = await preset.transform(pipeline).toBuffer();
    log.debug({ outputBytes: outputBuffer.length }, 'Sharp transform complete');
    await job.updateProgress(80);

    // ── Save Output to Storage ────────────────────────────────────────────────
    await storage.save(imageId, preset.filename, outputBuffer, 'image/webp');
    log.info({ filename: preset.filename }, 'Variant saved to storage');

    await job.updateProgress(100);
  },

  {
    connection:  createRedisConnection(),
    concurrency: config.queue.concurrency,
    limiter: {
      max:      100,
      duration: 1000,
    },
  },
);

// ─── Event Handlers ───────────────────────────────────────────────────────────

worker.on('completed', (job) => {
  logger.info(
    { jobId: job.id, imageId: job.data.imageId, variant: job.data.variant },
    'Job completed ✓',
  );
});

worker.on('failed', (job, err) => {
  logger.error(
    { jobId: job?.id, imageId: job?.data?.imageId, variant: job?.data?.variant, err },
    'Job failed ✗',
  );
});

worker.on('error', (err) => {
  logger.error({ err }, 'Worker error');
});

worker.on('stalled', (jobId) => {
  logger.warn({ jobId }, 'Job stalled — will be retried');
});

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Worker shutting down gracefully...');
  await worker.close();
  logger.info('Worker stopped');
  process.exit(0);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
