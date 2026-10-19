import { getDjWorkerUrl } from './dj-worker-config';
import { getDjWorkerRequestHeaders } from './dj-worker-auth';
export type BackupPlaylistEntry = { id: string; title: string; duration: number; artist: string; thumbnail: string };
export type BackupPlaylist = { enabled: boolean; url: string; title: string; entries: BackupPlaylistEntry[]; cursor: number; shuffleVersion?: number; shuffleEnabled?: boolean; sourceEntries?: BackupPlaylistEntry[] };

export function shuffleBackupEntries<T>(entries: T[], random: () => number = Math.random) {
  const shuffled = [...entries];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const sample = Number(random());
    const safeSample = Number.isFinite(sample) ? Math.max(0, Math.min(1, sample)) : 0;
    const target = Math.min(index, Math.floor(safeSample * (index + 1)));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}

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
    const seen = new Set<string>();
    const entries = (Array.isArray(data.entries) ? data.entries : []).filter((entry: BackupPlaylistEntry) =>
      /^[A-Za-z0-9_-]{11}$/.test(entry?.id || '') && !seen.has(entry.id) && Boolean(seen.add(entry.id)));
    if (!response.ok || !entries.length) throw new Error(data.error || 'No public playlist videos found.');
    return { enabled: true, url, title: data.title || 'Backup music', entries: shuffleBackupEntries(entries), sourceEntries: entries, shuffleEnabled: true, cursor: 0, shuffleVersion: 1 };
  }
  const seen = new Set<string>();
  const entries = playlist.videos.filter(video => /^[A-Za-z0-9_-]{11}$/.test(video.id || '') && !seen.has(video.id!) && Boolean(seen.add(video.id!))).map(video => ({
    id: video.id!, title: video.title || 'Playlist song', duration: video.duration || 0,
    artist: video.channel?.name || '', thumbnail: video.thumbnail?.url || '',
  }));
  if (!entries.length) throw new Error('No videos found. Make the playlist public or unlisted and try again.');
  return { enabled: true, url, title: playlist.title || 'Backup music', entries: shuffleBackupEntries(entries), cursor: 0, shuffleVersion: 1 };
}
export function nextBackupEntry(playlist?: BackupPlaylist, random: () => number = Math.random) {
  if (!playlist?.enabled || !playlist.entries.length) return null;
  // Existing tenant playlists persisted before shuffle was added retain their original order.
  // Migrate each saved playlist exactly once before playing its first track.
  if (playlist.shuffleVersion !== 1) {
    playlist.sourceEntries ||= [...playlist.entries];
    if (playlist.shuffleEnabled !== false) playlist.entries = shuffleBackupEntries(playlist.entries, random);
    playlist.cursor = 0;
    playlist.shuffleVersion = 1;
  }
  const cursor = Math.max(0, Math.floor(Number(playlist.cursor) || 0)) % playlist.entries.length;
  const entry = playlist.entries[cursor];
  if (cursor + 1 >= playlist.entries.length) {
    if (playlist.shuffleEnabled !== false) {
      playlist.entries = shuffleBackupEntries(playlist.entries, random);
      if (playlist.entries.length > 1 && playlist.entries[0].id === entry.id) {
        [playlist.entries[0], playlist.entries[1]] = [playlist.entries[1], playlist.entries[0]];
      }
    }
    playlist.cursor = 0;
  } else {
    playlist.cursor = cursor + 1;
  }
  return entry;
}
export function backupPlaylistSummary(playlist?: BackupPlaylist) {
  return { enabled: Boolean(playlist?.enabled), url: playlist?.url || '', title: playlist?.title || '', count: playlist?.entries.length || 0, shuffleEnabled: Boolean(playlist?.entries.length) && playlist?.shuffleEnabled !== false };
}
