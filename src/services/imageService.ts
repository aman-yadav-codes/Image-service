import * as path from 'path';
import { storage } from '../storage/index.js';
import { enqueueProcessingJobs } from '../queues/imageQueue.js';
import { saveMetadata, getMetadata, saveAllPublicFileRefs } from './metadataService.js';
import { generateImageId, nowIso } from '../utils/helpers.js';
import { generateSlug, extractShortId, buildPublicUrl } from '../utils/slug.js';
import { AppError } from '../utils/errors.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import type { ImageMetadata, ImageResponse, VariantUrls } from '../types/index.js';
import { IMAGE_VARIANTS } from '../types/index.js';

// ─── Upload ──────────────────────────────────────────────────────────────────

export interface UploadInput {
  buffer:        Buffer;
  originalname:  string;
  mimetype:      string;
  size:          number;
  /**
   * Optional SEO slug from the caller (e.g. "blue-running-shoes").
   * If omitted, derived from the original filename.
   */
  slug?:         string;
}

/**
 * Handle an incoming image upload:
 *  1. Validate MIME type + size
 *  2. Generate image ID, slug, shortId, and public filenames
 *  3. Save original to storage (local or MinIO)
 *  4. Persist metadata to Redis
 *  5. Store public filename → internal ref mappings in Redis
 *  6. Enqueue processing jobs
 *  7. Return 202 response
 */
export async function uploadImage(input: UploadInput): Promise<ImageResponse> {
  // ── Validate ─────────────────────────────────────────────────────────────
  if (!config.api.allowedMimeTypes.includes(input.mimetype)) {
    throw AppError.unsupportedMedia(
      `File type "${input.mimetype}" is not supported. Allowed: ${config.api.allowedMimeTypes.join(', ')}`,
    );
  }
  if (input.size > config.api.maxFileSizeBytes) {
    throw AppError.payloadTooLarge(
      `File size ${input.size} bytes exceeds the maximum of ${config.api.maxFileSizeBytes} bytes`,
    );
  }

  // ── Generate IDs ─────────────────────────────────────────────────────────
  const imageId         = generateImageId();
  const shortId         = extractShortId(imageId);
  const ext             = path.extname(input.originalname) || '.jpg';
  const originalFilename = `original${ext}`;

  // Slug: caller-provided or auto-derived from filename
  const slug = input.slug
    ? generateSlug(input.slug)
    : generateSlug(input.originalname);

  // Pre-compute public filenames for all variants upfront
  const publicFilenames = Object.fromEntries(
    IMAGE_VARIANTS.map((v) => [v, buildPublicUrl(slug, v, shortId)])
  ) as Record<typeof IMAGE_VARIANTS[number], string>;

  logger.info(
    { imageId, shortId, slug, originalFilename, size: input.size, mime: input.mimetype },
    'Processing upload',
  );

  // ── Store Original ────────────────────────────────────────────────────────
  await storage.save(imageId, originalFilename, input.buffer, input.mimetype);

  // ── Persist Metadata ──────────────────────────────────────────────────────
  const now = nowIso();
  const metadata: ImageMetadata = {
    id:                imageId,
    status:            'queued',
    originalFilename:  input.originalname,
    originalMimeType:  input.mimetype,
    originalSizeBytes: input.size,
    createdAt:         now,
    updatedAt:         now,
    completedVariants: [],
    slug,
    shortId,
    publicFilenames,
  };
  await saveMetadata(metadata);

  // ── Store Public File Refs (O(1) reverse lookup by SEO filename) ──────────
  // Map "blue-running-shoes-display-550e8400.webp" → {imageId, variant, storageFilename}
  // Extract just the filename part from the full URL
  const filenameOnlyMap = Object.fromEntries(
    Object.entries(publicFilenames).map(([variant, url]) => [
      variant,
      url.split('/').pop()!, // strip "/images/" prefix
    ]),
  ) as Record<typeof IMAGE_VARIANTS[number], string>;

  await saveAllPublicFileRefs(imageId, filenameOnlyMap);

  // ── Enqueue Jobs ──────────────────────────────────────────────────────────
  await enqueueProcessingJobs(imageId, originalFilename, input.mimetype);

  logger.info({ imageId, slug }, 'Image queued for processing');
  return toResponse(metadata);
}

// ─── Status ──────────────────────────────────────────────────────────────────

export async function getImageStatus(imageId: string): Promise<ImageResponse> {
  const meta = await getMetadata(imageId);
  if (!meta) throw AppError.notFound(`Image "${imageId}" not found`);
  return toResponse(meta);
}

// ─── Response Builder ─────────────────────────────────────────────────────────

function toResponse(meta: ImageMetadata): ImageResponse {
  const allVariantsDone = IMAGE_VARIANTS.every((v) => meta.completedVariants.includes(v));

  // Public variant URLs use the SEO-friendly pattern
  const variants: VariantUrls | null = allVariantsDone
    ? {
        display:   meta.publicFilenames.display,
        thumbnail: meta.publicFilenames.thumbnail,
      }
    : null;

  return {
    id:               meta.id,
    status:           meta.status,
    slug:             meta.slug,
    originalFilename: meta.originalFilename,
    createdAt:        meta.createdAt,
    updatedAt:        meta.updatedAt,
    variants,
    ...(meta.error ? { error: meta.error } : {}),
  };
}
