import multer from 'multer';
import { AppError } from '../utils/errors.js';
import { config } from '../config/index.js';

/**
 * Unified upload middleware — accepts images, videos, PDFs, and Excel files.
 * Auto-detection happens by MIME type in the service layer.
 * Max file size: 500 MB (covers large videos).
 */

const ALLOWED_MIME_TYPES = new Set(config.media.allowedMimeTypes);

export const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.media.maxFileSizeBytes, files: 1 },
  fileFilter(_req, file, cb) {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        AppError.unsupportedMedia(
          `File type "${file.mimetype}" is not supported. ` +
          `Accepted types: images (jpeg/png/webp/gif/tiff/avif), ` +
          `videos (mp4/webm/mov/mkv/mpeg/avi), ` +
          `PDF, and Excel (xls/xlsx/csv).`,
        ),
      );
    }
  },
});
