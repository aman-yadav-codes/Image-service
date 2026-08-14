import 'dotenv/config';
import * as http from 'http';
import gracefulShutdown from 'http-graceful-shutdown';
import { createApp } from './app.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { mediaQueue, mediaQueueEvents } from '../queues/mediaQueue.js';
import { markMediaVariantCompleted, markMediaFailed } from '../services/mediaService.js';
import type { MediaJobData } from '../types/media.js';

async function start(): Promise<void> {
  const app = createApp();
  const server = http.createServer(app);

  // ── Media queue event listeners ─────────────────────────────────────────────
  mediaQueueEvents.on('completed', async ({ jobId }) => {
    try {
      const job = await mediaQueue.getJob(jobId);
      if (!job) return;
      const data = job.data as MediaJobData;
      const { mediaId, kind, variant } = data;

      // Determine the storage filename based on kind + variant
      let filename: string;
      if (kind === 'image') {
        filename = variant === 'print' ? 'print.jpg' : `${variant}.webp`;
      } else if (kind === 'video') {
        filename = `${variant}.mp4`;
      } else if (kind === 'pdf') {
        filename = 'compressed.pdf';
      } else {
        // excel — original file
        filename = data.originalFilename;
      }

      await markMediaVariantCompleted(mediaId, variant, filename);
    } catch (err) {
      logger.error({ err, jobId }, 'Failed to handle media completion event');
    }
  });

  mediaQueueEvents.on('failed', async ({ jobId, failedReason }) => {
    try {
      const job = await mediaQueue.getJob(jobId);
      if (!job) return;
      await markMediaFailed((job.data as MediaJobData).mediaId, failedReason);
    } catch (err) {
      logger.error({ err, jobId }, 'Failed to handle media failure event');
    }
  });

  server.listen(config.api.port, config.api.host, () =>
    logger.info({ port: config.api.port, host: config.api.host, env: config.env }, '🚀 Media API listening'),
  );

  gracefulShutdown(server, {
    timeout: 10_000,
    signals: 'SIGINT SIGTERM',
    onShutdown: async () => {
      await mediaQueue.close();
      await mediaQueueEvents.close();
    },
    finally: () => logger.info('Server shut down'),
  });
}

start().catch((err) => {
  logger.error({ err }, 'Failed to start server');
  process.exit(1);
});
