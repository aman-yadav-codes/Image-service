import * as path from 'path';

function required(key: string): string { const val = process.env[key]; if (!val) throw new Error(`Missing required environment variable: ${key}`); return val; }
function optional(key: string, fallback: string): string { return process.env[key] ?? fallback; }
function optionalNumber(key: string, fallback: number): number { const val = process.env[key]; return val ? parseInt(val, 10) : fallback; }
function optionalBoolean(key: string, fallback: boolean): boolean {
  const val = process.env[key];
  if (val === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(val.trim().toLowerCase());
}

export const config = {
  env: optional('NODE_ENV', 'development') as 'development' | 'production' | 'test',
  api: {
    port: optionalNumber('PORT', 4000), host: optional('HOST', '0.0.0.0'),
    rateLimitEnabled: optionalBoolean('RATE_LIMIT_ENABLED', true),
    rateLimitWindowMs: optionalNumber('RATE_LIMIT_WINDOW_MS', 60_000), rateLimitMax: optionalNumber('RATE_LIMIT_MAX', 200),
    corsOrigins: optional('CORS_ORIGINS', 'https://new.findmy.co.za,http://localhost:3000,http://localhost:5173,http://localhost:4000,http://127.0.0.1:3000').split(',').map((o) => o.trim()).filter(Boolean),
  },
  redis: { host: optional('REDIS_HOST', 'localhost'), port: optionalNumber('REDIS_PORT', 6379), password: process.env['REDIS_PASSWORD'], db: optionalNumber('REDIS_DB', 0), tls: optional('REDIS_TLS', 'false') === 'true' },
  storage: { driver: optional('STORAGE_DRIVER', 'local') as 'local' | 'minio' | 's3', localBasePath: optional('STORAGE_LOCAL_PATH', path.join(process.cwd(), 'storage')) },
  minio: { endpoint: optional('MINIO_ENDPOINT', 'localhost'), port: optionalNumber('MINIO_PORT', 9000), useSSL: optional('MINIO_USE_SSL', 'false') === 'true', accessKey: optional('MINIO_ACCESS_KEY', 'minioadmin'), secretKey: optional('MINIO_SECRET_KEY', 'minioadmin123'), bucket: optional('MINIO_BUCKET', 'media'), region: optional('MINIO_REGION', 'us-east-1'), publicEndpoint: optional('MINIO_PUBLIC_ENDPOINT', 'http://localhost:9000') },
  queue: { maxRetries: optionalNumber('JOB_MAX_RETRIES', 3), backoffDelay: optionalNumber('JOB_BACKOFF_DELAY_MS', 2_000), keepCompletedMs: optionalNumber('JOB_KEEP_COMPLETED_MS', 3_600_000), keepFailedMs: optionalNumber('JOB_KEEP_FAILED_MS', 86_400_000) },
  image: {
    maxImagePixels: optionalNumber('MAX_IMAGE_PIXELS', 40000000),
    maxMetadataSize: optionalNumber('MAX_METADATA_SIZE', 1048576),
    maxWidth: optionalNumber('IMAGE_MAX_WIDTH', 1920),
    webpQuality: optionalNumber('IMAGE_WEBP_QUALITY', 96),
    webpEffort: optionalNumber('IMAGE_WEBP_EFFORT', 6),
    preferredMinBytes: optionalNumber('IMAGE_PREFERRED_MIN_BYTES', 50 * 1024),
    maxBytes: optionalNumber('IMAGE_MAX_BYTES', 70 * 1024),
  },
  media: {
    maxFileSizeBytes: optionalNumber('MEDIA_MAX_FILE_SIZE_BYTES', 500 * 1024 * 1024),
    allowedMimeTypes: optional('MEDIA_ALLOWED_MIME_TYPES', 'image/jpeg,image/png,image/webp,image/gif,image/tiff,image/avif,video/mp4,video/webm,video/quicktime,video/x-matroska,video/mpeg,video/avi,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv').split(','),
    workerConcurrency: optionalNumber('MEDIA_WORKER_CONCURRENCY', 2),
    videoPreset: optional('VIDEO_PRESET', 'veryfast'),
  },
  auth: {
    /**
     * Base URL of your main application server that runs Better Auth.
     * e.g. "http://your-main-app:4000" or "http://localhost:4000"
     * Leave empty to disable auth (dev only).
     */
    serverUrl: optional('AUTH_SERVER_URL', ''),
    /**
     * Better Auth session validation endpoint (relative path).
     * Default: /api/auth/get-session
     */
    sessionEndpoint: optional('AUTH_SESSION_ENDPOINT', '/api/auth/get-session'),
    /**
     * Name of the session cookie set by Better Auth.
     * Default: better-auth.session_token
     */
    cookieName: optional('SESSION_COOKIE_NAME', 'better-auth.session_token'),
  },
  log: { level: optional('LOG_LEVEL', 'info'), pretty: optional('LOG_PRETTY', 'false') === 'true' || optional('NODE_ENV', 'development') === 'development' },
} as const;

export type Config = typeof config;
