import type { PlaylistItem } from '@/types/playlist';
import { addSongToPlaylist, skipTrack } from '@/lib/bot-actions';
import { db, ensureDb } from '@/lib/db';
import { getGlobalMusicRoomId } from '@/lib/music-session';
import { MUSIC_WATCH_SESSION_ID } from '@/lib/watch-session';

type MusicPlaybackStatus = 'idle' | 'ready' | 'playing';

type MusicSession = {
  id: string;
  roomId: string;
  current: PlaylistItem | null;
  queue: PlaylistItem[];
  playback: {
    status: MusicPlaybackStatus;
    position: number;
    updatedAt: number;
  };
};

export async function ensureGlobalMusicRoom() {
  await ensureDb();
  const preferredRoomId = getGlobalMusicRoomId();
  const activeRoomId = findActiveMusicRoomId(preferredRoomId);
  return activeRoomId || preferredRoomId || null;
}

function getRoomActivityTimestamp(room: any) {
  return Math.max(
    Number(room?.musicPlaybackUpdatedAt || 0),
    Number(room?.updatedAt || 0),
    Number(room?.lastActiveAt || 0),
    Date.parse(room?.createdAt || '') || 0,
  );
}

function findActiveMusicRoomId(preferredRoomId: string) {
  const preferredRoom = preferredRoomId ? db.get('rooms', preferredRoomId) : null;
  if (preferredRoom?.currentTrackId || preferredRoom?.playlist?.length) return preferredRoomId;

  const candidates = db.list('rooms')
    .filter((room) => room.data?.currentTrackId || room.data?.playlist?.length)
    .sort((a, b) => {
      const playingDelta = Number(Boolean(b.data?.isPlaying)) - Number(Boolean(a.data?.isPlaying));
      if (playingDelta) return playingDelta;
      const djDelta = Number(Boolean(b.data?.djActive)) - Number(Boolean(a.data?.djActive));
      if (djDelta) return djDelta;
      const timeDelta = getRoomActivityTimestamp(b.data) - getRoomActivityTimestamp(a.data);
      if (timeDelta) return timeDelta;
      return Number(b.data?.playlist?.length || 0) - Number(a.data?.playlist?.length || 0);
    });

  return candidates[0]?.id || null;
}

export function getSessionFromRoom(roomId: string, room: any): MusicSession {
  const playlist: PlaylistItem[] = Array.isArray(room?.playlist) ? room.playlist : [];
  const currentIndex = playlist.findIndex((track) => track.id === room?.currentTrackId);
  const current = currentIndex >= 0 ? playlist[currentIndex] : null;
  const queue = currentIndex >= 0 ? playlist.slice(currentIndex + 1) : playlist;
  const status: MusicPlaybackStatus = !current ? 'idle' : room?.isPlaying ? 'playing' : 'ready';

  return {
    id: roomId,
    roomId,
    current,
    queue,
    playback: {
      status,
      position: Math.max(0, Number(room?.musicPlaybackPosition || 0)),
      updatedAt: Number(room?.musicPlaybackUpdatedAt || Date.now()),
    },
  };
}

export async function getGlobalMusicSession() {
  const roomId = await ensureGlobalMusicRoom();
  if (!roomId) return getSessionFromRoom('', {});
  const room = db.get('rooms', roomId) || {};
  return getSessionFromRoom(roomId, room);
}

export async function getMusicSessionForRoom(roomId: string) {
  await ensureDb();
  const room = db.get('rooms', roomId);
  return room ? getSessionFromRoom(roomId, room) : null;
}

export async function requestMusicItem(params: {
  query: string;
  username: string;
  platform: 'discord' | 'twitch' | 'admin' | 'activity' | 'web';
}) {
  const roomId = await ensureGlobalMusicRoom();
  if (!roomId) {
    return {
      result: { success: false, message: 'No active HearMeOut room found.' },
      session: await getGlobalMusicSession(),
    };
  }
  const requester = `${params.username} (${params.platform})`;
  const result = await addSongToPlaylist(params.query, roomId, requester);
  return {
    result,
    session: await getGlobalMusicSession(),
  };
}

export async function requestMusicItemForRoom(params: {
  roomId: string;
  query: string;
  username: string;
  platform: 'discord' | 'twitch' | 'admin' | 'activity' | 'web';
}) {
  const requester = `${params.username} (${params.platform})`;
  const result = await addSongToPlaylist(params.query, params.roomId, requester);
  return {
    result,
    session: await getMusicSessionForRoom(params.roomId),
  };
}

export async function controlGlobalMusicSession(action: string, position = 0) {
  const roomId = await ensureGlobalMusicRoom();
  if (!roomId) throw new Error('No active HearMeOut room found.');
  const normalized = String(action || '').toLowerCase();
  const now = Date.now();

  if (normalized === 'play') {
    db.update('rooms', roomId, {
      isPlaying: true,
      musicPlaybackPosition: Math.max(0, Number(position || 0)),
      musicPlaybackUpdatedAt: now,
    });
    return getGlobalMusicSession();
  }

  if (normalized === 'pause') {
    db.update('rooms', roomId, {
      isPlaying: false,
      musicPlaybackPosition: Math.max(0, Number(position || 0)),
      musicPlaybackUpdatedAt: now,
    });
    return getGlobalMusicSession();
  }

  if (normalized === 'seek') {
    db.update('rooms', roomId, {
      musicPlaybackPosition: Math.max(0, Number(position || 0)),
      musicPlaybackUpdatedAt: now,
    });
    return getGlobalMusicSession();
  }

  if (normalized === 'next' || normalized === 'skip') {
    await skipTrack(roomId);
    db.update('rooms', roomId, {
      musicPlaybackPosition: 0,
      musicPlaybackUpdatedAt: now,
    });
    return getGlobalMusicSession();
  }

  if (normalized === 'clear') {
    db.update('rooms', roomId, {
      playlist: [],
      currentTrackId: '',
      isPlaying: false,
      musicPlaybackPosition: 0,
      musicPlaybackUpdatedAt: now,
    });
    return getGlobalMusicSession();
  }

  throw new Error('Unsupported music control action');
}

function formatDurationMs(durationMs: number | undefined) {
  const totalSeconds = Math.max(0, Math.round(Number(durationMs || 0) / 1000));
  if (!totalSeconds) return 'unknown';
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

function playlistItemToWatchItem(track: PlaylistItem) {
  if (track.source === 'offline' && track.playbackUrl) {
    return {
      id: `offline-${track.id}`,
      type: 'music',
      title: track.title,
      year: new Date().getFullYear(),
      runtime: formatDurationMs(track.duration),
      source: track.artist ? `Offline Music: ${track.artist}` : 'Offline Music Library',
      poster: track.thumbnail || '',
      playbackUrl: track.playbackUrl,
      overview: `Song request from ${track.addedBy || 'unknown user'}.`,
      metadata: {
        provider: 'offline',
        kind: 'song',
        artist: track.artist,
        originalUrl: track.url,
        audioPlaybackUrl: track.playbackUrl,
        playbackMode: 'audio',
        playbackStrategy: 'offline',
      },
    };
  }

  const videoId = encodeURIComponent(track.id);
  const videoPlaybackUrl = `/api/watch/youtube/hls/${videoId}/index.m3u8`;
  return {
    id: `youtube-${track.id}`,
    type: 'music',
    title: track.title,
    year: new Date().getFullYear(),
    runtime: formatDurationMs(track.duration),
    source: track.artist ? `YouTube Music: ${track.artist}` : 'YouTube Music',
    poster: track.thumbnail || '',
    playbackUrl: videoPlaybackUrl,
    overview: `Song request from ${track.addedBy || 'unknown user'}.`,
    metadata: {
      provider: 'youtube',
      kind: 'song',
      videoId: track.id,
      artist: track.artist,
      originalUrl: track.url,
      videoPlaybackUrl,
      playbackMode: 'video',
      playbackStrategy: 'proxy',
    },
  };
}

function playlistItemToWatchRequest(track: PlaylistItem, index: number) {
  return {
    requestId: `${track.id}-${index}`,
    requestedBy: {
      userId: track.addedBy || 'hearmeout',
      username: track.addedBy || 'HearMeOut',
    },
    addedAt: track.addedAt ? new Date(track.addedAt).toISOString() : new Date().toISOString(),
    item: playlistItemToWatchItem(track),
  };
}

export async function getGlobalMusicWatchSession(preferredBaseUrl?: string) {
  const session = await getGlobalMusicSession();
  const current = session.current ? playlistItemToWatchRequest(session.current, 0) : null;
  return {
    id: MUSIC_WATCH_SESSION_ID,
    roomId: session.roomId,
    guildId: 'local',
    channelId: session.roomId || 'music',
    queue: session.queue.map((track, index) => playlistItemToWatchRequest(track, index + 1)),
    current,
    playback: {
      status: session.playback.status === 'ready' ? 'paused' : session.playback.status,
      position: session.playback.position,
      updatedAt: session.playback.updatedAt,
      muted: true,
    },
    events: [],
    roomUrl: preferredBaseUrl ? `${preferredBaseUrl.replace(/\/$/, '')}/rooms/${session.roomId}` : undefined,
  };
}
