import multer from 'multer';
import { config } from '../config/index.js';
import { AppError } from '../utils/errors.js';

/**
 * Multer is configured with memory storage — we handle writing to disk/cloud
 * ourselves in ImageService so the storage abstraction is respected.
 */
export const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: config.api.maxFileSizeBytes,
    files: 1,
  },

  fileFilter(_req, file, cb) {
    if (config.api.allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        AppError.unsupportedMedia(
          `File type "${file.mimetype}" is not allowed. Accepted: ${config.api.allowedMimeTypes.join(', ')}`,
        ),
      );
    }
  },
});
