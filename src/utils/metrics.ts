import client from 'prom-client';
import type { Request, Response, NextFunction } from 'express';
import { imageQueue } from '../queues/imageQueue.js';
import { logger } from './logger.js';

// ─── Initialize Registry ──────────────────────────────────────────────────────

export const registry = new client.Registry();

// Enable default Node.js system/process metrics (CPU, Memory, Event Loop, etc.)
client.collectDefaultMetrics({ register: registry });

// ─── Custom Metrics ───────────────────────────────────────────────────────────

/** HTTP request duration tracker */
const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
});
registry.registerMetric(httpRequestDuration);

/** Total HTTP requests counter */
const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests processed',
  labelNames: ['method', 'route', 'status_code'],
});
registry.registerMetric(httpRequestsTotal);

/** Total image uploads counter */
export const imageUploadsTotal = new client.Counter({
  name: 'image_uploads_total',
  help: 'Total number of uploaded images',
  labelNames: ['status'], // success, error
});
registry.registerMetric(imageUploadsTotal);

/** Image upload file size tracker */
export const imageUploadSizeBytes = new client.Histogram({
  name: 'image_upload_size_bytes',
  help: 'Size of uploaded image files in bytes',
  buckets: [1024 * 100, 1024 * 500, 1024 * 1024, 1024 * 1024 * 5, 1024 * 1024 * 10, 1024 * 1024 * 20],
});
registry.registerMetric(imageUploadSizeBytes);

// ─── BullMQ Queue Gauges ──────────────────────────────────────────────────────

const queueJobsGauge = new client.Gauge({
  name: 'bullmq_queue_jobs_total',
  help: 'Total number of jobs in the image processing queue grouped by status',
  labelNames: ['queue', 'status'],
});
registry.registerMetric(queueJobsGauge);

/**
 * Polls queue counts from Redis and updates the gauge.
 * Called dynamically right before metrics scrape to ensure fresh data.
 */
async function updateQueueMetrics(): Promise<void> {
  try {
    const queueName = imageQueue.name;
    const counts = await imageQueue.getJobCounts(
      'active',
      'completed',
      'failed',
      'waiting',
      'delayed',
      'paused'
    );

    queueJobsGauge.set({ queue: queueName, status: 'active' }, counts.active);
    queueJobsGauge.set({ queue: queueName, status: 'completed' }, counts.completed);
    queueJobsGauge.set({ queue: queueName, status: 'failed' }, counts.failed);
    queueJobsGauge.set({ queue: queueName, status: 'waiting' }, counts.waiting);
    queueJobsGauge.set({ queue: queueName, status: 'delayed' }, counts.delayed);
    queueJobsGauge.set({ queue: queueName, status: 'paused' }, counts.paused);
  } catch (err) {
    logger.error({ err }, 'Failed to retrieve BullMQ queue metrics');
  }
}

// ─── Express Middleware ───────────────────────────────────────────────────────

/**
 * Middleware to measure HTTP request duration and count total requests.
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Avoid tracking metrics route itself to prevent infinite increment loops
  if (req.path === '/metrics') {
    next();
    return;
  }

  const start = process.hrtime();

  res.on('finish', () => {
    const duration = getDurationInSeconds(start);
    const route = req.route ? req.route.path : req.path;
    const labels = {
      method: req.method,
      route,
      status_code: res.statusCode.toString(),
    };

    httpRequestDuration.observe(labels, duration);
    httpRequestsTotal.inc(labels);
  });

  next();
}

function getDurationInSeconds(start: [number, number]): number {
  const diff = process.hrtime(start);
  return diff[0] + diff[1] / 1e9;
}

// ─── Route Handler ────────────────────────────────────────────────────────────

/**
 * Endpoint controller to expose Prometheus metrics.
 */
export async function handleMetrics(req: Request, res: Response): Promise<void> {
  await updateQueueMetrics();
  res.set('Content-Type', registry.contentType);
  res.end(await registry.metrics());
}
