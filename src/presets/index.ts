import type { SharpPreset, ImageVariant } from '../types/index.js';
import { displayPreset } from './display.js';
import { thumbnailPreset } from './thumbnail.js';
import { largePreset } from './large.js';
import { printPreset } from './print.js';

/**
 * Central preset registry.
 *
 * Adding a new variant (e.g. "avatar"):
 *   1. Create src/presets/avatar.ts
 *   2. Add it here
 *   3. Add 'avatar' to ImageVariant type
 *   — No other changes needed.
 */
const presetMap: Record<ImageVariant, SharpPreset> = {
  thumbnail: thumbnailPreset,
  display:   displayPreset,
  large:     largePreset,
  print:     printPreset,
};

export function getPreset(variant: ImageVariant): SharpPreset {
  const preset = presetMap[variant];
  if (!preset) throw new Error(`No preset registered for variant: ${variant}`);
  return preset;
}

export { displayPreset, thumbnailPreset, largePreset, printPreset };
