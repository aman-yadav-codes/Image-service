import type { SharpPreset } from '../types/index.js';
import sharp from 'sharp';
import { config } from '../config/index.js';

/**
 * Thumbnail variant preset.
 *
 * Purpose : Cards, listings, search results, previews.
 * Output  : WebP, width x height from config, cover fit, quality from config.
 */
export const thumbnailPreset: SharpPreset = {
  variant: 'thumbnail',
  filename: 'thumbnail.webp',

  transform(pipeline) {
    return pipeline
      .rotate()                  // auto-rotate from EXIF
      .resize({
        width: config.presets.thumbnail.width,
        height: config.presets.thumbnail.height,
        fit: sharp.fit.cover,
        position: sharp.strategy.entropy,  // smart crop: focus on high-detail region
        kernel: sharp.kernel.lanczos3,
      })
      .webp({
        quality: config.presets.thumbnail.quality,
        effort: 4,
        smartSubsample: true,
      });
  },
};
