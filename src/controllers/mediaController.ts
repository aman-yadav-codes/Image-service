import type { Request, Response, NextFunction } from 'express';
import { uploadMedia, getMediaStatus, deleteMedia, updateMedia, replaceMediaFile } from '../services/mediaService.js';
import type { MediaUpdateInput, MediaReplaceInput } from '../services/mediaService.js';
import { storage } from '../storage/index.js';
import { AppError } from '../utils/errors.js';

// ─── MIME type map for streaming ──────────────────────────────────────────────

function contentTypeForFile(filename: string, kind: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    png: 'image/png', gif: 'image/gif', avif: 'image/avif',
    mp4: 'video/mp4', webm: 'video/webm',
    pdf: 'application/pdf',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
    csv: 'text/csv',
  };
  return map[ext] ?? 'application/octet-stream';
}

// ─── POST /media/upload ───────────────────────────────────────────────────────

export async function handleMediaUpload(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) {
      throw AppError.badRequest(
        'No file uploaded. Send a multipart/form-data request with field name "file".',
      );
    }

    const result = await uploadMedia({
      buffer:       req.file.buffer,
      originalname: req.file.originalname,
      mimetype:     req.file.mimetype,
      size:         req.file.size,
      // Optional SEO name from multipart form field `name`
      name:         typeof req.body?.name === 'string' ? req.body.name : undefined,
    });

    res.status(202).json(result);
  } catch (err) {
    next(err);
  }
}

// ─── GET /media/:id ───────────────────────────────────────────────────────────

export async function handleMediaStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await getMediaStatus(req.params.id);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

// ─── GET /media/:id/:variant ──────────────────────────────────────────────────

export async function handleMediaVariant(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    // Strip extension from variant name so both /compressed and /compressed.pdf work
    const variant = (req.params.variant ?? '').replace(/\.[^.]+$/, '');

    const meta = await getMediaStatus(id);

    if (meta.status === 'queued' || meta.status === 'processing') {
      throw AppError.notFound(
        `Variant "${variant}" is not ready yet (status: ${meta.status}). ` +
        `Poll GET /media/${id} until status is "completed".`,
      );
    }

    const filename = meta.variants[variant] as string | undefined;
    if (!filename) {
      const available = Object.keys(meta.variants).join(', ') || 'none yet';
      throw AppError.notFound(
        `Variant "${variant}" does not exist for media "${id}". ` +
        `Available: ${available}.`,
      );
    }

    // Resolve the actual storage filename from the variant URL path
    // meta.variants[variant] is a URL like /media/:id/:variant
    // We need the real filename stored — look it up from the raw metadata
    // The storage filename is stored in meta.variants before URL transformation
    // Since toResponse() transforms it, we need to get the raw metadata
    const storageFilename = await resolveStorageFilename(id, variant);
    if (!storageFilename) {
      throw AppError.notFound(`Storage file for variant "${variant}" is not available.`);
    }

    const fileExists = await storage.exists(id, storageFilename);
    if (!fileExists) {
      throw AppError.notFound(
        `Variant "${variant}" exists in metadata but the file is missing from storage.`,
      );
    }

    const ct = contentTypeForFile(storageFilename, meta.kind);
    res.setHeader('Content-Type', ct);
    res.setHeader('Content-Disposition', `inline; filename="${storageFilename}"`);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Media-Id', id);
    res.setHeader('X-Media-Variant', variant);
    res.setHeader('X-Media-Kind', meta.kind);

    const stream = await storage.createReadStream(id, storageFilename);
    stream.on('error', next);
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
}

// ─── PUT /media/:id/file ─────────────────────────────────────────────────────

/**
 * Replace the actual file for an existing media record.
 * Wipes all old variants, saves the new original, and re-queues processing.
 * The media ID stays the same — perfect for profile picture replacement.
 */
export async function handleMediaReplace(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params as { id: string };

    if (!req.file) {
      throw AppError.badRequest(
        'No file uploaded. Send a multipart/form-data request with field name "file".',
      );
    }

    const input: MediaReplaceInput = {
      buffer:       req.file.buffer,
      originalname: req.file.originalname,
      mimetype:     req.file.mimetype,
      size:         req.file.size,
      name:         typeof req.body?.name === 'string' ? req.body.name : undefined,
    };

    const result = await replaceMediaFile(id, input);
    // 202 Accepted — same as initial upload, processing is async
    res.status(202).json(result);
  } catch (err) {
    next(err);
  }
}

// ─── PATCH /media/:id ────────────────────────────────────────────────────────

export async function handleMediaUpdate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, unknown>;

    // Only forward known patchable fields — silently ignore anything else
    const input: MediaUpdateInput = {};
    if (typeof body.name === 'string')         input.name       = body.name;
    if (body.clearError === true)              input.clearError = true;

    const result = await updateMedia(id, input);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /media/:id ───────────────────────────────────────────────────────

export async function handleMediaDelete(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    await deleteMedia(id);
    res.status(200).json({
      deleted:   true,
      id,
      message:   `Media "${id}" and all its variants have been permanently deleted.`,
      deletedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /health ──────────────────────────────────────────────────────────────

export function handleHealth(_req: Request, res: Response): void {
  res.status(200).json({
    status:    'ok',
    service:   'media-api',
    timestamp: new Date().toISOString(),
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

import { createRedisConnection } from '../config/redis.js';
import type { MediaMetadata } from '../types/media.js';

const redis = createRedisConnection();

async function resolveStorageFilename(id: string, variant: string): Promise<string | null> {
  const raw = await redis.get(`media:${id}`);
  if (!raw) return null;
  const meta = JSON.parse(raw) as MediaMetadata;
  return meta.variants[variant] ?? null;
}
