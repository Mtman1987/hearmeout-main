// Firebase Firestore service removed — using shared SQLite
import { db } from '@/lib/db';

export const roomService = {
  async getRoom(roomId: string) { return db.get('rooms', roomId); },
  async updateRoom(roomId: string, updates: any) { db.update('rooms', roomId, updates); },
  async deleteRoom(roomId: string) { db.delete('rooms', roomId); },
  async addSongToPlaylist(roomId: string, song: any) {
    const room = db.get('rooms', roomId) || {};
    const playlist = room.playlist || [];
    const updates: any = { playlist: [...playlist, song] };
    if (!room.isPlaying && playlist.length === 0) { updates.isPlaying = true; updates.currentTrackId = song.id; }
    db.update('rooms', roomId, updates);
  },
  async updatePlayState(roomId: string, isPlaying: boolean) { db.update('rooms', roomId, { isPlaying }); },
  async setCurrentTrack(roomId: string, trackId: string) { db.update('rooms', roomId, { currentTrackId: trackId, isPlaying: true }); },
};

export const userService = {
  async getUser(userId: string) { return db.get('users', userId); },
  async updateUser(userId: string, updates: any) { db.update('users', userId, updates); },
};
