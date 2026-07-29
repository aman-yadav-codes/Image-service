// ─── Image Variants ──────────────────────────────────────────────────────────

export type ImageVariant = 'thumbnail' | 'display' | 'large' | 'print';

export const IMAGE_VARIANTS: ImageVariant[] = ['thumbnail', 'display', 'large', 'print'];

// ─── Job Payload ─────────────────────────────────────────────────────────────

export interface ProcessingJobData {
  imageId: string;
  variant: ImageVariant;
  /** Filename of the stored original (e.g. "original.jpg") — storage-driver agnostic */
  originalFilename: string;
  originalMimeType: string;
}

// ─── Image Status ─────────────────────────────────────────────────────────────

export type ImageStatus = 'queued' | 'processing' | 'completed' | 'failed';

// ─── Image Metadata ──────────────────────────────────────────────────────────

export interface ImageMetadata {
  id: string;
  status: ImageStatus;
  /** Human-readable original filename as uploaded */
  originalFilename: string;
  originalMimeType: string;
  originalSizeBytes: number;
  /** ISO 8601 */
  createdAt: string;
  /** ISO 8601 */
  updatedAt: string;
  /** Only populated once each variant is ready */
  completedVariants: ImageVariant[];

  // ── SEO Naming ────────────────────────────────────────────────────────────
  /**
   * URL-safe slug derived from the uploaded filename or provided by the caller.
   * e.g. "blue-running-shoes"
   */
  slug: string;
  /**
   * First 8 hex chars of the UUID — used as collision-resistant suffix in public filenames.
   * e.g. "550e8400"
   */
  shortId: string;
  /**
   * Pre-computed public filenames for each variant.
   * e.g. { display: "blue-running-shoes-display-550e8400.webp", ... }
   */
  publicFilenames: Record<ImageVariant, string>;

  /** Job failure details, if any */
  error?: string;
}

// ─── API Response ─────────────────────────────────────────────────────────────

export interface VariantUrls {
  thumbnail: string;
  display: string;
  large: string;
  print: string;
}

export interface ImageResponse {
  id: string;
  status: ImageStatus;
  /** SEO-friendly slug */
  slug: string;
  originalFilename: string;
  createdAt: string;
  updatedAt: string;
  /**
   * Public variant URLs — available only when status is "completed".
   * URLs use the SEO-friendly public filename pattern.
   */
  variants: VariantUrls | null;
  error?: string;
}

// ─── Public File Reference ────────────────────────────────────────────────────

/**
 * Stored in Redis to resolve a public SEO filename back to internal storage.
 * Key: pubfile:{publicFilename}
 */
export interface PublicFileRef {
  /** Full image ID, e.g. "img_550e8400-..." */
  imageId: string;
  variant: ImageVariant;
  /** Internal storage filename, e.g. "display.webp" */
  storageFilename: string;
}

// ─── Storage Provider ────────────────────────────────────────────────────────

export interface StoredFile {
  /** Object key or local path — implementation-specific, do not use directly */
  absolutePath: string;
  /** Public URL for browser/CDN access */
  publicUrl: string;
}

// ─── Sharp Preset ─────────────────────────────────────────────────────────────

import type { Sharp } from 'sharp';

export interface SharpPreset {
  variant: ImageVariant;
  filename: string;
  /** Apply transformations and return the pipeline */
  transform(pipeline: Sharp): Sharp;
}

// ─── Error Shape ─────────────────────────────────────────────────────────────

export interface ApiError {
  statusCode: number;
  error: string;
  message: string;
}
