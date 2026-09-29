export type MediaKind = 'image' | 'video' | 'pdf' | 'excel';
export type MediaProfile = 'standard' | 'display-only';

// Images have one canonical optimized object; Cloudflare handles resizing.
export type ImageVariant = 'image';

// Video variants (3 variants via FFmpeg)
export type VideoVariant = 'hd' | 'medium' | 'low';

// PDF variants (compression)
export type PdfVariant = 'compressed';

// Excel — no processing, stored as-is
export type ExcelVariant = 'original';

export type MediaVariant = ImageVariant | VideoVariant | PdfVariant | ExcelVariant;

export interface MediaJobData {
  mediaId: string;
  kind: MediaKind;
  variant: MediaVariant;
  originalFilename: string;
  originalMimeType: string;
  profile?: MediaProfile;
}

export type MediaStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface MediaMetadata {
  id: string;
  kind: MediaKind;
  status: MediaStatus;
  originalFilename: string;
  originalMimeType: string;
  originalSizeBytes: number;
  createdAt: string;
  updatedAt: string;
  completedVariants: MediaVariant[];
  variants: Record<string, string>;
  /** Canonical public URL for single-object image media. */
  url?: string;
  profile?: MediaProfile;
  /**
   * Optional SEO-friendly slug supplied at upload time via the `name` form field.
   * Image URLs use /media/:id/{slug}.{ext}, retaining the original extension
   * for passthrough images and using .webp for transformed images.
   * Other media kinds retain variant URLs: /media/:id/:variant.{ext}.
   */
  slug?: string;
  error?: string;
}

export interface MediaResponse extends MediaMetadata {}
