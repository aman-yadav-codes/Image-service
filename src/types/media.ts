export type MediaKind = 'image' | 'video' | 'pdf' | 'excel';

// Image variants (4 variants via Sharp)
export type ImageVariant = 'thumbnail' | 'display' | 'large' | 'print';

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
  error?: string;
}

export interface MediaResponse extends MediaMetadata {}
