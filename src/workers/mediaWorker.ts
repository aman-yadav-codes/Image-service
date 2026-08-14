import 'dotenv/config';
import { Worker } from 'bullmq';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import sharp from 'sharp';
import { createRedisConnection } from '../config/redis.js';
import { config } from '../config/index.js';
import { storage } from '../storage/index.js';
import { logger } from '../utils/logger.js';
import { markMediaVariantCompleted, markMediaFailed } from '../services/mediaService.js';
import type { MediaJobData } from '../types/media.js';

const execFileAsync = promisify(execFile);

async function run(command: string, args: string[]): Promise<void> {
  await execFileAsync(command, args, { maxBuffer: 1024 * 1024 * 16 });
}

// ─── Image processing via Sharp (4 variants) ──────────────────────────────────

async function processImage(
  variant: string,
  inputBuffer: Buffer,
): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
  const pipeline = sharp(inputBuffer, {
    failOn: 'error',
    limitInputPixels: config.image.maxImagePixels,
  });

  let outputBuffer: Buffer;
  let filename: string;

  switch (variant) {
    case 'thumbnail':
      outputBuffer = await pipeline
        .resize(256, 256, { fit: 'cover', position: 'centre' })
        .webp({ quality: 75 })
        .toBuffer();
      filename = 'thumbnail.webp';
      break;

    case 'display':
      outputBuffer = await pipeline
        .resize(1280, undefined, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
      filename = 'display.webp';
      break;

    case 'large':
      outputBuffer = await pipeline
        .resize(1920, undefined, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer();
      filename = 'large.webp';
      break;

    case 'print':
      outputBuffer = await pipeline
        .resize(3840, undefined, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 95 })
        .toBuffer();
      filename = 'print.jpg';
      break;

    default:
      throw new Error(`Unknown image variant: ${variant}`);
  }

  return { buffer: outputBuffer, filename, contentType: variant === 'print' ? 'image/jpeg' : 'image/webp' };
}

// ─── Video processing via FFmpeg (3 variants) ────────────────────────────────

type VideoVariantConfig = { height: number; crf: number; label: string };

const VIDEO_VARIANTS: Record<string, VideoVariantConfig> = {
  hd:     { height: 720,  crf: 23, label: 'HD 720p' },
  medium: { height: 480,  crf: 25, label: 'Medium 480p' },
  low:    { height: 360,  crf: 28, label: 'Low 360p' },
};

async function processVideo(
  variant: string,
  input: string,
  output: string,
): Promise<string> {
  const vc = VIDEO_VARIANTS[variant];
  if (!vc) throw new Error(`Unknown video variant: ${variant}`);

  await run('ffmpeg', [
    '-y', '-i', input,
    '-vf', `scale=-2:${vc.height}:force_original_aspect_ratio=decrease`,
    '-c:v', 'libx264',
    '-preset', config.media.videoPreset,
    '-crf', String(vc.crf),
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    output,
  ]);
  return 'video/mp4';
}

// ─── PDF processing via Ghostscript (1 variant: compressed) ──────────────────

async function processPdf(input: string, output: string): Promise<void> {
  await run('gs', [
    '-sDEVICE=pdfwrite',
    '-dCompatibilityLevel=1.7',
    '-dNOPAUSE',
    '-dQUIET',
    '-dBATCH',
    '-dPDFSETTINGS=/ebook',
    '-dDetectDuplicateImages=true',
    '-dCompressFonts=true',
    `-sOutputFile=${output}`,
    input,
  ]);
}

// ─── Worker ───────────────────────────────────────────────────────────────────

logger.info({ concurrency: config.media.workerConcurrency }, 'Media worker starting');

const worker = new Worker<MediaJobData>('media-processing', async (job) => {
  const { mediaId, kind, variant, originalFilename, originalMimeType } = job.data;
  const log = logger.child({ mediaId, kind, variant, jobId: job.id });

  log.info('Media job started');
  await job.updateProgress(10);

  // Excel files are stored as-is — nothing to do in the worker
  if (kind === 'excel') {
    log.info('Excel file — no processing needed, marking complete');
    await markMediaVariantCompleted(mediaId, variant, originalFilename);
    await job.updateProgress(100);
    return;
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-'));

  try {
    const buffer = await storage.readFile(mediaId, originalFilename);
    await job.updateProgress(20);

    if (kind === 'image') {
      // ── Image: process entirely in memory via Sharp ───────────────────────
      const { buffer: outBuf, filename, contentType } = await processImage(variant, buffer);
      await job.updateProgress(85);
      await storage.save(mediaId, filename, outBuf, contentType);
      await markMediaVariantCompleted(mediaId, variant, filename);
      await job.updateProgress(100);
      log.info({ filename }, 'Image variant saved');
      return;
    }

    // ── File-based processing (video, pdf) ──────────────────────────────────
    const inputPath = path.join(tempDir, originalFilename);
    await fs.writeFile(inputPath, buffer);
    await job.updateProgress(35);

    if (kind === 'video') {
      const outputPath = path.join(tempDir, `${variant}.mp4`);
      await processVideo(variant, inputPath, outputPath);
      await job.updateProgress(88);
      const outBuf = await fs.readFile(outputPath);
      const filename = `${variant}.mp4`;
      await storage.save(mediaId, filename, outBuf, 'video/mp4');
      await markMediaVariantCompleted(mediaId, variant, filename);
      await job.updateProgress(100);
      log.info({ filename }, 'Video variant saved');

    } else if (kind === 'pdf') {
      // variant = 'compressed'
      const outputPath = path.join(tempDir, 'compressed.pdf');
      await processPdf(inputPath, outputPath);
      await job.updateProgress(88);
      const outBuf = await fs.readFile(outputPath);
      const filename = 'compressed.pdf';
      await storage.save(mediaId, filename, outBuf, 'application/pdf');
      await markMediaVariantCompleted(mediaId, variant, filename);
      await job.updateProgress(100);
      log.info({ filename }, 'PDF variant saved');
    }

  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}, {
  connection: createRedisConnection(),
  concurrency: config.media.workerConcurrency,
});

// ─── Event handlers ───────────────────────────────────────────────────────────

worker.on('completed', (job) =>
  logger.info({ jobId: job.id, mediaId: job.data.mediaId, variant: job.data.variant }, 'Media job completed ✓'),
);
worker.on('failed', async (job, err) => {
  logger.error({ jobId: job?.id, mediaId: job?.data?.mediaId, variant: job?.data?.variant, err }, 'Media job failed ✗');
  if (job?.data?.mediaId) {
    await markMediaFailed(job.data.mediaId, err instanceof Error ? err.message : String(err)).catch(() => {});
  }
});
worker.on('error', (err) => logger.error({ err }, 'Media worker error'));

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Media worker shutting down gracefully...');
  await worker.close();
  process.exit(0);
}
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
