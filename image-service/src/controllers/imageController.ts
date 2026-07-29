import type { Request, Response, NextFunction } from 'express';
import { uploadImage, getImageStatus } from '../services/imageService.js';
import { getPublicFileRef } from '../services/metadataService.js';
import { AppError } from '../utils/errors.js';
import { storage } from '../storage/index.js';
import { IMAGE_VARIANTS } from '../types/index.js';
import type { ImageVariant } from '../types/index.js';
import { getPreset } from '../presets/index.js';

// ─── POST /images/upload ──────────────────────────────────────────────────────

export async function handleUpload(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) {
      throw AppError.badRequest(
        'No file uploaded. Use multipart/form-data with field name "image".',
      );
    }

    // Optional slug from form-data text field or JSON body
    const slug = (req.body?.slug as string | undefined)?.trim() || undefined;

    const result = await uploadImage({
      buffer:       req.file.buffer,
      originalname: req.file.originalname,
      mimetype:     req.file.mimetype,
      size:         req.file.size,
      slug,
    });

    res.status(202).json(result);
  } catch (err) {
    next(err);
  }
}

// ─── GET /images/:id  (status poll) ──────────────────────────────────────────

export async function handleGetStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const result  = await getImageStatus(id);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

// ─── GET /images/:id/:variant  (legacy direct serve) ─────────────────────────
//
// Still supported for tooling / internal use.
// Public clients should use the SEO route instead.

export async function handleServeVariant(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id, variant } = req.params as { id: string; variant: string };

    if (!IMAGE_VARIANTS.includes(variant as ImageVariant)) {
      throw AppError.notFound(
        `Variant "${variant}" is not valid. Available: ${IMAGE_VARIANTS.join(', ')}`,
      );
    }

    const preset     = getPreset(variant as ImageVariant);
    const filename   = preset.filename;
    const fileExists = await storage.exists(id, filename);

    if (!fileExists) {
      throw AppError.notFound(
        `Variant "${variant}" is not yet ready for image "${id}". ` +
        `Poll GET /images/${id} until status is "completed".`,
      );
    }

    setImageHeaders(res, id, variant, filename);
    const stream = await storage.createReadStream(id, filename);
    stream.on('error', (err) => next(err));
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
}

// ─── GET /images/:seoFilename.webp  (SEO public serve) ───────────────────────
//
// Resolves "blue-running-shoes-display-550e8400.webp" → internal image + variant.
// Uses an O(1) Redis lookup — no filename parsing required.

export async function handleServeBySeoFilename(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { seoFilename } = req.params as { seoFilename: string };

    // The router regexp captures the full public filename (with extension)
    const publicFilename = seoFilename;

    // O(1) Redis reverse-lookup
    const ref = await getPublicFileRef(publicFilename);

    if (!ref) {
      throw AppError.notFound(
        `File "${publicFilename}" not found. ` +
        `Ensure the image has been uploaded and has finished processing.`,
      );
    }

    // Check the variant has been processed (file exists in storage)
    const fileExists = await storage.exists(ref.imageId, ref.storageFilename);
    if (!fileExists) {
      throw AppError.notFound(
        `File "${publicFilename}" exists but processing is not yet complete. ` +
        `Poll GET /images/${ref.imageId} until status is "completed".`,
      );
    }

    setImageHeaders(res, ref.imageId, ref.variant, ref.storageFilename);
    res.setHeader('X-Public-Filename', publicFilename);

    const stream = await storage.createReadStream(ref.imageId, ref.storageFilename);
    stream.on('error', (err) => next(err));
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
}

// ─── GET /health ──────────────────────────────────────────────────────────────

export function handleHealth(_req: Request, res: Response): void {
  res.status(200).json({
    status:    'ok',
    service:   'image-api',
    timestamp: new Date().toISOString(),
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setImageHeaders(res: Response, imageId: string, variant: string, filename: string): void {
  let contentType = 'image/webp';
  if (filename.endsWith('.png')) {
    contentType = 'image/png';
  } else if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) {
    contentType = 'image/jpeg';
  }

  res.setHeader('Content-Type',    contentType);
  res.setHeader('Cache-Control',   'public, max-age=31536000, immutable');
  res.setHeader('X-Image-Id',      imageId);
  res.setHeader('X-Image-Variant', variant);
}
