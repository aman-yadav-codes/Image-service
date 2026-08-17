import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import rateLimit from 'express-rate-limit';
import { mediaRouter } from '../routes/media.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { metricsMiddleware } from '../utils/metrics.js';

export function createApp() {
  const app = express();

  app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));
  app.options('*', cors());

  app.use(metricsMiddleware);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.disable('x-powered-by');

  app.use(pinoHttp({
    logger,
    redact: ['req.headers.authorization', 'req.headers.cookie'],
    customLogLevel(_req, res) {
      if (res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
  }));

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));

  app.use(rateLimit({
    windowMs: config.api.rateLimitWindowMs,
    max: config.api.rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'You have exceeded the request rate limit. Please slow down.',
    },
  }));

  // All routes live under /media (plus /health and /metrics)
  app.use('/', mediaRouter);

  app.use((_req, res) =>
    res.status(404).json({
      statusCode: 404,
      error: 'Not Found',
      message: 'The requested resource does not exist',
    }),
  );
  app.use(errorHandler);

  return app;
}
