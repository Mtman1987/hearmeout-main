import { isValidVideoId } from './validate-video-id';
import { getDjWorkerSecret, getDjWorkerUrl } from './dj-worker-config';

const DJ_WORKER_URL = getDjWorkerUrl();
const DJ_WORKER_SECRET = getDjWorkerSecret();

async function workerFetch(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`${DJ_WORKER_URL}${path}`, {
    ...options,
    headers: {
      ...((options.headers as Record<string, string>) || {}),
      Authorization: `Bearer ${DJ_WORKER_SECRET}`,
    },
  });
}

export function isCached(_videoId: string): boolean {
  // Can't check locally anymore — always return false, let worker handle it
  return false;
}

export function getCachedUrl(videoId: string): string | null {
  if (!isValidVideoId(videoId)) return null;
  // Route through worker
  return null;
}

export async function ripAndCache(videoId: string): Promise<string | null> {
  if (!isValidVideoId(videoId)) return null;
  if (!DJ_WORKER_URL) {
    console.error('[Ripper] DJ_WORKER_URL not set, cannot rip');
    return null;
  }

  try {
    const res = await workerFetch('/rip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId }),
    });
    const data = await res.json();
    if (data.success) return `/api/music/${videoId}`;
    return null;
  } catch (e: any) {
    console.error(`[Ripper] Worker rip failed:`, e.message);
    return null;
  }
}

export async function ripWithUrl(videoId: string, _audioStreamUrl: string): Promise<string | null> {
  // Just delegate to the worker's standard rip (it extracts its own URL)
  return ripAndCache(videoId);
}

export function getCacheStats(): { files: number; totalBytes: number } {
  // Would need to call worker — return empty for now
  return { files: 0, totalBytes: 0 };
}
