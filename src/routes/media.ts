import { Router } from 'express';
import { mediaUpload } from '../middleware/mediaUpload.js';
import { requireAuth } from '../middleware/auth.js';
import {
  handleMediaUpload,
  handleMediaStatus,
  handleMediaVariant,
  handleHealth,
} from '../controllers/mediaController.js';
import { handleMetrics } from '../utils/metrics.js';

export const mediaRouter = Router();

// ─── Health & Metrics ─────────────────────────────────────────────────────────

/**
 * @route   GET /health
 * @desc    Liveness probe
 */
mediaRouter.get('/health', handleHealth);

/**
 * @route   GET /metrics
 * @desc    Prometheus metrics
 */
mediaRouter.get('/metrics', handleMetrics);

// ─── Upload ───────────────────────────────────────────────────────────────────

/**
 * @route   POST /media/upload
 * @desc    Upload any file — image, video, PDF, or Excel.
 *          Auto-detects the file type by MIME and routes to the appropriate pipeline:
 *            - Image  → optimised into 4 variants (thumbnail, display, large, print) via Sharp
 *            - Video  → transcoded into 3 variants (hd/720p, medium/480p, low/360p) via FFmpeg
 *            - PDF    → compressed via Ghostscript (1 variant: compressed)
 *            - Excel  → stored as-is (no processing), immediately available
 *
 * @body    multipart/form-data
 *   @field  file  (File, required) — the file to upload
 *
 * @returns 202 JSON with { id, kind, status, variants, ... }
 *          Poll GET /media/:id to check progress.
 *          variant URLs are available at GET /media/:id/:variant once completed.
 */
mediaRouter.post('/media/upload', requireAuth, mediaUpload.single('file'), handleMediaUpload);

// ─── Status ───────────────────────────────────────────────────────────────────

/**
 * @route   GET /media/:id
 * @desc    Poll processing status. Returns variant URLs when status is "completed".
 *
 * @example   GET /media/media_550e8400-...
 */
mediaRouter.get('/media/:id', handleMediaStatus);

// ─── Serve variant ────────────────────────────────────────────────────────────

/**
 * @route   GET /media/:id/:variant
 * @route   GET /media/:id/:variant/:seoname
 * @desc    Stream a processed variant by media ID and variant name.
 *
 * Image variants:  thumbnail | display | large | print
 * Video variants:  hd | medium | low
 * PDF variants:    compressed
 * Excel variants:  original
 *
 * Without name field at upload:   /media/:id/display.webp
 * With name="Product Photo":      /media/:id/display/product-photo.webp
 *                                 /media/:id/hd/product-photo.mp4
 *                                 /media/:id/compressed/product-photo.pdf
 *                                 /media/:id/original/product-photo.xlsx
 *
 * The :seoname segment is ignored for file lookup — only :variant is used.
 */
mediaRouter.get('/media/:id/:variant', handleMediaVariant);
mediaRouter.get('/media/:id/:variant/:seoname', handleMediaVariant);
