import { Router } from 'express';
import { mediaUpload } from '../middleware/mediaUpload.js';
import { handleMediaUpload, handleMediaStatus, handleMediaVariant } from '../controllers/mediaController.js';

export const mediaRouter = Router();

/** POST /media/upload — video or PDF upload */
mediaRouter.post('/media/upload', mediaUpload.single('file'), handleMediaUpload);

/** GET /media/:id — processing status */
mediaRouter.get('/media/:id', handleMediaStatus);

/** GET /media/:id/:variant — stream a processed variant */
mediaRouter.get('/media/:id/:variant', handleMediaVariant);
