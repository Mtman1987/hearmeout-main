import { getDjWorkerUrl } from './dj-worker-config';
import { getDjWorkerRequestHeaders } from './dj-worker-auth';
export type BackupPlaylistEntry = { id: string; title: string; duration: number; artist: string; thumbnail: string };
export type BackupPlaylist = { enabled: boolean; url: string; title: string; entries: BackupPlaylistEntry[]; cursor: number };

export function publicPlaylistUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(url.hostname)
      || !/^[A-Za-z0-9_-]{10,100}$/.test(url.searchParams.get('list') || '')) throw new Error('Use a public YouTube playlist URL.');
  return 'https://www.youtube.com/playlist?list=' + url.searchParams.get('list');
}
export async function importBackupPlaylist(value: string): Promise<BackupPlaylist> {
  const url = publicPlaylistUrl(value);
  const { default: YouTube } = await import('youtube-sr');
  const playlist = await YouTube.getPlaylist(url, { limit: 1000, fetchAll: true, requestOptions: { signal: AbortSignal.timeout(15000) } }).catch(() => null);
  if (!playlist?.videos?.length) {
    const response = await fetch(getDjWorkerUrl() + '/watch/youtube/playlist?url=' + encodeURIComponent(url), { headers: getDjWorkerRequestHeaders(), signal: AbortSignal.timeout(65000), cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || !data.entries?.length) throw new Error(data.error || 'No public playlist videos found.');
    return { enabled: true, url, title: data.title || 'Backup music', entries: data.entries, cursor: 0 };
  }
  const seen = new Set<string>();
  const entries = playlist.videos.filter(video => /^[A-Za-z0-9_-]{11}$/.test(video.id || '') && !seen.has(video.id!) && Boolean(seen.add(video.id!))).map(video => ({
    id: video.id!, title: video.title || 'Playlist song', duration: video.duration || 0,
    artist: video.channel?.name || '', thumbnail: video.thumbnail?.url || '',
  }));
  if (!entries.length) throw new Error('No videos found. Make the playlist public or unlisted and try again.');
  return { enabled: true, url, title: playlist.title || 'Backup music', entries, cursor: 0 };
}
export function nextBackupEntry(playlist?: BackupPlaylist) {
  if (!playlist?.enabled || !playlist.entries.length) return null;
  const entry = playlist.entries[Math.max(0, playlist.cursor || 0) % playlist.entries.length];
  playlist.cursor = ((playlist.cursor || 0) + 1) % playlist.entries.length;
  return entry;
}
export function backupPlaylistSummary(playlist?: BackupPlaylist) {
  return { enabled: Boolean(playlist?.enabled), url: playlist?.url || '', title: playlist?.title || '', count: playlist?.entries.length || 0 };
}
