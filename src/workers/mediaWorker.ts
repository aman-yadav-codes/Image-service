import 'dotenv/config';
import { Worker } from 'bullmq';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRedisConnection } from '../config/redis.js';
import { config } from '../config/index.js';
import { storage } from '../storage/index.js';
import { logger } from '../utils/logger.js';
import { markMediaVariantCompleted } from '../services/mediaService.js';
import type { MediaJobData } from '../types/media.js';

const execFileAsync = promisify(execFile);

async function run(command: string, args: string[]): Promise<void> {
  await execFileAsync(command, args, { maxBuffer: 1024 * 1024 * 4 });
}

async function processVideo(job: MediaJobData, input: string, output: string): Promise<string> {
  if (job.variant === 'poster') {
    await run('ffmpeg', ['-y', '-ss', '1', '-i', input, '-frames:v', '1', '-vf', 'scale=1280:-2', '-q:v', '3', output]);
    return 'image/jpeg';
  }
  const height = job.variant === '720p' ? '720' : '480';
  await run('ffmpeg', [
    '-y', '-i', input,
    '-vf', `scale=-2:${height}:force_original_aspect_ratio=decrease`,
    '-c:v', 'libx264', '-preset', config.media.videoPreset, '-crf', job.variant === '720p' ? '23' : '25',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output,
  ]);
  return 'video/mp4';
}

async function processPdf(job: MediaJobData, input: string, output: string): Promise<string> {
  if (job.variant === 'lossless') {
    await run('qpdf', ['--object-streams=generate', '--compression-level=9', '--linearize', input, output]);
  } else {
    await run('gs', [
      '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.7', '-dNOPAUSE', '-dQUIET', '-dBATCH',
      '-dPDFSETTINGS=/ebook', '-dDetectDuplicateImages=true', '-dCompressFonts=true',
      `-sOutputFile=${output}`, input,
    ]);
  }
  return 'application/pdf';
}

logger.info({ concurrency: config.media.workerConcurrency }, 'Media worker starting');

const worker = new Worker<MediaJobData>('media-processing', async (job) => {
  const { mediaId, variant, originalFilename, kind } = job.data;
  const log = logger.child({ mediaId, kind, variant, jobId: job.id });
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-'));
  const input = path.join(tempDir, originalFilename);
  const outputExt = variant === 'poster' ? '.jpg' : kind === 'pdf' ? '.pdf' : '.mp4';
  const output = path.join(tempDir, `${variant}${outputExt}`);
  try {
    await job.updateProgress(10);
    const buffer = await storage.readFile(mediaId, originalFilename);
    await fs.writeFile(input, buffer);
    await job.updateProgress(30);

    const contentType = kind === 'video'
      ? await processVideo(job.data, input, output)
      : await processPdf(job.data, input, output);
    await job.updateProgress(90);

    const filename = `${variant}${outputExt}`;
    await storage.save(mediaId, filename, await fs.readFile(output), contentType);
    await markMediaVariantCompleted(mediaId, variant, filename);
    await job.updateProgress(100);
    log.info({ filename }, 'Media variant saved');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}, {
  connection: createRedisConnection(),
  concurrency: config.media.workerConcurrency,
});

worker.on('completed', (job) => logger.info({ jobId: job.id, mediaId: job.data.mediaId, variant: job.data.variant }, 'Media job completed ✓'));
worker.on('failed', async (job, err) => {
  logger.error({ jobId: job?.id, mediaId: job?.data?.mediaId, variant: job?.data?.variant, err }, 'Media job failed ✗');
});
worker.on('error', (err) => logger.error({ err }, 'Media worker error'));

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Media worker shutting down gracefully...');
  await worker.close();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
