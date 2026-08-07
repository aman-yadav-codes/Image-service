# Image Processing Microservice

A production-ready, horizontally scalable image processing API built with Node.js, TypeScript, Sharp, BullMQ, Redis, and MinIO.

## Architecture

```
POST /images/upload
       │
       ▼
 [image-api :4001]
  ├── Validate (MIME, size)
  ├── Upload original → MinIO
  ├── Enqueue BullMQ jobs (4 variants)
  └── Return 202 { id, status: "queued" }

       │
       ▼
[Redis / BullMQ Queue]
       │
       ▼
[image-worker × N]
  ├── Load original from MinIO
  ├── Apply Sharp preset (thumbnail / display / large / print)
  └── Save processed variants → MinIO

       │
       ▼
GET /images/:id  →  { status, variants: { thumbnail, display, large, print } }
```

## Quick Start (Docker)

```bash
cd Image-service
cp .env.example .env
# Edit .env — set MINIO_PUBLIC_ENDPOINT, credentials, DATA_ROOT
docker compose up --build -d

# Scale workers
docker compose up -d --scale image-worker=4
```

API is available at: `http://localhost:4001`

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness probe |
| `GET` | `/metrics` | Prometheus metrics |
| `POST` | `/images/upload` | Upload image (multipart) |
| `GET` | `/images/:id` | Poll processing status |
| `GET` | `/images/:id/:variant` | Serve variant directly |
| `GET` | `/images/:seoFilename` | Serve by SEO filename |

## Image Variants

| Variant | Output | Quality | Notes |
|---|---|---|---|
| `thumbnail` | 256×256 WebP | 75 | Cover crop, entropy-based smart focus |
| `display` | 1280px max-width WebP | 82 | Preserves aspect ratio |
| `large` | 1920px max-width WebP | 85 | High-res variant |
| `print` | Full resolution PNG | 95 | Lossless, no scaling |

## Prometheus Metrics

Metrics are exposed at `GET /metrics` — no local Prometheus needed.
Point your global Prometheus at `http://YOUR_SERVER_IP:4001/metrics`.

Available metrics:
- `http_request_duration_seconds` — request latency
- `http_requests_total` — request count
- `image_uploads_total` — upload count (success/error)
- `image_upload_size_bytes` — upload size distribution
- `bullmq_queue_jobs_total` — queue depth by status

## Storage (MinIO)

```
MinIO Bucket: images
└── img_<uuid>/
    ├── original.jpg     ← stored on upload (never served publicly)
    ├── thumbnail.webp   ← 256×256
    ├── display.webp     ← 1280px
    ├── large.webp       ← 1920px
    └── print.png        ← full res
```

Bucket policy: `public-read` — processed variants are directly accessible via URL.

## Local Development (without Docker)

```bash
cp .env.example .env
# Change DATA_ROOT=C:/docker-data, PORT=4001
npm install
npm run dev:api      # terminal 1
npm run dev:worker   # terminal 2
```

Requires a local Redis on port 6379 and MinIO running.

## Adding a New Variant (e.g. "avatar")

1. Create `src/presets/avatar.ts` implementing `SharpPreset`
2. Register it in `src/presets/index.ts`
3. Add `'avatar'` to `ImageVariant` in `src/types/index.ts`

No other changes required.

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for full Ubuntu production setup.
