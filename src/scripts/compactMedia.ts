import 'dotenv/config';
import { promises as fs } from 'node:fs';
import { compactMediaForDisplay } from '../services/mediaService.js';

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

  async function runner(): Promise<void> {
    while (cursor < ids.length) {
      const index = cursor++;
      const id = ids[index];
      if (!id) continue;
      try {
        if (await compactMediaForDisplay(id)) compacted += 1;
        else skipped += 1;
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
  process.stdout.write(`Done; compacted=${compacted}; skipped=${skipped}; failed=${failed}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
