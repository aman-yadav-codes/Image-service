import type { SharpPreset } from '../types/index.js';
import { config } from '../config/index.js';

/**
 * Print variant preset.
 *
 * Purpose : High-quality original resolution for prints or direct downloads.
 * Output  : Configured format (JPEG or PNG) at full resolution with high quality.
 */
export const printPreset: SharpPreset = {
  variant: 'print',
  get filename() {
    return config.presets.print.format === 'png' ? 'print.png' : 'print.jpg';
  },

  transform(pipeline) {
    pipeline = pipeline.rotate(); // auto-rotate from EXIF

    if (config.presets.print.format === 'png') {
      return pipeline.png({
        compressionLevel: 9,
        effort: 8,
      });
    } else {
      return pipeline.jpeg({
        quality: config.presets.print.quality,
        mozjpeg: true,
      });
    }
  },
};
