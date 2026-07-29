import * as path from 'path';

// ─── Environment ────────────────────────────────────────────────────────────

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function optionalNumber(key: string, fallback: number): number {
  const val = process.env[key];
  return val ? parseInt(val, 10) : fallback;
}

// ─── Config ─────────────────────────────────────────────────────────────────

export const config = {
  env: optional('NODE_ENV', 'development') as 'development' | 'production' | 'test',

  api: {
    port: optionalNumber('PORT', 4000),
    host: optional('HOST', '0.0.0.0'),
    /** Max upload size in bytes. Default 20 MB */
    maxFileSizeBytes: optionalNumber('MAX_FILE_SIZE_BYTES', 20 * 1024 * 1024),
    /** Comma-separated allowed MIME types */
    allowedMimeTypes: optional(
      'ALLOWED_MIME_TYPES',
      'image/jpeg,image/png,image/webp,image/gif,image/tiff,image/avif',
    ).split(','),
    rateLimitWindowMs: optionalNumber('RATE_LIMIT_WINDOW_MS', 60_000),
    rateLimitMax:      optionalNumber('RATE_LIMIT_MAX', 200),
  },

  redis: {
    host:     optional('REDIS_HOST', 'localhost'),
    port:     optionalNumber('REDIS_PORT', 6379),
    password: process.env['REDIS_PASSWORD'],
    db:       optionalNumber('REDIS_DB', 0),
    tls:      optional('REDIS_TLS', 'false') === 'true',
  },

  storage: {
    driver:        optional('STORAGE_DRIVER', 'local') as 'local' | 'minio' | 's3',
    localBasePath: optional('STORAGE_LOCAL_PATH', path.join(process.cwd(), 'storage')),
    /** Public base URL for serving files (local storage only) */
    publicBaseUrl: optional('STORAGE_PUBLIC_BASE_URL', '/images'),
  },

  /** MinIO / S3-compatible object store */
  minio: {
    endpoint:       optional('MINIO_ENDPOINT', 'localhost'),
    port:           optionalNumber('MINIO_PORT', 9000),
    useSSL:         optional('MINIO_USE_SSL', 'false') === 'true',
    accessKey:      optional('MINIO_ACCESS_KEY', 'minioadmin'),
    secretKey:      optional('MINIO_SECRET_KEY', 'minioadmin123'),
    bucket:         optional('MINIO_BUCKET', 'images'),
    region:         optional('MINIO_REGION', 'us-east-1'),
    /** External URL browsers use to access objects (e.g. http://localhost:9000) */
    publicEndpoint: optional('MINIO_PUBLIC_ENDPOINT', 'http://localhost:9000'),
  },

  queue: {
    name:              optional('QUEUE_NAME', 'image-processing'),
    concurrency:       optionalNumber('WORKER_CONCURRENCY', 5),
    maxRetries:        optionalNumber('JOB_MAX_RETRIES', 3),
    backoffDelay:      optionalNumber('JOB_BACKOFF_DELAY_MS', 2_000),
    keepCompletedMs:   optionalNumber('JOB_KEEP_COMPLETED_MS', 3_600_000),
    keepFailedMs:      optionalNumber('JOB_KEEP_FAILED_MS', 86_400_000),
  },

  image: {
    maxImagePixels:   optionalNumber('MAX_IMAGE_PIXELS', 40000000),
    maxMetadataSize:  optionalNumber('MAX_METADATA_SIZE', 1048576),
  },

  presets: {
    display: {
      width:   optionalNumber('DISPLAY_WIDTH', 1920),
      quality: optionalNumber('DISPLAY_QUALITY', 82),
    },
    thumbnail: {
      width:   optionalNumber('THUMBNAIL_WIDTH', 300),
      height:  optionalNumber('THUMBNAIL_HEIGHT', 300),
      quality: optionalNumber('THUMBNAIL_QUALITY', 75),
    },
  },

  log: {
    level:  optional('LOG_LEVEL', 'info'),
    pretty: optional('LOG_PRETTY', 'false') === 'true' || optional('NODE_ENV', 'development') === 'development',
  },
} as const;

export type Config = typeof config;
