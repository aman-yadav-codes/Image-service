import { Readable } from 'stream';
import * as Minio from 'minio';
import type { StorageProvider } from './types.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

// ─── MinIO Storage ────────────────────────────────────────────────────────────

/**
 * Stores objects in MinIO (S3-compatible).
 *
 * Object key layout: <imageId>/<filename>
 * e.g. "img_550e8400-…/display.webp"
 *
 * Public URLs follow: <publicEndpoint>/<bucket>/<imageId>/<filename>
 */
export class MinIOStorage implements StorageProvider {
  private readonly client: Minio.Client;
  private readonly bucket: string;

  constructor() {
    this.client = new Minio.Client({
      endPoint:  config.minio.endpoint,
      port:      config.minio.port,
      useSSL:    config.minio.useSSL,
      accessKey: config.minio.accessKey,
      secretKey: config.minio.secretKey,
      region:    config.minio.region,
    });

    this.bucket = config.minio.bucket;

    logger.info(
      { endpoint: config.minio.endpoint, port: config.minio.port, bucket: this.bucket },
      'MinIOStorage initialised',
    );
  }

  // ── Key helper ────────────────────────────────────────────────────────────

  private objectKey(imageId: string, filename: string): string {
    return `${imageId}/${filename}`;
  }

  // ── StorageProvider ────────────────────────────────────────────────────────

  async save(imageId: string, filename: string, data: Buffer, contentType: string): Promise<void> {
    const key = this.objectKey(imageId, filename);
    const meta: Record<string, string> = { 'Content-Type': contentType };

    await this.client.putObject(this.bucket, key, data, data.length, meta);

    logger.debug({ imageId, filename, key, bytes: data.length }, 'MinIOStorage: object put');
  }

  async readFile(imageId: string, filename: string): Promise<Buffer> {
    const key = this.objectKey(imageId, filename);

    const stream = await this.client.getObject(this.bucket, key);
    return streamToBuffer(stream);
  }

  async exists(imageId: string, filename: string): Promise<boolean> {
    const key = this.objectKey(imageId, filename);
    try {
      await this.client.statObject(this.bucket, key);
      return true;
    } catch (err: unknown) {
      // MinIO throws an error with code 'NotFound' when the object does not exist
      if (
        err !== null &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code: string }).code === 'NotFound'
      ) {
        return false;
      }
      // Re-throw unexpected errors (connection issues, auth failures, etc.)
      throw err;
    }
  }

  async createReadStream(imageId: string, filename: string): Promise<Readable> {
    const key = this.objectKey(imageId, filename);
    return this.client.getObject(this.bucket, key);
  }

  async deleteFolder(imageId: string): Promise<void> {
    const prefix = `${imageId}/`;
    const keys: string[] = [];

    await new Promise<void>((resolve, reject) => {
      const stream = this.client.listObjects(this.bucket, prefix, true);
      stream.on('data',  (obj) => { if (obj.name) keys.push(obj.name); });
      stream.on('end',   resolve);
      stream.on('error', reject);
    });

    if (keys.length === 0) return; // nothing to delete

    await this.client.removeObjects(this.bucket, keys);
    logger.debug({ imageId, count: keys.length }, 'MinIOStorage: folder deleted');
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end',  () => resolve(Buffer.concat(chunks)));
    stream.on('error', (err: Error) => reject(err));
  });
}
