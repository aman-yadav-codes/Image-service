# Standalone Observability (Monitoring) Stack

This directory contains the independent Docker Stack for observability. It includes:
* **Grafana**: Dashboard visualization UI (provisioned with Prometheus & Loki).
* **Prometheus**: Metrics scraper (polls metrics from services like `image-api`).
* **Loki**: Centralized log storage database.
* **Promtail**: Log shipper (scrapes Docker container output logs and forwards them to Loki).

## Prerequisites

Ensure the shared external network exists on the Docker host:
```bash
docker network create observability-net
```

## Running the Monitoring Stack

Start the observability services:
```bash
docker compose up -d
```

Once running:
* **Grafana UI**: http://localhost:3200 (Default data sources for Prometheus & Loki are pre-configured!)
* **Prometheus**: http://localhost:9090
* **Loki**: http://localhost:3100

## How it Connects to the Services

1. **Metrics Collection**: 
   Prometheus connects to the shared `observability-net` network and scrapes metrics from the Express API container at `http://image-api:4000/metrics`.
2. **Log Collection**: 
   Promtail mounts the host's `/var/run/docker.sock` socket to dynamically detect and tail the logs of all running containers (such as the Image Service, AI Service, and Notification Service) and ships them over HTTP directly to Loki.
