import 'dotenv/config';
import { promises as fs } from 'node:fs';
import sharp from 'sharp';
import { config } from '../config/index.js';
import { compactMediaForDisplay } from '../services/mediaService.js';
import { storage } from '../storage/index.js';

async function recompressDisplay(id: string): Promise<{ before: number; after: number }> {
  const input = await storage.readFile(id, 'display.webp');
  const output = await sharp(input, {
    failOn: 'error',
    limitInputPixels: config.image.maxImagePixels,
  })
    .resize(1024, undefined, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 68, effort: 5 })
    .toBuffer();

  if (output.length < input.length) {
    await storage.save(id, 'display.webp', output, 'image/webp');
  }
  return { before: input.length, after: Math.min(input.length, output.length) };
}

async function main(): Promise<void> {
  const idsFile = process.argv[2];
  const concurrency = Math.max(1, Math.min(Number(process.argv[3] ?? 12), 32));

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
      const index = cursor++;
      const id = ids[index];
      if (!id) continue;
      try {
        if (await compactMediaForDisplay(id)) {
          const sizes = await recompressDisplay(id);
          compacted += 1;
          bytesBefore += sizes.before;
          bytesAfter += sizes.after;
        } else skipped += 1;
      } catch (error) {
        failed += 1;
        process.stderr.write(`Failed ${id}: ${error instanceof Error ? error.message : String(error)}\n`);
      }
      const processed = compacted + skipped + failed;
      if (processed % 1000 === 0 || processed === ids.length) {
        const savedMb = (bytesBefore - bytesAfter) / 1024 / 1024;
        process.stdout.write(`Processed ${processed}/${ids.length}; compacted=${compacted}; skipped=${skipped}; failed=${failed}; recompress_saved_mb=${savedMb.toFixed(1)}\n`);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => runner()));
  const beforeMb = bytesBefore / 1024 / 1024;
  const afterMb = bytesAfter / 1024 / 1024;
  process.stdout.write(`Done; compacted=${compacted}; skipped=${skipped}; failed=${failed}; before_mb=${beforeMb.toFixed(1)}; after_mb=${afterMb.toFixed(1)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
