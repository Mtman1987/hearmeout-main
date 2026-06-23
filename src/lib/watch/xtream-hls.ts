import { spawn } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { getResolvedXtreamStreamUrl, type XtreamKind } from './xtream-provider';

type HlsJob = {
  promise: Promise<void>;
  startedAt: number;
};

const jobs = new Map<string, HlsJob>();
const DEFAULT_HLS_BUDGET_BYTES = 1536 * 1024 * 1024;
const HLS_SEGMENT_SECONDS = Number(process.env.WATCH_HLS_SEGMENT_SECONDS || 6);
const HLS_LIST_SIZE = Number(process.env.WATCH_HLS_LIST_SIZE || 90);
const HLS_DELETE_THRESHOLD = Number(process.env.WATCH_HLS_DELETE_THRESHOLD || 12);

function hlsRootDir() {
  return process.env.WATCH_HLS_DIR || (process.env.FLY_APP_NAME ? '/data/watch-hls' : join(process.cwd(), 'logs', 'watch-hls'));
}

function cleanStreamId(streamId: string) {
  const clean = String(streamId).toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!clean) throw new Error('Invalid Xtream HLS stream id');
  return clean;
}

function parseStreamKey(streamId: string): { kind: XtreamKind; id: string } {
  const clean = cleanStreamId(streamId);
  const match = clean.match(/^(vod|series|live)-(\d+)$/) || clean.match(/^(episode)-(\d+-[a-z0-9]+)$/);
  if (match) return { kind: match[1] as XtreamKind, id: match[2] };
  const numeric = clean.replace(/[^0-9]/g, '');
  if (!numeric) throw new Error('Invalid Xtream HLS stream id');
  return { kind: 'vod', id: numeric };
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
  return /^\/activity-provider\/xtream\/(?:vod|series)\/\d+$/i.test(playbackUrl)
    || /^\/activity-provider\/xtream\/episode\/\d+-[a-z0-9]+$/i.test(playbackUrl);
}

export function xtreamHlsUrl(playbackUrl: string) {
  const match = playbackUrl.match(/^\/activity-provider\/xtream\/(vod|series)\/(\d+)$/i);
  const episodeMatch = playbackUrl.match(/^\/activity-provider\/xtream\/episode\/(\d+-[a-z0-9]+)$/i);
  if (episodeMatch) return `/api/watch/xtream/hls/episode-${episodeMatch[1].toLowerCase()}/index.m3u8`;
  if (!match) return playbackUrl;
  return `/api/watch/xtream/hls/${match[1].toLowerCase()}-${match[2]}/index.m3u8`;
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
  if (await hasUsableHlsIndex(dir, indexPath)) return;
  if (existsSync(indexPath)) await unlink(indexPath).catch(() => {});
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
  const { dir, indexPath } = paths(streamId);
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await hasUsableHlsIndex(dir, indexPath)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function hasUsableHlsIndex(dir: string, indexPath: string) {
  const stats = await stat(indexPath).catch(() => null);
  if (!stats?.isFile() || stats.size <= 0) return false;

  const manifest = await readFile(indexPath, 'utf8').catch(() => '');
  if (manifest.includes('#EXT-X-PLAYLIST-TYPE:EVENT')) return false;
  const firstSegment = manifest
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#'));
  if (!firstSegment) return false;

  const segmentStats = await stat(join(dir, cleanFileName(firstSegment))).catch(() => null);
  return Boolean(segmentStats?.isFile() && segmentStats.size > 0);
}

async function runFfmpegHls(streamId: string, dir: string, indexPath: string) {
  const stream = parseStreamKey(streamId);
  const upstreamUrl = await getResolvedXtreamStreamUrl(stream.kind, stream.id);
  const segmentPattern = join(dir, 'seg_%05d.ts');
  console.log(`[XtreamHLS] Starting HLS conversion for ${stream.kind} ${stream.id}`);

  await new Promise<void>((resolve, reject) => {
    const ffmpegArgs = [
      '-hide_banner',
      '-loglevel',
      'warning',
      '-threads',
      '1',
      '-y',
      '-user_agent',
      'DiscordStreamHub/1.0',
      '-reconnect',
      '1',
      '-reconnect_streamed',
      '1',
      '-reconnect_at_eof',
      '1',
      '-reconnect_delay_max',
      '5',
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
      String(HLS_SEGMENT_SECONDS),
      '-hls_list_size',
      String(HLS_LIST_SIZE),
      '-hls_delete_threshold',
      String(HLS_DELETE_THRESHOLD),
      '-hls_flags',
      'delete_segments+independent_segments+temp_file',
      '-hls_segment_filename',
      segmentPattern,
      indexPath,
    ];
    const command = process.platform === 'win32' ? 'ffmpeg' : 'nice';
    const args = process.platform === 'win32' ? ffmpegArgs : ['-n', '15', 'ffmpeg', ...ffmpegArgs];
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });

    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4000);
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
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
