import { getDjWorkerUrl } from './dj-worker-config';

export type OfflineMusicTrack = {
  id: string;
  title: string;
  artist: string;
  duration: number;
  playbackUrl: string;
  fileName: string;
};

export async function findOfflineMusicTrack(query: string): Promise<OfflineMusicTrack | null> {
  const workerUrl = getDjWorkerUrl();
  const needle = String(query || '').trim();
  if (!workerUrl || !needle) return null;

  try {
    const response = await fetch(`${workerUrl}/offline-music?query=${encodeURIComponent(needle)}&limit=1`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(payload?.items) || !payload.items.length) return null;
    const item = payload.items[0];
    if (!item?.id || !item?.playbackUrl) return null;
    return {
      id: String(item.id),
      title: String(item.title || item.fileName || 'Offline song'),
      artist: String(item.artist || 'Offline Library'),
      duration: Number(item.duration || 180000),
      playbackUrl: String(item.playbackUrl),
      fileName: String(item.fileName || item.title || item.id),
    };
  } catch (error) {
    console.warn('[OfflineMusic] Search failed:', error);
    return null;
  }
}
