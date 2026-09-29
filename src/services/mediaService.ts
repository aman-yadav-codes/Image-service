import * as path from 'path';
import { randomUUID } from 'crypto';
import { storage } from '../storage/index.js';
import { enqueueMediaJobs, getVariantsForKind } from '../queues/mediaQueue.js';
import { createRedisConnection } from '../config/redis.js';
import { AppError } from '../utils/errors.js';
import { nowIso } from '../utils/helpers.js';
import type { MediaKind, MediaMetadata, MediaProfile, MediaResponse } from '../types/media.js';

const redis = createRedisConnection();
const MEDIA_VARIANT_FILENAMES: Record<string, string> = {
  image: 'image.webp',
  thumbnail: 'thumbnail.webp',
  display: 'display.webp',
  large: 'large.webp',
  print: 'print.jpg',
  compressed: 'compressed.pdf',
  hd: 'hd.mp4',
  medium: 'medium.mp4',
  low: 'low.mp4',
};

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
  profile?: MediaProfile;
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
  const profile = kind === 'image' ? (input.profile ?? 'standard') : 'standard';

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
    profile,
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
  await persistMediaMetadata(metadata);

  // Enqueue processing jobs (excel will enqueue an "original" job that's a no-op)
  if (kind !== 'excel') {
    await enqueueMediaJobs({ mediaId: id, kind, originalFilename, originalMimeType: input.mimetype, profile });
  }

  return toResponse(metadata);
}

// ─── Status ───────────────────────────────────────────────────────────────────

export async function getMediaStatus(id: string): Promise<MediaResponse> {
  const raw = await redis.get(key(id));
  if (raw) {
    return toResponse(JSON.parse(raw) as MediaMetadata);
  }

  const recovered = await recoverMediaFromStorage(id);
  if (!recovered) {
    throw AppError.notFound(`Media "${id}" not found. It may have expired or never existed.`);
  }

  await persistMediaMetadata(recovered);
  return toResponse(recovered);
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function deleteMedia(id: string): Promise<void> {
  const raw = await redis.get(key(id));
  if (!raw) throw AppError.notFound(`Media "${id}" not found. It may have expired or never existed.`);

  // Remove all files from storage (original + every variant) in parallel
  await storage.deleteFolder(id);

  // Remove metadata from Redis
  await redis.del(key(id));
}

// ─── Replace file (PUT) ───────────────────────────────────────────────────────

export interface MediaReplaceInput {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
  /** Keep the existing slug, or pass a new name to re-slugify. */
  name?: string;
}

/**
 * Replace the file of an existing media record while keeping the same ID.
 *
 * Steps:
 *  1. Verify the record exists.
 *  2. Delete every file in storage under this ID (original + all old variants).
 *  3. Save the new original file.
 *  4. Reset metadata: status → queued, variants → {}, completedVariants → [].
 *  5. Re-enqueue processing jobs for the new file.
 *
 * Returns 202-style MediaResponse (status = "queued").
 */
export async function replaceMediaFile(
  id: string,
  input: MediaReplaceInput,
): Promise<MediaResponse> {
  const raw = await redis.get(key(id));
  if (!raw) {
    throw AppError.notFound(`Media "${id}" not found. It may have expired or never existed.`);
  }

  const existing = JSON.parse(raw) as MediaMetadata;

  // Detect kind from new file — must be compatible MIME
  const newKind = detectKind(input.mimetype);

  const ext = path.extname(input.originalname) || inferExt(newKind, input.mimetype);
  const originalFilename = `original${ext}`;
  const now = nowIso();

  // 1. Wipe all old files from storage (original + every variant)
  await storage.deleteFolder(id);

  // 2. Save the new original file
  await storage.save(id, originalFilename, input.buffer, input.mimetype);

  // 3. Build fresh metadata — preserve id, createdAt, and optionally slug
  const newSlug = input.name
    ? slugify(input.name)
    : existing.slug; // keep old slug if no new name given

  const metadata: MediaMetadata = {
    id,
    kind:              newKind,
    status:            'queued',
    originalFilename,
    originalMimeType:  input.mimetype,
    originalSizeBytes: input.size,
    createdAt:         existing.createdAt, // preserve original upload date
    updatedAt:         now,
    completedVariants: [],
    variants:          {},
    ...(newSlug ? { slug: newSlug } : {}),
  };

  // Excel: no processing, mark complete immediately (same as uploadMedia)
  if (newKind === 'excel') {
    metadata.variants['original'] = originalFilename;
    metadata.completedVariants = ['original'];
    metadata.status = 'completed';
  }

  // 4. Persist reset metadata (refresh TTL)
  await persistMediaMetadata(metadata);

  // 5. Re-enqueue processing jobs
  if (newKind !== 'excel') {
    await enqueueMediaJobs({
      mediaId:          id,
      kind:             newKind,
      originalFilename,
      originalMimeType: input.mimetype,
    });
  }

  return toResponse(metadata);
}

// ─── Update (PATCH) ───────────────────────────────────────────────────────────

export interface MediaUpdateInput {
  /** Update the SEO-friendly name. Re-slugifies and regenerates all variant URLs. */
  name?: string;
  /** Explicitly clear a previous error message (e.g. after retrying manually). */
  clearError?: boolean;
}

export async function updateMedia(id: string, input: MediaUpdateInput): Promise<MediaResponse> {
  if (Object.keys(input).length === 0) {
    throw AppError.badRequest(
      'PATCH body is empty. Provide at least one of: name, clearError.',
    );
  }

  const raw = await redis.get(key(id));
  if (!raw) throw AppError.notFound(`Media "${id}" not found. It may have expired or never existed.`);

  const meta = JSON.parse(raw) as MediaMetadata;

  // ── Apply patches ────────────────────────────────────────────────────────────
  if (input.name !== undefined) {
    const slug = slugify(input.name);
    if (!slug) throw AppError.badRequest('Provided "name" is empty after slugification.');
    meta.slug = slug;
  }

  if (input.clearError === true) {
    delete meta.error;
  }

  meta.updatedAt = nowIso();

  await persistMediaMetadata(meta);

  return toResponse(meta);
}

// ─── Mark variant completed ───────────────────────────────────────────────────

export async function markMediaVariantCompleted(
  id: string,
  variant: MediaMetadata['completedVariants'][number],
  filename: string,
): Promise<void> {
  await redis.eval(
    MARK_VARIANT_COMPLETED_SCRIPT,
    1,
    key(id),
    variant,
    filename,
    nowIso(),
  );
}

// ─── Mark failed ──────────────────────────────────────────────────────────────

export async function markMediaFailed(id: string, rawError: string): Promise<void> {
  await redis.eval(
    MARK_MEDIA_FAILED_SCRIPT,
    1,
    key(id),
    extractError(rawError),
    nowIso(),
  );
}

const MARK_VARIANT_COMPLETED_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end

local meta = cjson.decode(raw)
local variant = ARGV[1]
meta.completedVariants = meta.completedVariants or {}
meta.variants = meta.variants or {}
local found = false
for _, current in ipairs(meta.completedVariants) do
  if current == variant then found = true break end
end
if not found then table.insert(meta.completedVariants, variant) end

meta.variants[variant] = ARGV[2]
meta.updatedAt = ARGV[3]

if meta.error then
  meta.status = 'failed'
else
  local requiredByKind = {
    image = {'image'},
    video = {'hd', 'medium', 'low'},
    pdf = {'compressed'},
    excel = {'original'}
  }
  local completed = {}
  for _, current in ipairs(meta.completedVariants) do completed[current] = true end
  local allCompleted = true
  for _, required in ipairs(requiredByKind[meta.kind] or {}) do
    if not completed[required] then allCompleted = false break end
  end
  meta.status = allCompleted and 'completed' or 'processing'
end

redis.call('SET', KEYS[1], cjson.encode(meta))
return 1
`;

const MARK_MEDIA_FAILED_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local meta = cjson.decode(raw)
meta.status = 'failed'
meta.error = ARGV[1]
meta.updatedAt = ARGV[2]
redis.call('SET', KEYS[1], cjson.encode(meta))
return 1
`;

async function persistMediaMetadata(meta: MediaMetadata): Promise<void> {
  await redis.set(key(meta.id), JSON.stringify(meta));
}

export async function compactMediaToCanonicalImage(id: string): Promise<boolean> {
  const raw = await redis.get(key(id));
  const meta = raw ? JSON.parse(raw) as MediaMetadata : await recoverMediaFromStorage(id);
  if (!meta || meta.kind !== 'image') return false;

  const files = await storage.listFiles(id);
  const canonicalFilename = 'image.webp';
  if (!(await storage.exists(id, canonicalFilename))) return false;

  await Promise.all(
    files
      .filter((filename) => filename !== canonicalFilename)
      .map((filename) => storage.deleteFile(id, filename)),
  );

  meta.profile = 'standard';
  meta.status = 'completed';
  meta.originalFilename = canonicalFilename;
  meta.originalMimeType = 'image/webp';
  meta.originalSizeBytes = 0;
  meta.completedVariants = ['image'];
  meta.variants = { image: canonicalFilename };
  delete meta.error;
  meta.updatedAt = nowIso();
  await persistMediaMetadata(meta);
  return true;
}

async function recoverMediaFromStorage(id: string): Promise<MediaMetadata | null> {
  const files = await storage.listFiles(id);
  if (files.length === 0) {
    return null;
  }

  const variants = Object.fromEntries(
    Object.entries(MEDIA_VARIANT_FILENAMES)
      .filter(([, filename]) => files.includes(filename)),
  );
  const originalFilename = files.find((filename) => filename.startsWith('original.')) ?? files[0];
  const kind = inferKindFromFiles(files);
  const now = nowIso();

  if (kind === 'excel' && originalFilename) {
    variants.original = originalFilename;
  }

  return {
    id,
    kind,
    status: 'completed',
    originalFilename,
    originalMimeType: contentTypeFromFilename(originalFilename),
    originalSizeBytes: 0,
    createdAt: now,
    updatedAt: now,
    completedVariants: Object.keys(variants) as MediaMetadata['completedVariants'],
    variants,
  };
}

function inferKindFromFiles(files: string[]): MediaKind {
  if (files.some((filename) => ['image.webp', 'thumbnail.webp', 'display.webp', 'large.webp', 'print.jpg'].includes(filename))) {
    return 'image';
  }

  if (files.some((filename) => ['hd.mp4', 'medium.mp4', 'low.mp4'].includes(filename))) {
    return 'video';
  }

  if (files.includes('compressed.pdf') || files.some((filename) => filename.endsWith('.pdf'))) {
    return 'pdf';
  }

  return 'excel';
}

function contentTypeFromFilename(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const map: Record<string, string> = {
    '.webp': 'image/webp',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.avif': 'image/avif',
    '.pdf': 'application/pdf',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.csv': 'text/csv',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
  return map[ext] ?? 'application/octet-stream';
}

/** Pull the first recognisable error line out of a long command output string. */
function extractError(msg: string): string {
  const lines = msg.split('\n').map((l) => l.trim()).filter(Boolean);

  // Look for the first line that contains a real error keyword
  const errorLine = lines.find((l) =>
    /error|invalid|failed|could not|no such|permission denied/i.test(l) &&
    !l.startsWith('ffmpeg version') &&
    !l.startsWith('built with') &&
    !l.startsWith('configuration:') &&
    !l.startsWith('lib'),
  );

  if (errorLine) return errorLine.slice(0, 300);

  // Fallback: first line of the message, capped at 300 chars
  return (lines[0] ?? msg).slice(0, 300);
}

// ─── Response builder ─────────────────────────────────────────────────────────

function toResponse(meta: MediaMetadata): MediaResponse {
  if (meta.kind === 'image' && meta.variants.image) {
    const ext = path.extname(meta.variants.image) || '.webp';
    const url = meta.slug
      ? `/media/${meta.id}/${meta.slug}${ext}`
      : `/media/${meta.id}/image${ext}`;
    return { ...meta, url, variants: { image: url } };
  }
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
