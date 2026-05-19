import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { getXtreamStreamUrl } from './xtream-provider';

type CacheMeta = {
  streamId: string;
  contentType: string;
  contentLength: number;
  cachedLength: number;
  complete: boolean;
  cachedAt: string;
};

type CacheEntry = CacheMeta & {
  filePath: string;
};

const inProgress = new Map<string, Promise<void>>();
const progress = new Map<string, { contentLength: number; contentType: string; tmpPath: string }>();
const DEFAULT_FRONT_BUFFER_BYTES = 128 * 1024 * 1024;
const DEFAULT_CACHE_BUDGET_BYTES = 768 * 1024 * 1024;

function cacheDir() {
  return process.env.WATCH_CACHE_DIR || (process.env.FLY_APP_NAME ? '/data/watch-cache' : join(process.cwd(), 'logs', 'watch-cache'));
}

function cleanStreamId(streamId: string) {
  const clean = String(streamId).replace(/[^0-9]/g, '');
  if (!clean) throw new Error('Invalid Xtream cache stream id');
  return clean;
}

function paths(streamId: string) {
  const clean = cleanStreamId(streamId);
  const dir = cacheDir();
  return {
    dir,
    filePath: join(dir, `${clean}.mp4`),
    tmpPath: join(dir, `${clean}.tmp`),
    metaPath: join(dir, `${clean}.json`),
  };
}

export async function getXtreamVodCache(streamId: string): Promise<CacheEntry | null> {
  const { filePath, metaPath } = paths(streamId);
  if (!existsSync(filePath) || !existsSync(metaPath)) return null;

  const [fileStats, metaRaw] = await Promise.all([
    stat(filePath),
    readFile(metaPath, 'utf8'),
  ]);
  const meta = JSON.parse(metaRaw) as CacheMeta;
  if (!fileStats.size || fileStats.size !== meta.cachedLength) return null;
  return { ...meta, filePath };
}

export function startXtreamVodCache(streamId: string, title = 'Xtream VOD') {
  const clean = cleanStreamId(streamId);
  if (inProgress.has(clean)) return inProgress.get(clean)!;
  const maxJobs = Number(process.env.WATCH_CACHE_MAX_JOBS || 1);
  if (inProgress.size >= maxJobs) {
    console.warn(`[XtreamCache] Skipping cache for VOD ${clean}: ${inProgress.size} cache job(s) already running`);
    return Promise.resolve();
  }

  const task = cacheXtreamVod(clean, title)
    .catch((error) => {
      console.error(`[XtreamCache] Cache failed for VOD ${clean}:`, error?.message || error);
    })
    .finally(() => {
      inProgress.delete(clean);
      progress.delete(clean);
    });

  inProgress.set(clean, task);
  return task;
}

export function isXtreamVodCacheInProgress(streamId: string) {
  return inProgress.has(cleanStreamId(streamId));
}

export async function waitForXtreamVodCacheRange(streamId: string, rangeHeader?: string | null, timeoutMs = 25_000) {
  const clean = cleanStreamId(streamId);
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const complete = await getXtreamVodCache(clean).catch(() => null);
    if (complete) return createCachedReadStream(complete, rangeHeader);

    const partial = progress.get(clean);
    if (partial && existsSync(partial.tmpPath)) {
      const fileStats = await stat(partial.tmpPath).catch(() => null);
      const size = fileStats?.size || 0;
      const requested = parseRange(rangeHeader, partial.contentLength) || { start: 0, end: Math.min(partial.contentLength - 1, 1024 * 1024 - 1) };
      if (size > requested.end) {
        const length = requested.end - requested.start + 1;
        return {
          status: 206,
          headers: {
            'content-length': String(length),
            'content-range': `bytes ${requested.start}-${requested.end}/${partial.contentLength}`,
            'content-type': partial.contentType,
            'accept-ranges': 'bytes',
            'x-watch-cache': 'partial',
          },
          stream: createReadStream(partial.tmpPath, { start: requested.start, end: requested.end }),
        };
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return null;
}

async function cacheXtreamVod(streamId: string, title: string) {
  if (await getXtreamVodCache(streamId).catch(() => null)) return;

  const { dir, filePath, tmpPath, metaPath } = paths(streamId);
  await mkdir(dir, { recursive: true });
  await unlink(tmpPath).catch(() => {});
  await pruneCacheDir(dir);

  const upstreamUrl = getXtreamStreamUrl('vod', streamId);
  console.log(`[XtreamCache] Starting cache for ${title} (${streamId})`);
  const response = await fetch(upstreamUrl, {
    cache: 'no-store',
    headers: { 'user-agent': 'DiscordStreamHub/1.0' },
  });

  if (!response.ok || !response.body) {
    console.warn(`[XtreamCache] Skipping cache for ${title} (${streamId}): upstream returned ${response.status}`);
    return;
  }

  const contentLength = Number(response.headers.get('content-length') || 0);
  const contentType = response.headers.get('content-type') || 'video/mp4';
  if (!contentLength) {
    console.warn(`[XtreamCache] Skipping cache for ${title} (${streamId}): upstream did not return content-length`);
    return;
  }
  progress.set(streamId, { contentLength, contentType, tmpPath });

  const maxBytes = Number(process.env.WATCH_CACHE_MAX_BYTES || DEFAULT_FRONT_BUFFER_BYTES);
  const writer = createWriteStream(tmpPath);
  let written = 0;
  try {
    for await (const chunk of Readable.fromWeb(response.body as any)) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = maxBytes - written;
      if (remaining <= 0) break;
      const next = buffer.length > remaining ? buffer.subarray(0, remaining) : buffer;
      if (!writer.write(next)) {
        await waitForDrain(writer);
      }
      written += next.length;
      if (written >= maxBytes) break;
    }
    writer.end();
    await new Promise<void>((resolve, reject) => {
      writer.once('finish', resolve);
      writer.once('error', reject);
    });
  } catch (error) {
    writer.destroy();
    await unlink(tmpPath).catch(() => {});
    throw error;
  }

  const fileStats = await stat(tmpPath);
  const complete = fileStats.size === contentLength;

  const meta: CacheMeta = {
    streamId,
    contentType,
    contentLength,
    cachedLength: fileStats.size,
    complete,
    cachedAt: new Date().toISOString(),
  };

  await writeFile(metaPath, JSON.stringify(meta, null, 2));
  await rename(tmpPath, filePath);
  console.log(`[XtreamCache] Cached ${complete ? 'full' : 'front buffer'} for ${title} (${streamId}) ${fileStats.size}/${contentLength} bytes`);
}

async function pruneCacheDir(dir: string): Promise<void> {
  const budget = Number(process.env.WATCH_CACHE_BUDGET_BYTES || DEFAULT_CACHE_BUDGET_BYTES);
  if (!Number.isFinite(budget) || budget <= 0) return;

  const entries = await readdir(dir).catch(() => []);
  const files = (
    await Promise.all(entries
      .filter((name) => name.endsWith('.mp4') || name.endsWith('.tmp'))
      .map(async (name) => {
        const filePath = join(dir, name);
        const stats = await stat(filePath).catch(() => null);
        return stats ? { filePath, size: stats.size, mtimeMs: stats.mtimeMs } : null;
      }))
  ).filter((item): item is { filePath: string; size: number; mtimeMs: number } => Boolean(item));

  let total = files.reduce((sum, file) => sum + file.size, 0);
  for (const file of files.sort((left, right) => left.mtimeMs - right.mtimeMs)) {
    if (total <= budget) break;
    await unlink(file.filePath).catch(() => {});
    await unlink(file.filePath.replace(/\.mp4$/, '.json')).catch(() => {});
    total -= file.size;
  }
}

function waitForDrain(writer: ReturnType<typeof createWriteStream>) {
  return new Promise<void>((resolve, reject) => {
    const onDrain = () => {
      writer.off('error', onError);
      resolve();
    };
    const onError = (error: Error) => {
      writer.off('drain', onDrain);
      reject(error);
    };
    writer.once('drain', onDrain);
    writer.once('error', onError);
  });
}

export function createCachedReadStream(entry: CacheEntry, rangeHeader?: string | null) {
  const size = entry.contentLength;
  const range = parseRange(rangeHeader, size);
  if (!range) {
    if (!entry.complete) return null;
    return {
      status: 200,
      headers: {
        'content-length': String(size),
        'content-type': entry.contentType,
        'accept-ranges': 'bytes',
      },
      stream: createReadStream(entry.filePath),
    };
  }

  if (!entry.complete && range.end >= entry.cachedLength) return null;

  const length = range.end - range.start + 1;
  return {
    status: 206,
    headers: {
      'content-length': String(length),
      'content-range': `bytes ${range.start}-${range.end}/${size}`,
      'content-type': entry.contentType,
      'accept-ranges': 'bytes',
      'x-watch-cache': entry.complete ? 'hit' : 'front-buffer',
    },
    stream: createReadStream(entry.filePath, { start: range.start, end: range.end }),
  };
}

function parseRange(rangeHeader: string | null | undefined, size: number) {
  if (!rangeHeader) return null;
  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;

  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : size - 1;
  if (!match[1] && match[2]) {
    const suffixLength = Number(match[2]);
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) return null;
  return { start, end: Math.min(end, size - 1) };
}
