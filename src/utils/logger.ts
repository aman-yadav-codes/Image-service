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
      service: 'image-service',
      env: config.env,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  },
  transport,
);

export type Logger = typeof logger;
