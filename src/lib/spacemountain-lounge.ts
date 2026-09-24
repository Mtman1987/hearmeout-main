import { getRoomWatchSessionId } from '@/lib/watch-session';

export const SPACEMOUNTAIN_LOUNGE_ROOM_ID = 'system-spacemountainlive-lounge';
export const SPACEMOUNTAIN_LOUNGE_MUSIC_SESSION_ID = getRoomWatchSessionId(SPACEMOUNTAIN_LOUNGE_ROOM_ID, 'music');
export const SPACEMOUNTAIN_LOUNGE_MOVIE_SESSION_ID = getRoomWatchSessionId(SPACEMOUNTAIN_LOUNGE_ROOM_ID, 'movie');

// Backward-compatible name for existing music-only callers.
export const SPACEMOUNTAIN_LOUNGE_SESSION_ID = SPACEMOUNTAIN_LOUNGE_MUSIC_SESSION_ID;
export const SPACEMOUNTAIN_LOUNGE_TWITCH_CHANNEL = 'spacemountainlive';
