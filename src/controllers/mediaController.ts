import type { Request, Response, NextFunction } from 'express';
import { uploadMedia, getMediaStatus } from '../services/mediaService.js';
import { storage } from '../storage/index.js';
import { AppError } from '../utils/errors.js';

export async function handleMediaUpload(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) throw AppError.badRequest('No file uploaded. Use multipart/form-data with field name "file".');
    res.status(202).json(await uploadMedia({
      buffer: req.file.buffer,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
    }));
  } catch (err) { next(err); }
}

export async function handleMediaStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { res.status(200).json(await getMediaStatus(req.params.id)); }
  catch (err) { next(err); }
}

export async function handleMediaVariant(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const meta = await getMediaStatus(req.params.id);
    const filename = meta.variants[req.params.variant];
    if (!filename) throw AppError.notFound(`Media variant "${req.params.variant}" is not ready.`);
    if (!(await storage.exists(meta.id, filename))) throw AppError.notFound('Processed file is not available.');
    const contentType = filename.endsWith('.mp4') ? 'video/mp4' : filename.endsWith('.jpg') ? 'image/jpeg' : 'application/pdf';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    const stream = await storage.createReadStream(meta.id, filename);
    stream.on('error', next);
    stream.pipe(res);
  } catch (err) { next(err); }
}
