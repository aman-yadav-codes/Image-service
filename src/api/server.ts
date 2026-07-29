import 'dotenv/config';
import * as http from 'http';
import gracefulShutdown from 'http-graceful-shutdown';
import { createApp } from './app.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { imageQueue, imageQueueEvents } from '../queues/imageQueue.js';
import { markVariantCompleted, updateStatus } from '../services/metadataService.js';
import { IMAGE_VARIANTS } from '../types/index.js';
import type { ProcessingJobData } from '../types/index.js';

// ─── Start Server ─────────────────────────────────────────────────────────────

async function start(): Promise<void> {
  const app = createApp();
  const server = http.createServer(app);

  // ── Listen to Worker Events ─────────────────────────────────────────────────
  // The API process subscribes to BullMQ events so it can update Redis metadata
  // when workers complete or fail jobs.

  imageQueueEvents.on('completed', async ({ jobId }) => {
    try {
      const job = await imageQueue.getJob(jobId);
      if (!job) return;
      const data = job.data as ProcessingJobData;
      await markVariantCompleted(data.imageId, data.variant, [...IMAGE_VARIANTS]);
    } catch (err) {
      logger.error({ err, jobId }, 'Failed to handle job completed event');
    }
  });

  imageQueueEvents.on('failed', async ({ jobId, failedReason }) => {
    try {
      const job = await imageQueue.getJob(jobId);
      if (!job) return;
      const data = job.data as ProcessingJobData;
      await updateStatus(data.imageId, 'failed', failedReason);
      logger.error({ jobId, imageId: data.imageId, reason: failedReason }, 'Processing job failed');
    } catch (err) {
      logger.error({ err, jobId }, 'Failed to handle job failed event');
    }
  });

  // ── Start HTTP ───────────────────────────────────────────────────────────────
  server.listen(config.api.port, config.api.host, () => {
    logger.info(
      { port: config.api.port, host: config.api.host, env: config.env },
      '🚀 Image API listening',
    );
  });

  // ── Graceful Shutdown ────────────────────────────────────────────────────────
  gracefulShutdown(server, {
    timeout: 10_000,
    signals: 'SIGINT SIGTERM',
    onShutdown: async () => {
      logger.info('Shutting down gracefully...');
      await imageQueue.close();
      await imageQueueEvents.close();
    },
    finally: () => {
      logger.info('Server shut down');
    },
  });
}

start().catch((err) => {
  logger.error({ err }, 'Failed to start server');
  process.exit(1);
});
