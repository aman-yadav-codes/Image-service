import 'dotenv/config';
import * as http from 'http';
import gracefulShutdown from 'http-graceful-shutdown';
import { createApp } from './app.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { imageQueue, imageQueueEvents } from '../queues/imageQueue.js';
import { mediaQueue, mediaQueueEvents } from '../queues/mediaQueue.js';
import { markVariantCompleted, updateStatus } from '../services/metadataService.js';
import { markMediaVariantCompleted, markMediaFailed } from '../services/mediaService.js';
import { IMAGE_VARIANTS } from '../types/index.js';
import type { ProcessingJobData } from '../types/index.js';
import type { MediaJobData } from '../types/media.js';

async function start(): Promise<void> {
  const app = createApp();
  const server = http.createServer(app);

  imageQueueEvents.on('completed', async ({ jobId }) => {
    try {
      const job = await imageQueue.getJob(jobId); if (!job) return;
      const data = job.data as ProcessingJobData;
      await markVariantCompleted(data.imageId, data.variant, [...IMAGE_VARIANTS]);
    } catch (err) { logger.error({ err, jobId }, 'Failed to handle image completion event'); }
  });
  imageQueueEvents.on('failed', async ({ jobId, failedReason }) => {
    try {
      const job = await imageQueue.getJob(jobId); if (!job) return;
      const data = job.data as ProcessingJobData;
      await updateStatus(data.imageId, 'failed', failedReason);
    } catch (err) { logger.error({ err, jobId }, 'Failed to handle image failure event'); }
  });

  mediaQueueEvents.on('completed', async ({ jobId }) => {
    try {
      const job = await mediaQueue.getJob(jobId); if (!job) return;
      const data = job.data as MediaJobData;
      const filename = data.variant === 'poster' ? 'poster.jpg' : `${data.variant}.${data.kind === 'pdf' ? 'pdf' : 'mp4'}`;
      await markMediaVariantCompleted(data.mediaId, data.variant, filename);
    } catch (err) { logger.error({ err, jobId }, 'Failed to handle media completion event'); }
  });
  mediaQueueEvents.on('failed', async ({ jobId, failedReason }) => {
    try {
      const job = await mediaQueue.getJob(jobId); if (!job) return;
      await markMediaFailed((job.data as MediaJobData).mediaId, failedReason);
    } catch (err) { logger.error({ err, jobId }, 'Failed to handle media failure event'); }
  });

  server.listen(config.api.port, config.api.host, () => logger.info({ port: config.api.port, host: config.api.host, env: config.env }, '🚀 Media API listening'));
  gracefulShutdown(server, {
    timeout: 10_000, signals: 'SIGINT SIGTERM',
    onShutdown: async () => { await imageQueue.close(); await imageQueueEvents.close(); await mediaQueue.close(); await mediaQueueEvents.close(); },
    finally: () => logger.info('Server shut down'),
  });
}
start().catch((err) => { logger.error({ err }, 'Failed to start server'); process.exit(1); });
