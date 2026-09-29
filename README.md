# Media Processing Microservice

Production-ready, horizontally scalable media processing API for images, videos, PDFs, and Excel files. Built with Node.js, TypeScript, a Python WebP compressor, FFmpeg, Ghostscript, BullMQ, Redis, and MinIO.

## Architecture

```text
POST /media/upload
        |
        v
   Media Queue
        |
        +-- Python WebP image compression
        +-- FFmpeg video variants
        +-- Ghostscript PDF compression
        +-- Excel pass-through
        |
        v
      MinIO
```

All uploads go through the unified `/media` API.

## Media Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/media/upload` | Upload an image, video, PDF, or Excel file (`file` multipart field) |
| `GET` | `/media/:id` | Poll processing status |
| `GET` | `/media/:id/:variant` | Stream a processed variant |
| `GET` | `/media/:id/:variant/:seoname` | Stream a processed variant with SEO filename |
| `PATCH` | `/media/:id` | Update mutable metadata |
| `PUT` | `/media/:id` | Replace the file for an existing media record |
| `DELETE` | `/media/:id` | Delete a media record and its files |

## Upload Example

```text
POST /media/upload
Content-Type: multipart/form-data
Cookie: __Secure-better-auth.session_token=<session-token>

file: <file>
name: my-photo
```

The service also accepts `Authorization: Bearer <session-token>` for tools such as Postman.

## Variants

Each image upload produces `banner` and `thumbnail` variants. Banner targets 60-150 KiB and thumbnail targets 25-60 KiB. A source already within a variant's maximum is reused byte-for-byte for that variant; larger sources are converted by the Python compressor to the highest-quality WebP that fits the maximum. Pixel dimensions remain unchanged, and sources that cannot meet a maximum without resizing fail instead of silently changing dimensions. The original is retained so both variants can be generated safely.
Video uploads create `hd`, `medium`, and `low` MP4 variants.
PDF uploads create a `compressed` PDF variant.
Excel files are stored as `original` and marked complete immediately.

## Scaling

Workers share one BullMQ queue, so banner and thumbnail jobs are distributed across four worker replicas. Per-variant passthrough avoids encoding entirely; larger images use the Python pyvips engine with one libvips thread per container and WebP effort `6`. Sharp is not used.

```bash
docker compose up -d --build
```

Capacity is configured through `MEDIA_WORKER_REPLICAS`, `MEDIA_WORKER_CONCURRENCY`, `MEDIA_WORKER_CPU_LIMIT`, and `MEDIA_WORKER_MEMORY_LIMIT`. Increase those environment values when the VPS gains more cores; no code change is required. BullMQ retries failed jobs and its shared Redis queue provides backpressure when uploads temporarily arrive faster than workers can transform them.

## Storage

MinIO stores originals privately by object key and processed variants alongside them. Processed variants are served through the `/media` API and can also be exposed through the configured object-store/CDN layer.

## Local Development

```bash
cp .env.example .env
npm install
npm run dev:api
npm run dev:media-worker
```

For media processing, the worker host must have Python with Pillow, `ffmpeg`, and `gs` (Ghostscript) installed. Docker is recommended because the media worker image includes these tools.

## Safety Limits

`MEDIA_MAX_FILE_SIZE_BYTES` defaults to 500 MB. Accepted media MIME types are configurable with `MEDIA_ALLOWED_MIME_TYPES`.
