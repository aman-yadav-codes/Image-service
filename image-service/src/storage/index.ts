import type { StorageProvider } from './types.js';
import { MinIOStorage } from './minio.js';
import { LocalStorage } from './local.js';
import { config } from '../config/index.js';

// ─── Storage Factory ──────────────────────────────────────────────────────────

/**
 * Singleton storage instance, selected at startup via STORAGE_DRIVER env var.
 *
 * Supported drivers:
 *   minio  — MinIO / S3-compatible object store (production default)
 *   local  — Local filesystem under STORAGE_LOCAL_PATH (development)
 *
 * Usage:
 *   import { storage } from '../storage/index.js';
 *   await storage.save(imageId, filename, buffer, mimeType);
 */
function createStorage(): StorageProvider {
  switch (config.storage.driver) {
    case 'minio':
      return new MinIOStorage();
    case 'local':
      return new LocalStorage();
    default:
      throw new Error(
        `Unknown STORAGE_DRIVER: "${config.storage.driver}". Supported: minio, local`,
      );
  }
}

export const storage: StorageProvider = createStorage();

export type { StorageProvider } from './types.js';
