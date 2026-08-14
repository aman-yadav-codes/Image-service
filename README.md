# Media Processing Microservice

Production-ready, horizontally scalable image, video, and PDF processing API built with Node.js, TypeScript, Sharp, FFmpeg, qpdf, Ghostscript, BullMQ, Redis, and MinIO.

## Architecture

```text
POST /images/upload                    POST /media/upload
        │                                      │
        ▼                                      ▼
   Image Queue                            Media Queue
        │                                      │
   Sharp Workers                    ┌──────────┴──────────┐
        │                           │                     │
        │                       FFmpeg Worker         PDF Worker
        │                           │                     │
        └───────────────┬───────────┴─────────────────────┘
                        ▼
                      MinIO
```

The original image pipeline remains unchanged. Media processing uses a separate BullMQ queue and dedicated workers so CPU-heavy video/PDF jobs cannot starve image processing.

## Media Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/media/upload` | Upload a video or PDF (`file` multipart field) |
| `GET` | `/media/:id` | Poll processing status |
| `GET` | `/media/:id/:variant` | Stream a processed variant |

### Video variants

- `720p` — H.264/AAC MP4, CRF 23
- `480p` — H.264/AAC MP4, CRF 25
- `poster` — JPEG preview frame

FFmpeg is used for transcoding and `+faststart` is enabled for browser-friendly MP4 playback.

### PDF variants

- `lossless` — qpdf structural/object-stream optimization. No intentional image-quality reduction.
- `balanced` — Ghostscript `/ebook` optimization. Smaller output with image recompression/downsampling where applicable.

Lossless PDF compression cannot guarantee a smaller file for every PDF, especially when images are already compressed.

## Scaling

Run image and media workers independently:

```bash
docker compose up -d --build
docker compose up -d --scale image-worker=4 --scale media-worker=2
```

Media worker concurrency is controlled by `MEDIA_WORKER_CONCURRENCY` (default `2`). Video encoding is CPU-intensive, so scale media workers according to available CPU and memory.

## Storage

MinIO stores originals privately by object key and processed variants alongside them. Processed variants are served through the API and can also be exposed through the configured object-store/CDN layer.

## Local Development

```bash
cp .env.example .env
npm install
npm run dev:api
npm run dev:worker
```

For media processing, the worker host must have `ffmpeg`, `qpdf`, and `gs` (Ghostscript) installed. Docker is recommended because the media worker image includes these tools.

## Safety limits

`MEDIA_MAX_FILE_SIZE_BYTES` defaults to 500 MB. Accepted media MIME types are configurable with `MEDIA_ALLOWED_MIME_TYPES`.
