# 🚀 Deployment Guide — Image Processing Service (MinIO Edition)

## Services & Ports

| Service | Port | URL | Purpose |
|---|---|---|---|
| `image-api` | 4000 | http://localhost:4000 | REST API |
| `minio` | 9000 | http://localhost:9000 | S3-compatible object store API |
| `minio` | 9001 | http://localhost:9001 | **MinIO Console (dashboard)** |
| `redis` | 6379 | localhost:6379 | BullMQ broker |

---

## Prerequisites

| Tool | Version | Check |
|---|---|---|
| Docker | ≥ 24.x | `docker --version` |
| Docker Compose | ≥ 2.x | `docker compose version` |

> Node.js is **not** required on the host — everything runs inside Docker.

---

## 1. Clone & Configure

```bash
git clone <your-repo-url>
cd image-service
cp .env.example .env
```

The `.env` file is pre-configured for MinIO. No changes needed for local development.

---

## 2. Build & Start All Services

```bash
docker compose up --build -d
```

This starts:
- **Redis** — BullMQ queue broker
- **MinIO** — object store (API + dashboard)
- **minio-init** — one-shot bucket creator (exits after creating `images` bucket)
- **image-api** — REST API (2× replicas)
- **image-worker** — BullMQ workers (2× replicas by default)

### Check status

```bash
docker compose ps
```

Expected:

```
NAME                        STATUS
image-service-redis         running (healthy)
image-service-minio         running (healthy)
image-service-minio-init    exited (0)          ← normal — runs once and exits
image-service-api           running (healthy)
image-service-worker-1      running
image-service-worker-2      running
```

---

## 3. MinIO Dashboard

Open in browser: **http://localhost:9001**

| Field | Value |
|---|---|
| Username | `minioadmin` |
| Password | `minioadmin123` |

### What you'll see

- **Buckets** → `images` bucket (auto-created, public-read)
- **Object Browser** → browse uploaded files per image ID
  ```
  images/
  └── img_<uuid>/
      ├── original.jpg
      ├── display.webp
      └── thumbnail.webp
  ```
- **Monitoring** → bandwidth, request rates, storage usage
- **Access Keys** → manage credentials
- **Settings** → configure storage regions, notifications

---

## 4. Verify API is Running

```bash
curl http://localhost:4000/health
```

```json
{
  "status": "ok",
  "service": "image-api",
  "timestamp": "2024-01-15T10:00:00.000Z"
}
```

---

## 5. Scale Workers

```bash
docker compose up --scale image-worker=8 -d
```

Workers pull jobs independently from Redis. No code changes, no restarts of other services.

---

## 6. Postman — Full Test Walkthrough

### Step 1 — Upload an Image

```
POST http://localhost:4000/images/upload
Body → form-data
  Key: image  (type: File)
  Value: (select any JPG / PNG / WebP)
```

**Response `202 Accepted`:**

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

Copy the `id` value.

---

### Step 2 — Poll for Status

```
GET http://localhost:4000/images/img_550e8400-e29b-41d4-a716-446655440000
```

**Response `200` — completed:**

```json
{
  "id": "img_550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "originalFilename": "photo.jpg",
  "createdAt": "2024-01-15T10:00:00.000Z",
  "updatedAt": "2024-01-15T10:00:02.000Z",
  "variants": {
    "display":   "http://localhost:9000/images/img_550e8400-.../display.webp",
    "thumbnail": "http://localhost:9000/images/img_550e8400-.../thumbnail.webp"
  }
}
```

> **With MinIO**, the `variants` URLs point **directly to MinIO** (no API roundtrip).
> Browsers/CDNs can cache and fetch the files directly.

---

### Step 3 — Download Variants (two methods)

**Method A — Direct MinIO URL** *(preferred, CDN-friendly)*:

```
GET http://localhost:9000/images/img_550e8400-.../display.webp
GET http://localhost:9000/images/img_550e8400-.../thumbnail.webp
```

**Method B — Via API** *(also works, streams from MinIO)*:

```
GET http://localhost:4000/images/img_550e8400-.../display
GET http://localhost:4000/images/img_550e8400-.../thumbnail
```

Both return `Content-Type: image/webp` with `Cache-Control: public, max-age=31536000, immutable`.

---

### Step 4 — View Files in MinIO Dashboard

1. Open http://localhost:9001
2. Login: `minioadmin` / `minioadmin123`
3. Go to **Object Browser** → `images` bucket
4. Navigate to `img_550e8400-.../` — you'll see all 3 files

---

### Step 5 — Error Cases

| Request | Expected |
|---|---|
| Upload `.txt` file | `415 Unsupported Media Type` |
| Upload > 20 MB file | `413 Payload Too Large` |
| `GET /images/img_unknown` | `404 Not Found` |
| `GET /images/:id/display` before done | `404 Not Found` |
| No `image` field in form | `400 Bad Request` |

---

## 7. Image Variants

| Variant | API path | Output | Quality | Notes |
|---|---|---|---|---|
| `display` | `/images/:id/display` | 1920px max-width WebP | 82 | Preserves aspect ratio, no upscaling, EXIF rotate |
| `thumbnail` | `/images/:id/thumbnail` | 300×300 WebP | 75 | Cover crop, entropy-based smart focus |

---

## 8. Storage Architecture (with MinIO)

```
MinIO Bucket: images
└── img_550e8400-<uuid>/
    ├── original.jpg        ← stored on upload (Content-Type: image/jpeg)
    ├── display.webp        ← generated by worker (Cache-Control: immutable)
    └── thumbnail.webp      ← generated by worker (Cache-Control: immutable)
```

**Bucket policy**: `public-read` — all `*.webp` files are directly accessible via URL without authentication.

**Originals** are stored but never linked in API responses — they're only read by workers internally.

---

## 9. Logs

```bash
# All services
docker compose logs -f

# API only
docker compose logs -f image-api

# Workers only
docker compose logs -f image-worker

# MinIO only
docker compose logs -f minio
```

---

## 10. Stop / Restart / Reset

```bash
# Stop all (keeps MinIO data volume)
docker compose down

# Stop + delete ALL data (MinIO + Redis volumes)
docker compose down -v

# Restart a single service
docker compose restart image-api
docker compose restart image-worker
```

---

## 11. Production Checklist

- [ ] Change `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD` to strong credentials
- [ ] Set `REDIS_PASSWORD`
- [ ] Set `NODE_ENV=production`
- [ ] Set `LOG_PRETTY=false` (JSON logs for aggregators like Loki/ELK)
- [ ] Update `MINIO_PUBLIC_ENDPOINT` to your public domain (e.g. `https://cdn.yourdomain.com`)
- [ ] Mount `minio_data` volume to a persistent disk
- [ ] Put Nginx / Traefik in front of the API (port 4000 → 80/443)
- [ ] Use MinIO's HTTPS endpoint (`MINIO_USE_SSL=true`) in production
- [ ] Scale workers: `--scale image-worker=<N>` where N ≈ CPU cores

---

## 12. Deploy to VPS (Linux)

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Clone
git clone <your-repo-url>
cd image-service
cp .env.example .env

# Edit env — update MinIO credentials + public endpoint
nano .env

# Start (4 workers)
docker compose up --build -d --scale image-worker=4

# Check
curl http://localhost:4000/health
```

### Nginx reverse proxy for API

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;
    client_max_body_size 25M;

    location / {
        proxy_pass         http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header   Host            $host;
        proxy_set_header   X-Real-IP       $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 30s;
    }
}

# MinIO dashboard (optional — keep behind VPN in prod)
server {
    listen 80;
    server_name minio.yourdomain.com;

    location / {
        proxy_pass              http://localhost:9001;
        proxy_http_version      1.1;
        proxy_set_header        Upgrade    $http_upgrade;
        proxy_set_header        Connection "upgrade";
        proxy_set_header        Host       $host;
        proxy_buffering         off;
    }
}
```

---

## 13. Environment Variables Reference

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4000` | API HTTP port |
| `NODE_ENV` | `development` | `production` / `development` |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `LOG_PRETTY` | `false` | `true` for dev only |
| `REDIS_HOST` | `localhost` | Redis hostname |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_PASSWORD` | — | Redis AUTH |
| `STORAGE_DRIVER` | `minio` | `local` / `minio` |
| `MINIO_ENDPOINT` | `localhost` | MinIO API hostname |
| `MINIO_PORT` | `9000` | MinIO API port |
| `MINIO_CONSOLE_PORT` | `9001` | MinIO Dashboard / Console port |
| `MINIO_USE_SSL` | `false` | `true` for HTTPS |
| `MINIO_ACCESS_KEY` | `minioadmin` | MinIO username |
| `MINIO_SECRET_KEY` | `minioadmin123` | MinIO password |
| `MINIO_BUCKET` | `images` | Storage bucket name |
| `MINIO_REGION` | `us-east-1` | Bucket region |
| `MINIO_PUBLIC_ENDPOINT` | `http://localhost:9000` | Browser-accessible MinIO URL |
| `MAX_FILE_SIZE_BYTES` | `20971520` | Upload limit (20 MB) |
| `WORKER_CONCURRENCY` | `5` | Jobs per worker process |
| `JOB_MAX_RETRIES` | `3` | Max retry attempts |
| `JOB_BACKOFF_DELAY_MS` | `2000` | Retry back-off base |
| `WORKER_CPU_LIMIT` | `1.0` | CPU limit for worker container |
| `WORKER_MEMORY_LIMIT` | `512M` | Memory limit for worker container |

