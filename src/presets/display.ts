import type { SharpPreset } from '../types/index.js';
import sharp from 'sharp';
import { config } from '../config/index.js';

/**
 * Display variant preset.
 *
 * Purpose : Large image displayed on pages, hero sections, detail views.
 * Output  : WebP, max-width (configured DISPLAY_WIDTH), quality (configured DISPLAY_QUALITY), aspect ratio preserved.
 */
export const displayPreset: SharpPreset = {
  variant: 'display',
  filename: 'display.webp',

  transform(pipeline) {
    return pipeline
      .rotate()                  // auto-rotate from EXIF
      .resize({
        width: config.presets.display.width,
        withoutEnlargement: true, // never upscale smaller images
        fit: sharp.fit.inside,
        kernel: sharp.kernel.lanczos3,
      })
      .webp({
        quality: config.presets.display.quality,
        effort: 4,               // balanced encode speed vs compression
        smartSubsample: true,
      });
  },
};
