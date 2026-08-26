# Media Processing Microservice

Production-ready, horizontally scalable media processing API for images, videos, PDFs, and Excel files. Built with Node.js, TypeScript, Sharp, FFmpeg, Ghostscript, BullMQ, Redis, and MinIO.

## Architecture

```text
POST /media/upload
        |
        v
   Media Queue
        |
        +-- Sharp image variants
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

Image uploads create `thumbnail`, `display`, `large`, and `print` variants.
Video uploads create `hd`, `medium`, and `low` MP4 variants.
PDF uploads create a `compressed` PDF variant.
Excel files are stored as `original` and marked complete immediately.

## Scaling

Run media workers independently:

```bash
docker compose up -d --build
docker compose up -d --scale media-worker=2
```

Media worker concurrency is controlled by `MEDIA_WORKER_CONCURRENCY` (default `2`). Video encoding is CPU-intensive, so scale workers according to available CPU and memory.

## Storage

MinIO stores originals privately by object key and processed variants alongside them. Processed variants are served through the `/media` API and can also be exposed through the configured object-store/CDN layer.

## Local Development

```bash
cp .env.example .env
npm install
npm run dev:api
npm run dev:media-worker
```

For media processing, the worker host must have `ffmpeg` and `gs` (Ghostscript) installed. Docker is recommended because the media worker image includes these tools.

## Safety Limits

`MEDIA_MAX_FILE_SIZE_BYTES` defaults to 500 MB. Accepted media MIME types are configurable with `MEDIA_ALLOWED_MIME_TYPES`.
