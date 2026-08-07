import type { ImageVariant } from '../types/index.js';

// ─── Slug Generation ──────────────────────────────────────────────────────────

/**
 * Converts any string (filename, title, etc.) into a URL-safe, SEO-friendly slug.
 *
 * Rules:
 *  1. Strip file extension
 *  2. Lowercase
 *  3. Replace whitespace runs with single hyphen
 *  4. Remove any character that is not a-z, 0-9, or hyphen
 *  5. Collapse consecutive hyphens
 *  6. Trim leading/trailing hyphens
 *  7. Clamp to maxLength characters
 *
 * Examples:
 *   "IMG_1234.JPG"            → "img-1234"
 *   "My Blue Running Shoes!!" → "my-blue-running-shoes"
 *   "  hello   world .png"   → "hello-world"
 */
export function generateSlug(input: string, maxLength = 60): string {
  return input
    .replace(/\.[^.]+$/, '')          // strip extension
    .toLowerCase()
    .replace(/\s+/g, '-')             // whitespace → hyphen
    .replace(/[^a-z0-9-]/g, '')       // remove non-url chars
    .replace(/-+/g, '-')              // collapse multiple hyphens
    .replace(/^-+|-+$/g, '')          // trim edge hyphens
    .slice(0, maxLength)
    .replace(/-+$/, '');              // trim any trailing hyphen after slice
}

// ─── Short ID ─────────────────────────────────────────────────────────────────

/**
 * Extracts the first 8 hex characters from an image ID for use in public filenames.
 *
 * imageId = "img_550e8400-e29b-41d4-a716-446655440000"
 * shortId = "550e8400"
 *
 * This gives a compact, deterministic, collision-resistant suffix.
 */
export function extractShortId(imageId: string): string {
  const uuid = imageId.startsWith('img_') ? imageId.slice(4) : imageId;
  return uuid.replace(/-/g, '').slice(0, 8);
}

// ─── Public Filename ──────────────────────────────────────────────────────────

/**
 * Builds the SEO-friendly public filename for a given variant.
 *
 * Format:  {slug}-{variant}-{shortId}.webp
 *
 * Examples:
 *   buildPublicFilename("blue-running-shoes", "display",   "550e8400")
 *     → "blue-running-shoes-display-550e8400.webp"
 *
 *   buildPublicFilename("blue-running-shoes", "thumbnail", "550e8400")
 *     → "blue-running-shoes-thumbnail-550e8400.webp"
 */
import { config } from '../config/index.js';

export function buildPublicFilename(
  slug: string,
  variant: ImageVariant,
  shortId: string,
): string {
  if (variant === 'print') {
    const ext = config.presets.print.format === 'png' ? 'png' : 'jpg';
    return `${slug}-${variant}-${shortId}.${ext}`;
  }
  return `${slug}-${variant}-${shortId}.webp`;
}

/**
 * Builds the full public URL path for a variant.
 * e.g. "/images/blue-running-shoes-display-550e8400.webp"
 */
export function buildPublicUrl(
  slug: string,
  variant: ImageVariant,
  shortId: string,
  baseUrl = '/images',
): string {
  return `${baseUrl}/${buildPublicFilename(slug, variant, shortId)}`;
}
