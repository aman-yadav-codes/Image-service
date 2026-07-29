import { redis } from '../config/redis.js';
import type { ImageMetadata, ImageVariant, ImageStatus, PublicFileRef } from '../types/index.js';
import { logger } from '../utils/logger.js';

// ─── Keys & TTL ───────────────────────────────────────────────────────────────

const META_PREFIX    = 'image:meta:';
const PUBFILE_PREFIX = 'image:pubfile:';
const TTL_SECONDS    = 60 * 60 * 24 * 7; // 7 days

function metaKey(imageId: string): string {
  return `${META_PREFIX}${imageId}`;
}

function pubfileKey(publicFilename: string): string {
  return `${PUBFILE_PREFIX}${publicFilename}`;
}

// ─── Image Metadata ──────────────────────────────────────────────────────────

/**
 * Persist image metadata to Redis as a JSON string.
 */
export async function saveMetadata(meta: ImageMetadata): Promise<void> {
  await redis.setex(metaKey(meta.id), TTL_SECONDS, JSON.stringify(meta));
}

/**
 * Retrieve image metadata. Returns null if not found.
 */
export async function getMetadata(imageId: string): Promise<ImageMetadata | null> {
  const raw = await redis.get(metaKey(imageId));
  if (!raw) return null;
  return JSON.parse(raw) as ImageMetadata;
}

/**
 * Update the status field of stored metadata.
 */
export async function updateStatus(imageId: string, status: ImageStatus, error?: string): Promise<void> {
  const meta = await getMetadata(imageId);
  if (!meta) {
    logger.warn({ imageId, status }, 'Attempted to update status for unknown image');
    return;
  }
  meta.status    = status;
  meta.updatedAt = new Date().toISOString();
  if (error) meta.error = error;
  await saveMetadata(meta);
}

/**
 * Mark a specific variant as completed.
 * If all variants are done, sets overall status to "completed".
 */
export async function markVariantCompleted(
  imageId: string,
  variant: ImageVariant,
  allVariants: ImageVariant[],
): Promise<void> {
  const meta = await getMetadata(imageId);
  if (!meta) {
    logger.warn({ imageId, variant }, 'Cannot mark variant complete: image not found in Redis');
    return;
  }

  if (!meta.completedVariants.includes(variant)) {
    meta.completedVariants.push(variant);
  }

  const allDone  = allVariants.every((v) => meta.completedVariants.includes(v));
  meta.status    = allDone ? 'completed' : 'processing';
  meta.updatedAt = new Date().toISOString();

  await saveMetadata(meta);
  logger.info({ imageId, variant, status: meta.status }, 'Variant marked completed');
}

// ─── Public File Refs ─────────────────────────────────────────────────────────

/**
 * Store a mapping from a SEO public filename → internal image/variant reference.
 *
 * Key: image:pubfile:{publicFilename}
 * Value: { imageId, variant, storageFilename }
 *
 * This allows the API to resolve:
 *   "blue-running-shoes-display-550e8400.webp" → img_550e8400-.../display.webp
 * in O(1) without parsing the filename.
 */
export async function savePublicFileRef(publicFilename: string, ref: PublicFileRef): Promise<void> {
  await redis.setex(pubfileKey(publicFilename), TTL_SECONDS, JSON.stringify(ref));
}

/**
 * Look up the internal reference for a given public SEO filename.
 * Returns null if the filename is unknown.
 */
export async function getPublicFileRef(publicFilename: string): Promise<PublicFileRef | null> {
  const raw = await redis.get(pubfileKey(publicFilename));
  if (!raw) return null;
  return JSON.parse(raw) as PublicFileRef;
}

/**
 * Save public file refs for all variants of an image in a single pipeline call.
 * Called at upload time so refs are immediately available (even before processing).
 */
export async function saveAllPublicFileRefs(
  imageId: string,
  publicFilenames: Record<string, string>,
): Promise<void> {
  const pipeline = redis.pipeline();

  for (const [variant, publicFilename] of Object.entries(publicFilenames)) {
    const ref: PublicFileRef = {
      imageId,
      variant:         variant as ImageVariant,
      storageFilename: `${variant}.webp`,
    };
    pipeline.setex(pubfileKey(publicFilename), TTL_SECONDS, JSON.stringify(ref));
  }

  await pipeline.exec();
  logger.debug({ imageId, count: Object.keys(publicFilenames).length }, 'Public file refs saved');
}
