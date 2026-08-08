import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import rateLimit from 'express-rate-limit';
import { imageRouter } from '../routes/images.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

import { metricsMiddleware } from '../utils/metrics.js';

// ─── App Factory ──────────────────────────────────────────────────────────────

export function createApp() {
  const app = express();

  // ── CORS ─────────────────────────────────────────────────────────────────────
  // Allow all origins for now — tighten to specific domains before going live.
  app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
  app.options('*', cors()); // handle preflight for all routes

  // ── Metrics ─────────────────────────────────────────────────────────────────
  app.use(metricsMiddleware);

  // ── Security ────────────────────────────────────────────────────────────────
  app.use(helmet());
  app.disable('x-powered-by');

  // ── Request Logging ─────────────────────────────────────────────────────────
  app.use(
    pinoHttp({
      logger,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
      customLogLevel(_req, res) {
        if (res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    }),
  );

  // ── Body Parsing ────────────────────────────────────────────────────────────
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));

  // ── Rate Limiting ────────────────────────────────────────────────────────────
  app.use(
    rateLimit({
      windowMs: config.api.rateLimitWindowMs,
      max: config.api.rateLimitMax,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        statusCode: 429,
        error: 'Too Many Requests',
        message: 'You have exceeded the request rate limit. Please slow down.',
      },
    }),
  );

  // ── Routes ───────────────────────────────────────────────────────────────────
  app.use('/', imageRouter);

  // ── 404 ──────────────────────────────────────────────────────────────────────
  app.use((_req, res) => {
    res.status(404).json({
      statusCode: 404,
      error: 'Not Found',
      message: 'The requested resource does not exist',
    });
  });

  // ── Error Handler ─────────────────────────────────────────────────────────────
  app.use(errorHandler);

  return app;
}
