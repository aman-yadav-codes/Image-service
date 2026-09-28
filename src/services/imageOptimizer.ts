import sharp from 'sharp';
import { config } from '../config/index.js';

type CompressionStep = { width: number; quality: number };

function compressionSteps(): CompressionStep[] {
  const candidates = [
    [config.image.maxWidth, config.image.webpQuality],
    [1600, config.image.webpQuality - 4],
    [1280, config.image.webpQuality - 8],
    [1024, config.image.webpQuality - 12],
    [896, config.image.webpQuality - 16],
    [768, config.image.webpQuality - 20],
    [640, config.image.webpQuality - 26],
    [512, config.image.webpQuality - 32],
    [384, config.image.webpQuality - 38],
    [256, 20],
  ] as const;
  const seen = new Set<string>();

  return candidates
    .map(([width, quality]) => ({
      width: Math.min(width, config.image.maxWidth),
      quality: Math.max(20, Math.min(quality, 100)),
    }))
    .filter((step) => {
      const key = `${step.width}:${step.quality}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export async function optimizeImage(inputBuffer: Buffer): Promise<Buffer> {
  let smallest: Buffer | undefined;

  for (const step of compressionSteps()) {
    const output = await sharp(inputBuffer, {
      failOn: 'error',
      limitInputPixels: config.image.maxImagePixels,
    })
      .rotate()
      .resize(step.width, undefined, { fit: 'inside', withoutEnlargement: true })
      .webp({
        quality: step.quality,
        effort: config.image.webpEffort,
        smartSubsample: true,
        alphaQuality: step.quality,
      })
      .toBuffer();

    if (!smallest || output.length < smallest.length) smallest = output;
    if (output.length <= config.image.targetBytes) return output;
  }

  if (smallest && smallest.length <= config.image.maxBytes) return smallest;
  throw new Error(`Unable to compress image below ${config.image.maxBytes} bytes`);
}
