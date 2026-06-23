import { getDjWorkerUrl } from './dj-worker-config';

export type OfflineMusicTrack = {
  id: string;
  title: string;
  artist: string;
  duration: number;
  playbackUrl: string;
  fileName: string;
};

export type SavedMusicTrack = {
  id: string;
  title: string;
  artist: string;
  duration: number;
  url: string;
  thumbnail?: string;
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

export async function findSavedMusicTrack(query: string): Promise<SavedMusicTrack | null> {
  const workerUrl = getDjWorkerUrl();
  const needle = String(query || '').trim();
  if (!workerUrl || !needle) return null;

  try {
    const response = await fetch(`${workerUrl}/offline-music/catalog?query=${encodeURIComponent(needle)}&limit=1`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(payload?.items) || !payload.items.length) return null;
    const item = payload.items[0];
    if (!item?.id || !item?.url) return null;
    return {
      id: String(item.id),
      title: String(item.title || 'Saved song'),
      artist: String(item.artist || 'Unknown Artist'),
      duration: Number(item.duration || 180000),
      url: String(item.url),
      thumbnail: item.thumbnail ? String(item.thumbnail) : undefined,
    };
  } catch (error) {
    console.warn('[OfflineMusic] Catalog search failed:', error);
    return null;
  }
}

export async function saveSearchedMusicTrack(track: SavedMusicTrack, query?: string): Promise<void> {
  const workerUrl = getDjWorkerUrl();
  if (!workerUrl || !track?.id || !track?.url) return;

  try {
    await fetch(`${workerUrl}/offline-music/catalog`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ track, query }),
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    console.warn('[OfflineMusic] Catalog save failed:', error);
  }
}
