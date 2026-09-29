import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { config } from '../config/index.js';

const execFileAsync = promisify(execFile);

function targetKb(targetBytes: number): string {
  return Math.max(1, Math.floor(targetBytes / 1024)).toString();
}

async function runCompressor(inputPath: string, outputPath: string, targetBytes: number): Promise<void> {
  const args = [
    config.image.compressorScript,
    inputPath,
    '--output',
    outputPath,
    '--target',
    targetKb(targetBytes),
    '--effort',
    String(config.image.webpEffort),
    '--engine',
    config.image.compressorEngine,
    '--max-pixels',
    String(config.image.maxImagePixels),
  ];

  if (!config.image.allowResize) args.push('--no-resize');

  await execFileAsync(config.image.pythonBinary, args, {
    maxBuffer: 1024 * 1024 * 16,
    timeout: config.image.compressorTimeoutMs,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
    },
  });
}

export async function optimizeImage(inputBuffer: Buffer, targetBytes: number): Promise<Buffer> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'image-compress-'));
  const inputPath = path.join(tempDir, 'source');
  const outputPath = path.join(tempDir, 'image.webp');

  try {
    await fs.writeFile(inputPath, inputBuffer);
    await runCompressor(inputPath, outputPath, targetBytes);
    return await fs.readFile(outputPath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
