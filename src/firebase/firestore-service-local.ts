import { getDoc, setDoc, deleteDoc } from '../../local-db';
import { PlaylistItem } from '@/types/playlist';

export const roomService = {
  async getRoom(roomId: string) {
    return getDoc('rooms', roomId);
  },

  async updateRoom(roomId: string, updates: any) {
    const room = getDoc('rooms', roomId) || {};
    setDoc('rooms', roomId, { ...room, ...updates });
  },

  async deleteRoom(roomId: string) {
    deleteDoc('rooms', roomId);
  },

  async addSongToPlaylist(roomId: string, song: PlaylistItem) {
    const room = getDoc('rooms', roomId) || {};
    const playlist = room.playlist || [];
    const updates: any = { playlist: [...playlist, song] };
    if (!room.isPlaying && playlist.length === 0) {
      updates.isPlaying = true;
      updates.currentTrackId = song.id;
    }
    setDoc('rooms', roomId, { ...room, ...updates });
  },

  async updatePlayState(roomId: string, isPlaying: boolean) {
    const room = getDoc('rooms', roomId) || {};
    setDoc('rooms', roomId, { ...room, isPlaying });
  },

  async setCurrentTrack(roomId: string, trackId: string) {
    const room = getDoc('rooms', roomId) || {};
    setDoc('rooms', roomId, { ...room, currentTrackId: trackId, isPlaying: true });
  },
};

export const userService = {
  async getUser(userId: string) {
    return getDoc('users', userId);
  },

  async updateUser(userId: string, updates: any) {
    const user = getDoc('users', userId) || {};
    setDoc('users', userId, { ...user, ...updates });
  },
};
