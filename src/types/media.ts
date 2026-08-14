export type MediaKind = 'video' | 'pdf';
export type VideoVariant = '720p' | '480p' | 'poster';
export type PdfVariant = 'lossless' | 'balanced';
export type MediaVariant = VideoVariant | PdfVariant;

export interface MediaJobData {
  mediaId: string;
  kind: MediaKind;
  variant: MediaVariant;
  originalFilename: string;
  originalMimeType: string;
}
export type MediaStatus = 'queued' | 'processing' | 'completed' | 'failed';
export interface MediaMetadata {
  id: string; kind: MediaKind; status: MediaStatus; originalFilename: string; originalMimeType: string;
  originalSizeBytes: number; createdAt: string; updatedAt: string;
  completedVariants: MediaVariant[]; variants: Record<string, string>; error?: string;
}
export interface MediaResponse extends MediaMetadata {}
