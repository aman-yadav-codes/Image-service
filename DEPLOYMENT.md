# 🚀 Deployment Guide — Image Processing Microservice

## Services & Ports

| Service | Host Port | Internal Port | Purpose |
|---|---|---|---|
| `media-api` | **4001** | 4000 | REST API + `/metrics` endpoint |
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
git clone <your-repo-url> /opt/media-service
cd /opt/media-service
cp .env.example .env
nano .env
```

**Mandatory changes in `.env`:**

```env
MINIO_PUBLIC_ENDPOINT=http://YOUR_SERVER_IP:9000
MINIO_ACCESS_KEY=your-strong-access-key
MINIO_SECRET_KEY=your-strong-secret-key-min-16-chars
REDIS_PASSWORD=your-strong-redis-password
DATA_ROOT=/srv/media-service
```

---

## 2. Prepare Data Directories (Ubuntu)

```bash
sudo mkdir -p /srv/media-service/{minio,redis}
sudo chown -R $USER:$USER /srv/media-service
```

---

## 3. Build & Start

```bash
cd /opt/media-service
docker compose up --build -d
```

### Check status

```bash
docker compose ps
```

Expected:

```
NAME                        STATUS
media-service-redis         running (healthy)
media-service-minio         running (healthy)
media-service-minio-init    exited (0)          ← normal — runs once and exits
media-service-api           running (healthy)
media-service-worker-1      running
```

---

## 4. Verify API is Running

```bash
curl http://localhost:4001/health
```

```json
{ "status": "ok", "service": "media-api", "timestamp": "..." }
```

---

## 5. MinIO Web Console

Open: `http://YOUR_SERVER_IP:9001`  
Login with your `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY`.

---

## 6. Scale Workers

```bash
MEDIA_WORKER_REPLICAS=4 docker compose up -d media-worker
```

Each replica consumes from the same BullMQ queue. Keep per-replica concurrency and CPU limits conservative so a traffic spike cannot monopolize the VPS.

---

## 7. Prometheus Metrics (global Grafana)

This service exposes a Prometheus `/metrics` endpoint — no local Prometheus needed.

```
GET http://YOUR_SERVER_IP:4001/metrics
```

**Add to your global `prometheus.yml`:**

```yaml
scrape_configs:
  - job_name: 'media-service'
    scrape_interval: 15s
    static_configs:
      - targets: ['YOUR_SERVER_IP:4001']

  - job_name: 'media-service-minio'
    metrics_path: /minio/v2/metrics/cluster
    static_configs:
      - targets: ['YOUR_SERVER_IP:9000']
```

**Available custom metrics:**
- `http_request_duration_seconds` — latency by route
- `http_requests_total` — request count by method/route/status
- `bullmq_queue_jobs_total` — queue depth by status
- Standard Node.js process metrics (CPU, memory, event loop)

---

## 8. API Usage

### Upload

```
POST http://YOUR_SERVER_IP:4001/media/upload
Body → form-data
  file: <file>           (required — max 500 MB)
  name: "my-photo"       (optional SEO name)
```

**Response `202`:**
```json
{
  "id": "media_550e8400-e29b-41d4-a716-446655440000",
  "kind": "image",
  "status": "queued",
  "originalFilename": "photo.jpg"
}
```

### Poll Status

```
GET http://YOUR_SERVER_IP:4001/media/<id>
```

**Response `200` (completed):**
```json
{
  "id": "media_...",
  "kind": "image",
  "status": "completed",
  "url": "/media/media_.../image.webp",
  "variants": {
    "image": "/media/media_.../image.webp"
  }
}
```

### Image Variants

| Variant | Output | Notes |
|---|---|---|
| `image` | WebP | Python compressor, same pixel dimensions as the uploaded source, target-size quality search when possible |

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
docker compose logs -f media-api    # API only
docker compose logs -f media-worker # workers only
```

---

## 11. Stop / Restart

```bash
docker compose down                          # stop (data preserved)
docker compose restart media-api             # restart one service
MEDIA_WORKER_REPLICAS=4 docker compose up -d media-worker  # scale workers
```

---

## 12. Production Checklist

- [ ] Set strong `MINIO_ACCESS_KEY` and `MINIO_SECRET_KEY`
- [ ] Set `REDIS_PASSWORD`
- [ ] Set `NODE_ENV=production`, `LOG_PRETTY=false`
- [ ] Update `MINIO_PUBLIC_ENDPOINT` to your server IP / CDN domain
- [ ] Confirm `DATA_ROOT=/srv/media-service` and directories exist
- [ ] Add scrape targets to global Prometheus config
- [ ] Set `MEDIA_WORKER_REPLICAS` and bounded per-worker CPU/memory limits
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
| `MINIO_BUCKET` | `media` | Storage bucket name |
| `MINIO_PUBLIC_ENDPOINT` | — | Browser-accessible MinIO URL |
| `MEDIA_MAX_FILE_SIZE_BYTES` | `524288000` | Upload limit (500 MB) |
| `MEDIA_WORKER_REPLICAS` | `4` | Worker containers for high-throughput bulk imports |
| `MEDIA_WORKER_CONCURRENCY` | `1` | CPU-bound Python jobs per worker process |
| `IMAGE_WEBP_EFFORT` | `6` | Maximum WebP compression effort to retain the best quality within the hard byte budget |
| `IMAGE_COMPRESSOR_ENGINE` | `pyvips` | High-throughput Python/libvips engine; the service does not use Sharp |
| `IMAGE_COMPRESSOR_ALLOW_RESIZE` | `false` | Keep original dimensions; do not auto-downscale during compression |
| `VIPS_CONCURRENCY` | `1` | libvips threads per worker; replicas provide process-level parallelism |
| `JOB_MAX_RETRIES` | `3` | Max retry attempts |
| `MEDIA_WORKER_CPU_LIMIT` | `0.75` | CPU limit per worker container |
| `MEDIA_WORKER_MEMORY_LIMIT` | `1G` | Memory limit per worker container |
| `DATA_ROOT` | `/srv/media-service` | Host path for persistent storage |
