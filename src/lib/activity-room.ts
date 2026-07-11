import { db, ensureDb } from '@/lib/db';
import {
  ACTIVITY_ROOM_ID,
  ACTIVITY_ROOM_NAME,
  GLOBAL_WATCH_SESSION_ID,
  MUSIC_WATCH_SESSION_ID,
  normalizeWatchSessionAlias,
} from '@/lib/watch-session';

export function isDiscordActivityWatchSession(sessionId: unknown) {
  const normalized = normalizeWatchSessionAlias(String(sessionId || ''), GLOBAL_WATCH_SESSION_ID);
  return normalized === GLOBAL_WATCH_SESSION_ID || normalized === MUSIC_WATCH_SESSION_ID;
}

export async function ensureDiscordActivityRoom() {
  await ensureDb();
  const existing = db.get('rooms', ACTIVITY_ROOM_ID) || {};
  const room = {
    ...existing,
    id: ACTIVITY_ROOM_ID,
    name: ACTIVITY_ROOM_NAME,
    ownerId: existing.ownerId || ACTIVITY_ROOM_ID,
    playlist: Array.isArray(existing.playlist) ? existing.playlist : [],
    currentTrackId: existing.currentTrackId || undefined,
    isPlaying: Boolean(existing.isPlaying),
    djActive: Boolean(existing.djActive),
    djStatus: existing.djStatus || 'Discord Activity watch room',
    autoRadio: Boolean(existing.autoRadio),
    playHistory: Array.isArray(existing.playHistory) ? existing.playHistory : [],
    isPrivate: false,
    password: undefined,
    expiresAt: undefined,
    systemRoom: true,
    updatedAt: new Date().toISOString(),
  };

  db.set('rooms', ACTIVITY_ROOM_ID, room);
  return room;
}

export async function ensureDiscordActivityRoomForSession(sessionId: unknown) {
  if (!isDiscordActivityWatchSession(sessionId)) return null;
  return ensureDiscordActivityRoom();
}
