import pino from 'pino';
import { config } from '../config/index.js';

const transport = config.log.pretty
  ? pino.transport({
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    })
  : undefined;

export const logger = pino(
  {
    level: config.log.level,
    base: {
      service: 'media-service',
      env: config.env,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: ['req.headers.x-media-internal-token', 'headers.x-media-internal-token'],
      censor: '[Redacted]',
    },
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  },
  transport,
);

export type Logger = typeof logger;
