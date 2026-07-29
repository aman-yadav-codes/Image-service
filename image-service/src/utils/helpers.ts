import { v4 as uuidv4 } from 'uuid';

/**
 * Generates a URL-safe image ID with an "img_" prefix.
 * Example: img_550e8400-e29b-41d4-a716-446655440000
 */
export function generateImageId(): string {
  return `img_${uuidv4()}`;
}

/**
 * Converts bytes to a human-readable string (e.g. "2.4 MB").
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/**
 * Returns current UTC ISO timestamp string.
 */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Sleeps for the specified number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
