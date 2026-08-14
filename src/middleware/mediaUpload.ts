import multer from 'multer';
import { config } from '../config/index.js';
import { AppError } from '../utils/errors.js';

export const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.media.maxFileSizeBytes, files: 1 },
  fileFilter(_req, file, cb) {
    if (config.media.allowedMimeTypes.includes(file.mimetype)) cb(null, true);
    else cb(AppError.unsupportedMedia(`File type "${file.mimetype}" is not supported for media processing.`));
  },
});
