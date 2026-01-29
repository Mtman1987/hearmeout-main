import { db } from './admin';
import { PlaylistItem } from '@/types/playlist';

export const roomService = {
  async getRoom(roomId: string) {
    const doc = await db.collection('rooms').doc(roomId).get();
    return doc.exists ? doc.data() : null;
  },

  async updateRoom(roomId: string, updates: any) {
    await db.collection('rooms').doc(roomId).update(updates);
  },

  async deleteRoom(roomId: string) {
    await db.collection('rooms').doc(roomId).delete();
  },

  async addSongToPlaylist(roomId: string, song: PlaylistItem) {
    const roomRef = db.collection('rooms').doc(roomId);
    await db.runTransaction(async (transaction) => {
      const roomDoc = await transaction.get(roomRef);
      if (!roomDoc.exists) throw new Error('Room not found');
      
      const data = roomDoc.data();
      const playlist = data?.playlist || [];
      const updates: any = { playlist: [...playlist, song] };
      
      if (!data?.isPlaying && playlist.length === 0) {
        updates.isPlaying = true;
        updates.currentTrackId = song.id;
      }
      
      transaction.update(roomRef, updates);
    });
  },

  async updatePlayState(roomId: string, isPlaying: boolean) {
    await db.collection('rooms').doc(roomId).update({ isPlaying });
  },

  async setCurrentTrack(roomId: string, trackId: string) {
    await db.collection('rooms').doc(roomId).update({
      currentTrackId: trackId,
      isPlaying: true,
    });
  },
};

export const userService = {
  async getUser(userId: string) {
    const doc = await db.collection('users').doc(userId).get();
    return doc.exists ? doc.data() : null;
  },

  async updateUser(userId: string, updates: any) {
    await db.collection('users').doc(userId).update(updates);
  },
};
