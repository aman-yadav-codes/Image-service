# 🚀 Deployment Guide — Image Processing Microservice

## Services & Ports

| Service | Host Port | Internal Port | Purpose |
|---|---|---|---|
| `image-api` | **4001** | 4000 | REST API + `/metrics` endpoint |
| `minio` | **9000** | 9000 | S3-compatible object store API |
| `minio` | **9001** | 9001 | MinIO web console |
| `redis` | 6379 (127.0.0.1 only) | 6379 | BullMQ broker — not exposed externally |

> **Existing server ports already occupied:** 80, 443 (nginx) · 3000 (nextjs-app) · 5432 (postgres)

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
git clone <your-repo-url> /opt/image-service
cd /opt/image-service/Image-service
cp .env.example .env
nano .env
```

**Mandatory changes in `.env`:**

```env
MINIO_PUBLIC_ENDPOINT=http://YOUR_SERVER_IP:9000
MINIO_ACCESS_KEY=your-strong-access-key
MINIO_SECRET_KEY=your-strong-secret-key-min-16-chars
REDIS_PASSWORD=your-strong-redis-password
DATA_ROOT=/srv/image-service
```

---

## 2. Prepare Data Directories (Ubuntu)

```bash
sudo mkdir -p /srv/image-service/{minio,redis}
sudo chown -R $USER:$USER /srv/image-service
```

---

## 3. Build & Start

```bash
cd /opt/image-service/Image-service
docker compose up --build -d
```

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
```

---

## 4. Verify API is Running

```bash
curl http://localhost:4001/health
```

```json
{ "status": "ok", "service": "image-api", "timestamp": "..." }
```

---

## 5. MinIO Web Console

Open: `http://YOUR_SERVER_IP:9001`  
Login with your `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY`.

---

## 6. Scale Workers

```bash
docker compose up -d --scale image-worker=4
```

---

## 7. Prometheus Metrics (global Grafana)

This service exposes a Prometheus `/metrics` endpoint — no local Prometheus needed.

```
GET http://YOUR_SERVER_IP:4001/metrics
```

**Add to your global `prometheus.yml`:**

```yaml
scrape_configs:
  - job_name: 'image-service'
    scrape_interval: 15s
    static_configs:
      - targets: ['YOUR_SERVER_IP:4001']

  - job_name: 'image-service-minio'
    metrics_path: /minio/v2/metrics/cluster
    static_configs:
      - targets: ['YOUR_SERVER_IP:9000']
```

**Available custom metrics:**
- `http_request_duration_seconds` — latency by route
- `http_requests_total` — request count by method/route/status
- `image_uploads_total` — uploads (success / error labels)
- `image_upload_size_bytes` — upload size distribution
- `bullmq_queue_jobs_total` — queue depth by status
- Standard Node.js process metrics (CPU, memory, event loop)

---

## 8. API Usage

### Upload

```
POST http://YOUR_SERVER_IP:4001/images/upload
Body → form-data
  image: <file>          (required — max 20 MB)
  slug:  "my-photo"      (optional SEO slug)
```

**Response `202`:**
```json
{
  "id": "img_550e8400-e29b-41d4-a716-446655440000",
  "status": "queued",
  "originalFilename": "photo.jpg"
}
```

### Poll Status

```
GET http://YOUR_SERVER_IP:4001/images/<id>
```

**Response `200` (completed):**
```json
{
  "id": "img_...",
  "status": "completed",
  "variants": {
    "thumbnail": "http://YOUR_SERVER_IP:9000/images/img_.../thumbnail.webp",
    "display":   "http://YOUR_SERVER_IP:9000/images/img_.../display.webp",
    "large":     "http://YOUR_SERVER_IP:9000/images/img_.../large.webp",
    "print":     "http://YOUR_SERVER_IP:9000/images/img_.../print.png"
  }
}
```

### Image Variants

| Variant | Output | Quality | Notes |
|---|---|---|---|
| `thumbnail` | 256×256 WebP | 75 | Cover crop, smart focus |
| `display` | 1280px WebP | 82 | Preserves aspect ratio |
| `large` | 1920px WebP | 85 | High-res variant |
| `print` | Full res PNG | 95 | Lossless, for downloads |

---

## 9. Nginx Reverse Proxy (optional)

```nginx
server {
    listen 80;
    server_name images-api.yourdomain.com;
    client_max_body_size 25M;

    location / {
        proxy_pass         http://localhost:4001;
        proxy_http_version 1.1;
        proxy_set_header   Host            $host;
        proxy_set_header   X-Real-IP       $remote_addr;
        proxy_read_timeout 30s;
    }
}
```

---

## 10. Logs

```bash
docker compose logs -f             # all services
docker compose logs -f image-api   # API only
docker compose logs -f image-worker # workers only
```

---

## 11. Stop / Restart

```bash
docker compose down                          # stop (data preserved)
docker compose restart image-api             # restart one service
docker compose up -d --scale image-worker=4  # scale workers
```

---

## 12. Production Checklist

- [ ] Set strong `MINIO_ACCESS_KEY` and `MINIO_SECRET_KEY`
- [ ] Set `REDIS_PASSWORD`
- [ ] Set `NODE_ENV=production`, `LOG_PRETTY=false`
- [ ] Update `MINIO_PUBLIC_ENDPOINT` to your server IP / CDN domain
- [ ] Confirm `DATA_ROOT=/srv/image-service` and directories exist
- [ ] Add scrape targets to global Prometheus config
- [ ] Scale workers: `docker compose up -d --scale image-worker=2`
- [ ] (Optional) Put Nginx in front of port 4001

---

## 13. Environment Variables Reference

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4001` | Host port for the API |
| `NODE_ENV` | `production` | Runtime environment |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `LOG_PRETTY` | `false` | `true` for dev only |
| `REDIS_HOST` | `redis` | Redis service name inside Docker |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_PASSWORD` | — | Redis AUTH password |
| `STORAGE_DRIVER` | `minio` | `local` / `minio` |
| `MINIO_ENDPOINT` | `minio` | MinIO service name inside Docker |
| `MINIO_PORT` | `9000` | MinIO API port |
| `MINIO_CONSOLE_PORT` | `9001` | MinIO console port |
| `MINIO_ACCESS_KEY` | — | MinIO username |
| `MINIO_SECRET_KEY` | — | MinIO password |
| `MINIO_BUCKET` | `images` | Storage bucket name |
| `MINIO_PUBLIC_ENDPOINT` | — | Browser-accessible MinIO URL |
| `MAX_FILE_SIZE_BYTES` | `20971520` | Upload limit (20 MB) |
| `WORKER_CONCURRENCY` | `2` | Jobs per worker process |
| `JOB_MAX_RETRIES` | `3` | Max retry attempts |
| `WORKER_CPU_LIMIT` | `1.0` | CPU limit per worker container |
| `WORKER_MEMORY_LIMIT` | `512M` | Memory limit per worker container |
| `DATA_ROOT` | `/srv/image-service` | Host path for persistent storage |
