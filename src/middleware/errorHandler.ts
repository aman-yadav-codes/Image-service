import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Central Express error handler.
 * Must have 4 parameters so Express recognises it as an error handler.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      statusCode: err.statusCode,
      error: err.error,
      message: err.message,
    });
    return;
  }

  // Multer file size error
  if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === 'LIMIT_FILE_SIZE'
  ) {
    res.status(413).json({
      statusCode: 413,
      error: 'Payload Too Large',
      message: 'File exceeds the maximum allowed size',
    });
    return;
  }

  // Unknown error
  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
  res.status(500).json({
    statusCode: 500,
    error: 'Internal Server Error',
    message: 'An unexpected error occurred',
  });
}
