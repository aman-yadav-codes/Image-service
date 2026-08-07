import type { SharpPreset } from '../types/index.js';
import sharp from 'sharp';
import { config } from '../config/index.js';

/**
 * Large variant preset.
 *
 * Purpose : Large high-resolution images, full-screen displays, slideshows.
 * Output  : WebP, max-width (configured LARGE_WIDTH), quality (configured LARGE_QUALITY).
 */
export const largePreset: SharpPreset = {
  variant: 'large',
  filename: 'large.webp',

  transform(pipeline) {
    return pipeline
      .rotate()                  // auto-rotate from EXIF
      .resize({
        width: config.presets.large.width,
        withoutEnlargement: true, // never upscale smaller images
        fit: sharp.fit.inside,
        kernel: sharp.kernel.lanczos3,
      })
      .webp({
        quality: config.presets.large.quality,
        effort: 4,               // balanced encode speed vs compression
        smartSubsample: true,
      });
  },
};
