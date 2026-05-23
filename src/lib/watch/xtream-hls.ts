import { spawn } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { getXtreamStreamUrl } from './xtream-provider';

type HlsJob = {
  promise: Promise<void>;
  startedAt: number;
};

const jobs = new Map<string, HlsJob>();
const DEFAULT_HLS_BUDGET_BYTES = 1536 * 1024 * 1024;

function hlsRootDir() {
  return process.env.WATCH_HLS_DIR || (process.env.FLY_APP_NAME ? '/data/watch-hls' : join(process.cwd(), 'logs', 'watch-hls'));
}

function cleanStreamId(streamId: string) {
  const clean = String(streamId).replace(/[^0-9]/g, '');
  if (!clean) throw new Error('Invalid Xtream HLS stream id');
  return clean;
}

function cleanFileName(fileName: string) {
  const clean = String(fileName || '').replace(/[^a-zA-Z0-9_.-]/g, '');
  if (!clean || clean.includes('..')) throw new Error('Invalid HLS file');
  return clean;
}

function paths(streamId: string) {
  const clean = cleanStreamId(streamId);
  const dir = join(hlsRootDir(), clean);
  return {
    clean,
    dir,
    indexPath: join(dir, 'index.m3u8'),
  };
}

export function isXtreamHlsUrl(playbackUrl: string) {
  return /^\/activity-provider\/xtream\/vod\/\d+$/i.test(playbackUrl);
}

export function xtreamHlsUrl(playbackUrl: string) {
  const match = playbackUrl.match(/^\/activity-provider\/xtream\/vod\/(\d+)$/i);
  if (!match) return playbackUrl;
  return `/api/watch/xtream/hls/${match[1]}/index.m3u8`;
}

export async function getXtreamHlsFile(streamId: string, fileName: string) {
  const { dir } = paths(streamId);
  const file = cleanFileName(fileName);
  const filePath = join(dir, file);
  const stats = await stat(filePath).catch(() => null);
  if (!stats?.isFile()) return null;

  const contentType = file.endsWith('.m3u8')
    ? 'application/vnd.apple.mpegurl'
    : file.endsWith('.ts')
      ? 'video/mp2t'
      : 'application/octet-stream';

  return {
    contentType,
    contentLength: stats.size,
    stream: createReadStream(filePath),
  };
}

export async function ensureXtreamHls(streamId: string) {
  const { clean, dir, indexPath } = paths(streamId);
  if (existsSync(indexPath)) return;
  if (jobs.has(clean)) return jobs.get(clean)!.promise;

  const maxJobs = Number(process.env.WATCH_HLS_MAX_JOBS || 1);
  if (jobs.size >= maxJobs) {
    throw new Error(`HLS converter is busy (${jobs.size} active job)`);
  }

  await mkdir(dir, { recursive: true });
  await pruneHlsRoot();

  const promise = runFfmpegHls(clean, dir, indexPath)
    .catch((error) => {
      console.error(`[XtreamHLS] HLS conversion failed for VOD ${clean}:`, error?.message || error);
      throw error;
    })
    .finally(() => {
      jobs.delete(clean);
    });

  jobs.set(clean, { promise, startedAt: Date.now() });
  return promise;
}

export async function waitForXtreamHlsIndex(streamId: string, timeoutMs = 45_000) {
  const { indexPath } = paths(streamId);
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const stats = await stat(indexPath).catch(() => null);
    if (stats?.isFile() && stats.size > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function runFfmpegHls(streamId: string, dir: string, indexPath: string) {
  const upstreamUrl = await getXtreamStreamUrl('vod', streamId);
  const segmentPattern = join(dir, 'seg_%05d.ts');
  console.log(`[XtreamHLS] Starting HLS conversion for VOD ${streamId}`);

  await new Promise<void>((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'warning',
      '-y',
      '-user_agent',
      'DiscordStreamHub/1.0',
      '-i',
      upstreamUrl.toString(),
      '-map',
      '0:v:0?',
      '-map',
      '0:a:0?',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-ac',
      '2',
      '-f',
      'hls',
      '-hls_time',
      '6',
      '-hls_list_size',
      '0',
      '-hls_playlist_type',
      'event',
      '-hls_segment_filename',
      segmentPattern,
      indexPath,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4000);
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0 || existsSync(indexPath)) {
        resolve();
        return;
      }
      reject(new Error(stderr || `ffmpeg exited with ${code}`));
    });
  });
}

async function pruneHlsRoot() {
  const root = hlsRootDir();
  await mkdir(root, { recursive: true });
  const budget = Number(process.env.WATCH_HLS_BUDGET_BYTES || DEFAULT_HLS_BUDGET_BYTES);
  if (!Number.isFinite(budget) || budget <= 0) return;

  const dirs = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files = (
    await Promise.all(dirs
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const dir = join(root, entry.name);
        const names = await readdir(dir).catch(() => []);
        const stats = await Promise.all(names.map(async (name) => {
          const filePath = join(dir, name);
          const fileStats = await stat(filePath).catch(() => null);
          return fileStats?.isFile() ? { filePath, size: fileStats.size, mtimeMs: fileStats.mtimeMs } : null;
        }));
        return stats.filter((item): item is { filePath: string; size: number; mtimeMs: number } => Boolean(item));
      }))
  ).flat();

  let total = files.reduce((sum, file) => sum + file.size, 0);
  for (const file of files.sort((left, right) => left.mtimeMs - right.mtimeMs)) {
    if (total <= budget) break;
    await unlink(file.filePath).catch(() => {});
    total -= file.size;
  }
}
