'use server';

import { db } from '@/firebase/admin';
import { YouTube } from 'youtube-sr';
import { PlaylistItem } from "@/types/playlist";

// A simple deterministic hash function to select album art from the existing set
function simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash |= 0; // Convert to 32bit integer
    }
    return Math.abs(hash);
}

function selectArtId(videoId: string): string {
    const artIds = ["album-art-1", "album-art-2", "album-art-3"];
    if (!videoId) return artIds[0];
    const hash = simpleHash(videoId);
    return artIds[hash % artIds.length];
}

/**
 * Searches for a song/playlist on YouTube and adds it to the specified room's playlist in Firestore.
 * @param songQuery The search term or YouTube URL.
 * @param roomId The ID of the room to add the song to.
 * @param requester The name of the user who requested the song.
 * @returns A promise that resolves to an object with a success flag and a message.
 */
export async function addSongToPlaylist(
  songQuery: string, 
  roomId: string, 
  requester: string
): Promise<{ success: boolean; message: string }> {
  if (!roomId) {
    return { success: false, message: 'No room ID provided.' };
  }
  
  const roomRef = db.collection('rooms').doc(roomId);

  try {
    // Validate input is a YouTube URL or search query
    const isUrl = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.+/.test(songQuery);
    let videosToAdd: PlaylistItem[] = [];

    if (isUrl) {
        // Check if it's a playlist URL
        const isPlaylistUrl = /[?&]list=/.test(songQuery);
        if (isPlaylistUrl) {
            const playlist = await YouTube.getPlaylist(songQuery);
            if (!playlist || playlist.videos.length === 0) {
                 return { success: false, message: `I couldn't find that playlist or it's empty.` };
            }
            videosToAdd = playlist.videos.map(video => ({
                id: video.id!,
                title: video.title || 'Untitled',
                artist: video.channel?.name || 'Unknown Artist',
                url: video.url,
                artId: selectArtId(video.id!),
                duration: video.duration / 1000,
                addedBy: requester,
                addedAt: new Date(),
                plays: 0,
                source: 'web' as const,
            }));

        } else {
            const video = await YouTube.getVideo(songQuery);
             if (!video || !video.id) {
                return { success: false, message: `I couldn't find a video at that URL.` };
            }
            videosToAdd.push({
                id: video.id,
                title: video.title || 'Untitled',
                artist: video.channel?.name || 'Unknown Artist',
                url: video.url,
                artId: selectArtId(video.id),
                duration: video.duration / 1000,
                addedBy: requester,
                addedAt: new Date(),
                plays: 0,
                source: 'web' as const,
            });
        }
    } else {
        const searchResults = await YouTube.search(songQuery, { limit: 1, type: 'video' });
        if (!searchResults || searchResults.length === 0 || !searchResults[0].id) {
            return { success: false, message: `I couldn't find a song matching "${songQuery}".` };
        }
        const video = searchResults[0];
        videosToAdd.push({
            id: video.id!,
            title: video.title || 'Untitled',
            artist: video.channel?.name || 'Unknown Artist',
            url: video.url,
            artId: selectArtId(video.id!),
            duration: video.duration / 1000,
            addedBy: requester,
            addedAt: new Date(),
            plays: 0,
            source: 'web' as const,
        });
    }
    
    if (videosToAdd.length === 0) {
        return { success: false, message: `I couldn't find any songs for "${songQuery}".` };
    }

    const firstSongAdded = videosToAdd[0];

    await db.runTransaction(async (transaction) => {
      const roomDoc = await transaction.get(roomRef);
      if (!roomDoc.exists) {
        throw new Error(`Room with ID ${roomId} does not exist.`);
      }
      const roomData = roomDoc.data();
      const currentPlaylist = roomData?.playlist || [];
      const newPlaylist = [...currentPlaylist, ...videosToAdd];
      
      const updates: { 
        playlist: PlaylistItem[]; 
        isPlaying?: boolean; 
        currentTrackId?: string;
      } = {
          playlist: newPlaylist
      };

      // If nothing is playing and there was no playlist before, start playing the new song.
      if (!roomData?.isPlaying && currentPlaylist.length === 0) {
          updates.isPlaying = true;
          updates.currentTrackId = firstSongAdded.id;
      }
      
      transaction.update(roomRef, updates);
    });

    const message = videosToAdd.length > 1
        ? `Queued up ${videosToAdd.length} songs from the playlist.`
        : `Queued up: "${firstSongAdded.title}"`;

    return { success: true, message };

  } catch (error: any) {
    console.error(`Error processing song request for room ${roomId}:`, error);
    return { success: false, message: 'An internal error occurred while processing your request.' };
  }
}

/**
 * Toggles the play/pause state of the current track
 * @param roomId The ID of the room
 * @returns Result object with success flag and message
 */
export async function updateRoomPlayState(
  roomId: string, 
  isPlaying: boolean
): Promise<{ success: boolean; message: string }> {
  if (!roomId) {
    return { success: false, message: 'No room ID provided.' };
  }

  try {
    const roomRef = db.collection('rooms').doc(roomId);
    const roomDoc = await roomRef.get();

    if (!roomDoc.exists) {
      return { success: false, message: 'Room not found.' };
    }

    const roomData = roomDoc.data();
    if (!roomData?.currentTrackId) {
      return { success: false, message: 'No track is currently selected.' };
    }

    await roomRef.update({ isPlaying });

    const status = isPlaying ? 'Playing' : 'Paused';
    const trackTitle = roomData.playlist
      ?.find((t: any) => t.id === roomData.currentTrackId)
      ?.title || 'Current track';
    
    return { success: true, message: `${status}: "${trackTitle}"` };
  } catch (error: any) {
    console.error(`Error updating play state for room ${roomId}:`, error);
    return { success: false, message: 'Error updating playback state.' };
  }
}

/**
 * Skips to the next track in the playlist
 * @param roomId The ID of the room
 * @returns Result object with success flag and message
 */
export async function skipTrack(roomId: string): Promise<{ success: boolean; message: string }> {
  if (!roomId) {
    return { success: false, message: 'No room ID provided.' };
  }

  try {
    const roomRef = db.collection('rooms').doc(roomId);
    
    await db.runTransaction(async (transaction) => {
      const roomDoc = await transaction.get(roomRef);

      if (!roomDoc.exists) {
        throw new Error('Room not found.');
      }

      const roomData = roomDoc.data();
      const playlist = roomData?.playlist || [];
      const currentTrackId = roomData?.currentTrackId;

      if (!playlist.length) {
        throw new Error('Playlist is empty.');
      }

      const currentIndex = playlist.findIndex((t: any) => t.id === currentTrackId);
      const nextIndex = (currentIndex + 1) % playlist.length;
      const nextTrack = playlist[nextIndex];

      transaction.update(roomRef, {
        currentTrackId: nextTrack.id,
        isPlaying: true,
      });
    });

    return { success: true, message: 'Skipped to next track.' };
  } catch (error: any) {
    console.error(`Error skipping track in room ${roomId}:`, error);
    return { success: false, message: error.message || 'Error skipping track.' };
  }
}

/**
 * Gets current room state (for bot status checks)
 * @param roomId The ID of the room
 */
export async function getRoomState(roomId: string) {
  if (!roomId) {
    return null;
  }

  try {
    const roomDoc = await db.collection('rooms').doc(roomId).get();
    if (!roomDoc.exists) {
      return null;
    }

    const data = roomDoc.data();
    const currentTrack = data?.playlist?.find((t: any) => t.id === data?.currentTrackId);

    return {
      isPlaying: data?.isPlaying || false,
      currentTrack: currentTrack || null,
      playlistLength: data?.playlist?.length || 0,
      djDisplayName: data?.djDisplayName || 'No DJ',
    };
  } catch (error) {
    console.error(`Error getting room state for ${roomId}:`, error);
    return null;
  }
}
