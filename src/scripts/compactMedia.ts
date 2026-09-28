import 'dotenv/config';
import { promises as fs } from 'node:fs';
import sharp from 'sharp';
import { config } from '../config/index.js';
import { compactMediaToCanonicalImage } from '../services/mediaService.js';
import { storage } from '../storage/index.js';

const IMAGE_EXTENSIONS = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.png', '.tif', '.tiff', '.webp']);
const PREFERRED_SOURCES = ['image.webp', 'large.webp', 'display.webp', 'print.jpg', 'thumbnail.webp'];

function extension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
}

function selectImageSource(files: string[]): string | undefined {
  for (const preferred of PREFERRED_SOURCES) {
    if (files.includes(preferred)) return preferred;
  }
  return files.find((filename) => filename.startsWith('original.') && IMAGE_EXTENSIONS.has(extension(filename)));
}

async function convertToCanonicalImage(id: string): Promise<{ before: number; after: number } | null> {
  const files = await storage.listFiles(id);
  const source = selectImageSource(files);
  if (!source) return null;

  const input = await storage.readFile(id, source);
  const output = source === 'image.webp'
    ? input
    : await sharp(input, {
        failOn: 'error',
        limitInputPixels: config.image.maxImagePixels,
      })
        .resize(1920, undefined, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82, effort: 5 })
        .toBuffer();

  if (source !== 'image.webp') {
    await storage.save(id, 'image.webp', output, 'image/webp');
  }
  if (!(await compactMediaToCanonicalImage(id))) {
    throw new Error('Canonical image was written but metadata compaction failed');
  }
  return { before: input.length, after: output.length };
}

async function main(): Promise<void> {
  const idsFile = process.argv[2];
  const concurrency = Math.max(1, Math.min(Number(process.argv[3] ?? 4), 8));

  if (!idsFile) {
    throw new Error('Usage: node dist/scripts/compactMedia.js <media-ids-file> [concurrency]');
  }

  const ids = (await fs.readFile(idsFile, 'utf8'))
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);

  let cursor = 0;
  let compacted = 0;
  let skipped = 0;
  let failed = 0;
  let bytesBefore = 0;
  let bytesAfter = 0;

  async function runner(): Promise<void> {
    while (cursor < ids.length) {
      const id = ids[cursor++];
      if (!id) continue;
      try {
        const sizes = await convertToCanonicalImage(id);
        if (sizes) {
          compacted += 1;
          bytesBefore += sizes.before;
          bytesAfter += sizes.after;
        } else {
          skipped += 1;
        }
      } catch (error) {
        failed += 1;
        process.stderr.write(`Failed ${id}: ${error instanceof Error ? error.message : String(error)}\n`);
      }
      const processed = compacted + skipped + failed;
      if (processed % 1000 === 0 || processed === ids.length) {
        process.stdout.write(`Processed ${processed}/${ids.length}; compacted=${compacted}; skipped=${skipped}; failed=${failed}\n`);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => runner()));
  process.stdout.write(
    `Done; compacted=${compacted}; skipped=${skipped}; failed=${failed}; source_mb=${(bytesBefore / 1024 / 1024).toFixed(1)}; canonical_mb=${(bytesAfter / 1024 / 1024).toFixed(1)}\n`,
  );
  process.exit(failed > 0 ? 1 : 0);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
