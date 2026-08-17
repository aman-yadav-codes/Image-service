import * as fs from 'fs';
import * as path from 'path';
import type { Readable } from 'stream';
import type { StorageProvider } from './types.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

// ─── Local Filesystem Storage ─────────────────────────────────────────────────

/**
 * Stores files under: <basePath>/<imageId>/<filename>
 *
 * Intended for local development only.
 * For production, use MinIO storage (STORAGE_DRIVER=minio).
 */
export class LocalStorage implements StorageProvider {
  private readonly basePath: string;

  constructor(basePath?: string) {
    this.basePath = basePath ?? config.storage.localBasePath;
    logger.info({ basePath: this.basePath }, 'LocalStorage initialised');
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private objectPath(imageId: string, filename: string): string {
    return path.join(this.basePath, imageId, filename);
  }

  private async ensureDir(imageId: string): Promise<void> {
    const dir = path.join(this.basePath, imageId);
    await fs.promises.mkdir(dir, { recursive: true });
  }

  // ── StorageProvider ────────────────────────────────────────────────────────

  async save(imageId: string, filename: string, data: Buffer, _contentType: string): Promise<void> {
    await this.ensureDir(imageId);
    const filePath = this.objectPath(imageId, filename);
    await fs.promises.writeFile(filePath, data);
    logger.debug({ imageId, filename, bytes: data.length }, 'LocalStorage: file saved');
  }

  async readFile(imageId: string, filename: string): Promise<Buffer> {
    const filePath = this.objectPath(imageId, filename);
    return fs.promises.readFile(filePath);
  }

  async exists(imageId: string, filename: string): Promise<boolean> {
    const filePath = this.objectPath(imageId, filename);
    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async createReadStream(imageId: string, filename: string): Promise<Readable> {
    const filePath = this.objectPath(imageId, filename);
    return fs.createReadStream(filePath);
  }

  async deleteFolder(imageId: string): Promise<void> {
    const dir = path.join(this.basePath, imageId);
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
      logger.debug({ imageId, dir }, 'LocalStorage: folder deleted');
    } catch (err: unknown) {
      // ENOENT is fine — nothing to delete
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
}
