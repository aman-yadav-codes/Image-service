import * as path from 'path';
import { randomUUID } from 'crypto';
import { storage } from '../storage/index.js';
import { enqueueMediaJobs } from '../queues/mediaQueue.js';
import { createRedisConnection } from '../config/redis.js';
import { config } from '../config/index.js';
import { AppError } from '../utils/errors.js';
import { nowIso } from '../utils/helpers.js';
import type { MediaKind, MediaMetadata } from '../types/media.js';
import type { MediaResponse } from '../types/media.js';

const redis = createRedisConnection();
const MEDIA_TTL = 7 * 24 * 60 * 60;
const VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska', 'video/mpeg']);
const PDF_TYPES = new Set(['application/pdf']);

function key(id: string): string { return `media:${id}`; }
function detectKind(mime: string): MediaKind {
  if (VIDEO_TYPES.has(mime)) return 'video';
  if (PDF_TYPES.has(mime)) return 'pdf';
  throw AppError.unsupportedMedia(`Unsupported media type "${mime}". Supported: video and PDF.`);
}

export interface MediaUploadInput { buffer: Buffer; originalname: string; mimetype: string; size: number; }

export async function uploadMedia(input: MediaUploadInput): Promise<MediaResponse> {
  const kind = detectKind(input.mimetype);
  if (input.size > config.media.maxFileSizeBytes) throw AppError.payloadTooLarge(`File size ${input.size} bytes exceeds the media limit of ${config.media.maxFileSizeBytes} bytes`);
  const id = `media_${randomUUID()}`;
  const ext = path.extname(input.originalname) || (kind === 'pdf' ? '.pdf' : '.mp4');
  const originalFilename = `original${ext}`;
  const now = nowIso();
  const metadata: MediaMetadata = { id, kind, status: 'queued', originalFilename, originalMimeType: input.mimetype, originalSizeBytes: input.size, createdAt: now, updatedAt: now, completedVariants: [], variants: {} };
  await storage.save(id, originalFilename, input.buffer, input.mimetype);
  await redis.set(key(id), JSON.stringify(metadata), 'EX', MEDIA_TTL);
  await enqueueMediaJobs({ mediaId: id, kind, originalFilename, originalMimeType: input.mimetype });
  return toResponse(metadata);
}

export async function getMediaStatus(id: string): Promise<MediaResponse> {
  const raw = await redis.get(key(id));
  if (!raw) throw AppError.notFound(`Media "${id}" not found`);
  return toResponse(JSON.parse(raw) as MediaMetadata);
}

export async function markMediaVariantCompleted(id: string, variant: MediaMetadata['completedVariants'][number], filename: string): Promise<void> {
  const raw = await redis.get(key(id)); if (!raw) return;
  const meta = JSON.parse(raw) as MediaMetadata;
  if (!meta.completedVariants.includes(variant)) meta.completedVariants.push(variant);
  meta.variants[variant] = filename; meta.updatedAt = nowIso();
  const required = meta.kind === 'video' ? ['720p', '480p', 'poster'] : ['lossless', 'balanced'];
  meta.status = required.every((v) => meta.completedVariants.includes(v as typeof variant)) ? 'completed' : 'processing';
  await redis.set(key(id), JSON.stringify(meta), 'EX', MEDIA_TTL);
}

export async function markMediaFailed(id: string, error: string): Promise<void> {
  const raw = await redis.get(key(id)); if (!raw) return;
  const meta = JSON.parse(raw) as MediaMetadata;
  meta.status = 'failed'; meta.error = error; meta.updatedAt = nowIso();
  await redis.set(key(id), JSON.stringify(meta), 'EX', MEDIA_TTL);
}

function toResponse(meta: MediaMetadata): MediaResponse {
  return { ...meta, variants: Object.fromEntries(Object.entries(meta.variants).map(([name, filename]) => [name, `/media/${meta.id}/${filename}`])) };
}
