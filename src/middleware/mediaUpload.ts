import multer from 'multer';
import { AppError } from '../utils/errors.js';

/**
 * Unified upload middleware — accepts images, videos, PDFs, and Excel files.
 * Auto-detection happens by MIME type in the service layer.
 * Max file size: 500 MB (covers large videos).
 */

const ALLOWED_MIME_TYPES = new Set([
  // Images
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/tiff',
  'image/avif',
  // Videos
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
  'video/mpeg',
  'video/avi',
  // PDFs
  'application/pdf',
  // Excel
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
]);

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB

export const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
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
