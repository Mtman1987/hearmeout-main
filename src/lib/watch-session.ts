export const GLOBAL_WATCH_SESSION_ID = 'discord-watch-room';
export const MUSIC_WATCH_SESSION_ID = 'discord-music-room';

export function getGlobalWatchSessionId() {
  return GLOBAL_WATCH_SESSION_ID;
}

export function getMusicWatchSessionId() {
  return MUSIC_WATCH_SESSION_ID;
}

export function getOverlayWatchSessionId(roomId: string, kind: 'movie' | 'music' = 'movie') {
  const cleanRoomId = String(roomId || 'room')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'room';
  return `watch-overlay-${cleanRoomId}-${kind}`;
}

export function normalizeWatchSessionAlias(value?: string | null, fallback = GLOBAL_WATCH_SESSION_ID) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === GLOBAL_WATCH_SESSION_ID || raw === MUSIC_WATCH_SESSION_ID || raw.startsWith('watch-')) return raw;
  if (['watch', 'movie', 'movies', 'video', 'videos', 'main', 'default', 'global'].includes(raw)) return GLOBAL_WATCH_SESSION_ID;
  if (['music', 'song', 'songs', 'radio', 'dj'].includes(raw)) return MUSIC_WATCH_SESSION_ID;
  const slug = raw.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return slug ? `watch-${slug}` : fallback;
}

export function getScopedWatchSessionId(_guildId?: string | null, _channelId?: string | null) {
  return GLOBAL_WATCH_SESSION_ID;
}
