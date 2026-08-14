import * as path from 'path';
import { randomUUID } from 'crypto';
import { storage } from '../storage/index.js';
import { enqueueMediaJobs, getVariantsForKind } from '../queues/mediaQueue.js';
import { createRedisConnection } from '../config/redis.js';
import { AppError } from '../utils/errors.js';
import { nowIso } from '../utils/helpers.js';
import type { MediaKind, MediaMetadata, MediaResponse } from '../types/media.js';

const redis = createRedisConnection();
const MEDIA_TTL = 7 * 24 * 60 * 60; // 7 days

// ─── MIME type → kind detection ───────────────────────────────────────────────

const IMAGE_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'image/tiff', 'image/avif',
]);
const VIDEO_TYPES = new Set([
  'video/mp4', 'video/webm', 'video/quicktime',
  'video/x-matroska', 'video/mpeg', 'video/avi',
]);
const PDF_TYPES = new Set(['application/pdf']);
const EXCEL_TYPES = new Set([
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
]);

function detectKind(mime: string): MediaKind {
  if (IMAGE_TYPES.has(mime))  return 'image';
  if (VIDEO_TYPES.has(mime))  return 'video';
  if (PDF_TYPES.has(mime))    return 'pdf';
  if (EXCEL_TYPES.has(mime))  return 'excel';
  throw AppError.unsupportedMedia(
    `Unsupported MIME type "${mime}". ` +
    `Supported: images, videos (mp4/webm/mov/mkv), PDF, Excel (xls/xlsx/csv).`,
  );
}

// ─── Redis key ────────────────────────────────────────────────────────────────

function key(id: string): string { return `media:${id}`; }

// ─── Upload ───────────────────────────────────────────────────────────────────

export interface MediaUploadInput {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
  /** Optional SEO-friendly name. Slugified and used in variant URLs. */
  name?: string;
}

/** Convert any string to a URL-safe slug: "My Product!" → "my-product" */
function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80); // cap length
}

export async function uploadMedia(input: MediaUploadInput): Promise<MediaResponse> {
  const kind = detectKind(input.mimetype);

  const id = `media_${randomUUID()}`;
  const ext = path.extname(input.originalname) || inferExt(kind, input.mimetype);
  const originalFilename = `original${ext}`;
  const slug = input.name ? slugify(input.name) : undefined;
  const now = nowIso();

  const metadata: MediaMetadata = {
    id,
    kind,
    status: 'queued',
    originalFilename,
    originalMimeType: input.mimetype,
    originalSizeBytes: input.size,
    createdAt: now,
    updatedAt: now,
    completedVariants: [],
    variants: {},
    ...(slug ? { slug } : {}),
  };

  // For excel: mark as completed immediately (no processing needed)
  if (kind === 'excel') {
    metadata.variants['original'] = originalFilename;
    metadata.completedVariants = ['original'];
    metadata.status = 'completed';
  }

  // Save original file to storage
  await storage.save(id, originalFilename, input.buffer, input.mimetype);

  // Persist metadata
  await redis.set(key(id), JSON.stringify(metadata), 'EX', MEDIA_TTL);

  // Enqueue processing jobs (excel will enqueue an "original" job that's a no-op)
  if (kind !== 'excel') {
    await enqueueMediaJobs({ mediaId: id, kind, originalFilename, originalMimeType: input.mimetype });
  }

  return toResponse(metadata);
}

// ─── Status ───────────────────────────────────────────────────────────────────

export async function getMediaStatus(id: string): Promise<MediaResponse> {
  const raw = await redis.get(key(id));
  if (!raw) throw AppError.notFound(`Media "${id}" not found. It may have expired or never existed.`);
  return toResponse(JSON.parse(raw) as MediaMetadata);
}

// ─── Mark variant completed ───────────────────────────────────────────────────

export async function markMediaVariantCompleted(
  id: string,
  variant: MediaMetadata['completedVariants'][number],
  filename: string,
): Promise<void> {
  const raw = await redis.get(key(id));
  if (!raw) return;

  const meta = JSON.parse(raw) as MediaMetadata;
  if (!meta.completedVariants.includes(variant)) {
    meta.completedVariants.push(variant);
  }
  meta.variants[variant] = filename;
  meta.updatedAt = nowIso();

  const required = getVariantsForKind(meta.kind);
  meta.status = required.every((v) => meta.completedVariants.includes(v as typeof variant))
    ? 'completed'
    : 'processing';

  await redis.set(key(id), JSON.stringify(meta), 'EX', MEDIA_TTL);
}

// ─── Mark failed ──────────────────────────────────────────────────────────────

export async function markMediaFailed(id: string, error: string): Promise<void> {
  const raw = await redis.get(key(id));
  if (!raw) return;
  const meta = JSON.parse(raw) as MediaMetadata;
  meta.status = 'failed';
  meta.error = error;
  meta.updatedAt = nowIso();
  await redis.set(key(id), JSON.stringify(meta), 'EX', MEDIA_TTL);
}

// ─── Response builder ─────────────────────────────────────────────────────────

function toResponse(meta: MediaMetadata): MediaResponse {
  const variantUrls = Object.fromEntries(
    Object.entries(meta.variants).map(([variantName, filename]) => {
      const ext = path.extname(filename); // e.g. ".pdf", ".mp4", ".webp", ".xlsx"

      if (meta.slug && ext) {
        // SEO URL: /media/:id/:variant/{slug}.{ext}
        // e.g. /media/media_123/display/product-photo.webp
        //      /media/media_123/compressed/my-contract.pdf
        //      /media/media_123/hd/promo-video.mp4
        //      /media/media_123/original/sales-data.xlsx
        return [variantName, `/media/${meta.id}/${variantName}/${meta.slug}${ext}`];
      }

      // Default URL: /media/:id/:variant.{ext}
      // e.g. /media/media_123/display.webp
      return [variantName, `/media/${meta.id}/${variantName}${ext}`];
    }),
  );

  return { ...meta, variants: variantUrls };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function inferExt(kind: MediaKind, mime: string): string {
  switch (kind) {
    case 'image': {
      const map: Record<string, string> = {
        'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
        'image/gif': '.gif', 'image/tiff': '.tiff', 'image/avif': '.avif',
      };
      return map[mime] ?? '.jpg';
    }
    case 'video': {
      const map: Record<string, string> = {
        'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
        'video/x-matroska': '.mkv', 'video/mpeg': '.mpeg', 'video/avi': '.avi',
      };
      return map[mime] ?? '.mp4';
    }
    case 'pdf':   return '.pdf';
    case 'excel': {
      if (mime === 'text/csv') return '.csv';
      if (mime === 'application/vnd.ms-excel') return '.xls';
      return '.xlsx';
    }
  }
}
