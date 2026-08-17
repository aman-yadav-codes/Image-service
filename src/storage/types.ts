import type { Readable } from 'stream';

// ─── Storage Provider Interface ───────────────────────────────────────────────

/**
 * Abstraction over object/file storage backends.
 * All paths are expressed as (imageId, filename) pairs so the implementation
 * can organise them however it needs (e.g. MinIO key = "<imageId>/<filename>").
 */
export interface StorageProvider {
  /**
   * Save a buffer to storage under the given imageId / filename.
   *
   * @param imageId     - Unique image identifier (e.g. "img_550e8400-…")
   * @param filename    - Target filename inside that image's folder (e.g. "original.jpg")
   * @param data        - Raw file bytes
   * @param contentType - MIME type (e.g. "image/webp")
   */
  save(imageId: string, filename: string, data: Buffer, contentType: string): Promise<void>;

  /**
   * Read a file back as a Buffer.
   * Throws if the file does not exist.
   */
  readFile(imageId: string, filename: string): Promise<Buffer>;

  /**
   * Check whether a file already exists in storage.
   * Returns false rather than throwing when the file is not found.
   */
  exists(imageId: string, filename: string): Promise<boolean>;

  /**
   * Return a readable stream for a stored file.
   * Used by the API to stream responses directly to HTTP clients without
   * buffering the entire file in memory.
   */
  createReadStream(imageId: string, filename: string): Promise<Readable>;

  /**
   * Delete all files stored under the given imageId (the entire "folder").
   * Used when a media record is deleted — removes original + every variant.
   * Resolves without error if nothing exists under that id.
   */
  deleteFolder(imageId: string): Promise<void>;
}
