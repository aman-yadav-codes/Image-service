# Image Processing Service

A production-ready, horizontally scalable image processing API built with Node.js, TypeScript, Sharp, BullMQ, Redis, and Docker.

## Architecture

```
POST /images/upload
       │
       ▼
 [image-api]
  ├── Validate (MIME, size)
  ├── Save original → storage/
  ├── Enqueue BullMQ jobs
  └── Return 202 { id, status: "queued" }

       │
       ▼
[Redis / BullMQ Queue]
       │
       ▼
[image-worker × N]
  ├── Load original
  ├── Apply Sharp preset
  └── Save display.webp / thumbnail.webp

       │
       ▼
GET /images/:id  →  { id, status, variants: { display, thumbnail } }
GET /images/:id/display    →  Serves WebP + Cache-Control: immutable
GET /images/:id/thumbnail  →  Serves WebP + Cache-Control: immutable
```

## Quick Start (Docker)

```bash
# Build and start all services (2 workers by default)
docker compose up --build

# Scale workers horizontally — no code changes required
docker compose up --scale image-worker=8
```

API is available at: `http://localhost:3000`

## Postman Testing

### 1. Upload an image

```
POST http://localhost:3000/images/upload
Content-Type: multipart/form-data
Field: image (file)
```

**Response 202:**
```json
{
  "id": "img_550e8400-e29b-41d4-a716-446655440000",
  "status": "queued",
  "originalFilename": "photo.jpg",
  "createdAt": "2024-01-15T10:00:00.000Z",
  "updatedAt": "2024-01-15T10:00:00.000Z",
  "variants": null
}
```

### 2. Poll status

```
GET http://localhost:3000/images/img_550e8400-e29b-41d4-a716-446655440000
```

**Response 200 (completed):**
```json
{
  "id": "img_550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "originalFilename": "photo.jpg",
  "createdAt": "2024-01-15T10:00:00.000Z",
  "updatedAt": "2024-01-15T10:00:02.000Z",
  "variants": {
    "display": "/images/img_550e8400-e29b-41d4-a716-446655440000/display.webp",
    "thumbnail": "/images/img_550e8400-e29b-41d4-a716-446655440000/thumbnail.webp"
  }
}
```

### 3. Download processed image

```
GET http://localhost:3000/images/img_550e8400-e29b-41d4-a716-446655440000/display
GET http://localhost:3000/images/img_550e8400-e29b-41d4-a716-446655440000/thumbnail
```

Both return WebP with:
```
Cache-Control: public, max-age=31536000, immutable
Content-Type: image/webp
```

### 4. Health check

```
GET http://localhost:3000/health
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | API HTTP port |
| `REDIS_HOST` | `localhost` | Redis hostname |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_PASSWORD` | — | Redis AUTH password |
| `REDIS_TLS` | `false` | Enable TLS for Redis |
| `STORAGE_DRIVER` | `local` | `local` \| `minio` \| `s3` |
| `STORAGE_LOCAL_PATH` | `./storage` | Base directory for local storage |
| `STORAGE_PUBLIC_BASE_URL` | `/images` | Public URL prefix |
| `MAX_FILE_SIZE_BYTES` | `20971520` | 20 MB upload limit |
| `ALLOWED_MIME_TYPES` | `image/jpeg,...` | Comma-separated allowed types |
| `WORKER_CONCURRENCY` | `5` | Jobs per worker process |
| `JOB_MAX_RETRIES` | `3` | Max retry attempts per job |
| `JOB_BACKOFF_DELAY_MS` | `2000` | Exponential back-off base delay |
| `LOG_LEVEL` | `info` | Pino log level |
| `LOG_PRETTY` | `false` | Enable pretty logs (dev only) |

## Image Variants

| Variant | Size | Format | Quality | Notes |
|---|---|---|---|---|
| `display` | Max 1920px wide | WebP | 82 | Preserves aspect ratio, no upscaling |
| `thumbnail` | 300×300 | WebP | 75 | Cover crop, entropy-based smart focus |

## Storage Structure

```
storage/
└── img_<uuid>/
    ├── original.jpg     ← never served publicly
    ├── display.webp
    └── thumbnail.webp
```

## Adding a New Variant (e.g. "avatar")

1. Create `src/presets/avatar.ts` implementing `SharpPreset`
2. Register it in `src/presets/index.ts`
3. Add `'avatar'` to `ImageVariant` in `src/types/index.ts`

No other changes required.

## Adding MinIO / S3 Storage

1. Create `src/storage/MinIOStorage.ts` implementing `StorageProvider`
2. Add a `case 'minio':` in `src/storage/index.ts`
3. Set `STORAGE_DRIVER=minio` + connection env vars

No business logic changes needed.

## Local Development (without Docker)

```bash
cp .env.example .env
npm install
npm run dev:api      # terminal 1
npm run dev:worker   # terminal 2
```

Requires a local Redis on port 6379.
