export const GLOBAL_WATCH_SESSION_ID = 'discord-watch-room';
export const MUSIC_WATCH_SESSION_ID = 'discord-music-room';
export const ACTIVITY_ROOM_ID = 'discord-activity';
export const ACTIVITY_ROOM_NAME = 'Discord Activities';
export type WatchMediaKind = 'movie' | 'music';

export function getGlobalWatchSessionId() {
  return GLOBAL_WATCH_SESSION_ID;
}

export function getMusicWatchSessionId() {
  return MUSIC_WATCH_SESSION_ID;
}

export function isActivityRoomId(roomId: string | null | undefined) {
  return cleanScopePart(roomId, '', 64) === ACTIVITY_ROOM_ID;
}

function cleanScopePart(value: string | null | undefined, fallback: string, maxLength = 64) {
  return String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength) || fallback;
}

function cleanDiscordScopePart(value: string | null | undefined, fallback: string, maxLength = 64) {
  return String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxLength) || fallback;
}

export function getRoomWatchSessionId(roomId: string, kind: WatchMediaKind = 'movie') {
  if (isActivityRoomId(roomId)) return kind === 'music' ? MUSIC_WATCH_SESSION_ID : GLOBAL_WATCH_SESSION_ID;
  return `watch-room-${cleanScopePart(roomId, 'room', 48)}-${kind}`;
}

export function getDiscordWatchSessionId(guildId?: string | null, channelId?: string | null, kind: WatchMediaKind = 'movie') {
  const guild = cleanDiscordScopePart(guildId, '', 48);
  const channel = cleanDiscordScopePart(channelId, '', 48);
  if (!guild || !channel) return kind === 'music' ? MUSIC_WATCH_SESSION_ID : GLOBAL_WATCH_SESSION_ID;
  return `watch-discord-${guild}-${channel}-${kind}`;
}

export function getOverlayWatchSessionId(roomId: string, kind: WatchMediaKind = 'movie') {
  return getRoomWatchSessionId(roomId, kind);
}

export function normalizeWatchSessionAlias(value?: string | null, fallback = GLOBAL_WATCH_SESSION_ID) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return fallback;
  const discordScopedMatch = raw.match(/^watch-discord-[a-z0-9_]+-[a-z0-9_]+-(movie|music)$/);
  if (discordScopedMatch) return discordScopedMatch[1] === 'music' ? MUSIC_WATCH_SESSION_ID : GLOBAL_WATCH_SESSION_ID;
  if (raw === GLOBAL_WATCH_SESSION_ID || raw === MUSIC_WATCH_SESSION_ID || raw.startsWith('watch-')) return raw;
  if (['watch', 'movie', 'movies', 'video', 'videos', 'main', 'default', 'global'].includes(raw)) return GLOBAL_WATCH_SESSION_ID;
  if (['music', 'song', 'songs', 'radio', 'dj'].includes(raw)) return MUSIC_WATCH_SESSION_ID;
  const slug = raw.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return slug ? `watch-${slug}` : fallback;
}

export function getScopedWatchSessionId(guildId?: string | null, channelId?: string | null, kind: WatchMediaKind = 'movie') {
  return getDiscordWatchSessionId(guildId, channelId, kind);
}
