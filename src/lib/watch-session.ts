/**
 * HearMeOut has exactly two shared media sessions: one movie and one music.
 * Rooms, Discord channels, Activities, popouts and overlays are views into
 * these sessions, never owners of another queue, playhead or media source.
 * Keep these historical IDs stable for existing links and persisted playback.
 * Listener volume/mute must never be written to shared playback state.
 */
export const GLOBAL_WATCH_SESSION_ID = 'discord-watch-room';
export const MUSIC_WATCH_SESSION_ID = 'discord-music-room';
export const ACTIVITY_ROOM_ID = 'discord-activity';
export const ACTIVITY_ROOM_NAME = 'Discord Activities';
export type WatchMediaKind = 'movie' | 'music';

export function getGlobalWatchSessionId() { return GLOBAL_WATCH_SESSION_ID; }
export function getMusicWatchSessionId() { return MUSIC_WATCH_SESSION_ID; }
export function isActivityRoomId(roomId: string | null | undefined) {
  return String(roomId || '').trim().toLowerCase() === ACTIVITY_ROOM_ID;
}
export function getRoomWatchSessionId(_roomId: string, kind: WatchMediaKind = 'movie') {
  return kind === 'music' ? MUSIC_WATCH_SESSION_ID : GLOBAL_WATCH_SESSION_ID;
}
export function getDiscordWatchSessionId(_guildId?: string | null, _channelId?: string | null, kind: WatchMediaKind = 'movie') {
  return getRoomWatchSessionId('', kind);
}
export function getOverlayWatchSessionId(roomId: string, kind: WatchMediaKind = 'movie') {
  return getRoomWatchSessionId(roomId, kind);
}
export function normalizeWatchSessionAlias(value?: string | null, fallback = GLOBAL_WATCH_SESSION_ID) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === MUSIC_WATCH_SESSION_ID || /-(music|song|songs|radio|dj)$/.test(raw)
    || ['music', 'song', 'songs', 'radio', 'dj'].includes(raw)) return MUSIC_WATCH_SESSION_ID;
  if (raw === GLOBAL_WATCH_SESSION_ID || /-(movie|movies|video)$/.test(raw)
    || ['watch', 'movie', 'movies', 'video', 'videos', 'main', 'default', 'global'].includes(raw)) return GLOBAL_WATCH_SESSION_ID;
  return fallback === MUSIC_WATCH_SESSION_ID ? MUSIC_WATCH_SESSION_ID : GLOBAL_WATCH_SESSION_ID;
}
export function getScopedWatchSessionId(guildId?: string | null, channelId?: string | null, kind: WatchMediaKind = 'movie') {
  return getDiscordWatchSessionId(guildId, channelId, kind);
}
