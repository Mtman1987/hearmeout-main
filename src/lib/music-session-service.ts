import type { PlaylistItem } from '@/types/playlist';
import { addSongToPlaylist, skipTrack } from '@/lib/bot-actions';
import { db, ensureDb } from '@/lib/db';
import { getGlobalMusicRoomId } from '@/lib/music-session';

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
  const roomId = getGlobalMusicRoomId();
  const existing = db.get('rooms', roomId);
  if (!existing) {
    db.set('rooms', roomId, {
      name: 'Main Music Room',
      ownerId: 'admin',
      playlist: [],
      currentTrackId: '',
      isPlaying: false,
      musicPlaybackPosition: 0,
      musicPlaybackUpdatedAt: Date.now(),
      createdAt: new Date().toISOString(),
    });
  }
  return roomId;
}

function getSessionFromRoom(roomId: string, room: any): MusicSession {
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
  const room = db.get('rooms', roomId) || {};
  return getSessionFromRoom(roomId, room);
}

export async function requestMusicItem(params: {
  query: string;
  username: string;
  platform: 'discord' | 'twitch' | 'admin' | 'activity' | 'web';
}) {
  const roomId = await ensureGlobalMusicRoom();
  const requester = `${params.username} (${params.platform})`;
  const result = await addSongToPlaylist(params.query, roomId, requester);
  return {
    result,
    session: await getGlobalMusicSession(),
  };
}

export async function controlGlobalMusicSession(action: string, position = 0) {
  const roomId = await ensureGlobalMusicRoom();
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
