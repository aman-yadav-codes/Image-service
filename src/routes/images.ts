import { Router } from 'express';
import { upload } from '../middleware/upload.js';
import {
  handleUpload,
  handleGetStatus,
  handleServeVariant,
  handleServeBySeoFilename,
  handleHealth,
} from '../controllers/imageController.js';

export const imageRouter = Router();

// ─── Health ───────────────────────────────────────────────────────────────────

/**
 * @route   GET /health
 * @desc    Liveness probe — no dependencies checked
 */
imageRouter.get('/health', handleHealth);

// ─── Upload ───────────────────────────────────────────────────────────────────

/**
 * @route   POST /images/upload
 * @desc    Upload an image. Returns 202 with image ID and queued status.
 *
 * @body    multipart/form-data
 *   @field  image  (File, required)  — the image file
 *   @field  slug   (string, optional) — SEO slug, e.g. "blue-running-shoes"
 *                  If omitted, auto-derived from the original filename.
 *
 * @example
 *   POST /images/upload
 *   Content-Type: multipart/form-data
 *   image: <file>
 *   slug: blue-running-shoes
 */
imageRouter.post('/images/upload', upload.single('image'), handleUpload);

// ─── SEO Public File Serve ────────────────────────────────────────────────────

/**
 * @route   GET /images/:seoFilename
 * @desc    Serve a processed variant by its SEO-friendly public filename.
 *          The filename is resolved via O(1) Redis lookup.
 *
 * @example
 *   GET /images/blue-running-shoes-display-550e8400.webp
 *   GET /images/blue-running-shoes-thumbnail-550e8400.webp
 *
 * This route is ordered BEFORE the /:id route so that .webp filenames
 * are matched here first, not treated as image IDs.
 */
imageRouter.get(
  /^\/images\/(.+\.(webp|jpg|jpeg|png))$/,
  (req, res, next) => {
    // Extract the captured filename from the regex match
    const match = req.path.match(/\/images\/(.+\.(webp|jpg|jpeg|png))$/);
    if (match) {
      req.params['seoFilename'] = match[1];
    }
    handleServeBySeoFilename(req, res, next);
  },
);

// ─── Status Poll ──────────────────────────────────────────────────────────────

/**
 * @route   GET /images/:id
 * @desc    Poll processing status. Returns variant URLs when status is "completed".
 *
 * @example
 *   GET /images/img_550e8400-e29b-41d4-a716-446655440000
 */
imageRouter.get('/images/:id', handleGetStatus);

// ─── Legacy Direct Variant Serve ─────────────────────────────────────────────

/**
 * @route   GET /images/:id/:variant
 * @desc    Serve a variant directly by image ID and variant name.
 *          Kept for internal tooling / backwards compatibility.
 *          Public clients should prefer the SEO route above.
 *
 * @example
 *   GET /images/img_550e8400-.../display
 *   GET /images/img_550e8400-.../thumbnail
 */
imageRouter.get('/images/:id/:variant', handleServeVariant);
