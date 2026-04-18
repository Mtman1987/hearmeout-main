'use server';

import { PlaylistItem } from "@/types/playlist";
import { db, ensureDb } from '@/lib/db';
import YouTube from 'youtube-sr';

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function selectArtId(videoId: string): string {
  const artIds = ["album-art-1", "album-art-2", "album-art-3"];
  return artIds[simpleHash(videoId || '') % artIds.length];
}

export async function addSongToPlaylist(
  songQuery: string,
  roomId: string,
  requester: string
): Promise<{ success: boolean; message: string }> {
  if (!roomId) return { success: false, message: 'No room ID provided.' };

  try {
    await ensureDb();
    const isUrl = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.+/.test(songQuery);

    let videoId: string;
    let title: string;
    let artist: string;
    let url: string;
    let thumbnail: string | undefined;
    let duration: number;

    if (isUrl) {
      // Extract video ID from URL
      try {
        const video = await YouTube.getVideo(songQuery);
        if (!video) return { success: false, message: 'Could not load that YouTube URL.' };
        videoId = video.id!;
        title = video.title || 'Untitled';
        artist = video.channel?.name || 'Unknown Artist';
        url = video.url;
        thumbnail = video.thumbnail?.url;
        duration = video.duration || 180000;
      } catch {
        // Fallback: parse ID from URL directly
        const u = new URL(songQuery);
        videoId = u.searchParams.get('v') || u.pathname.slice(1);
        title = songQuery;
        artist = 'Unknown';
        url = songQuery;
        duration = 180000;
      }
    } else {
      // Search YouTube
      const results = await YouTube.search(songQuery, { limit: 1, type: 'video' });
      if (!results.length) {
        return { success: false, message: `No results for "${songQuery}". Try a different search.` };
      }
      const video = results[0];
      videoId = video.id!;
      title = video.title || 'Untitled';
      artist = video.channel?.name || 'Unknown Artist';
      url = video.url;
      thumbnail = video.thumbnail?.url;
      duration = video.duration || 180000;
    }

    console.log(`[!sr] Found: "${title}" by ${artist} (${videoId})`);

    const newTrack: PlaylistItem = {
      id: videoId,
      title,
      artist,
      url,
      thumbnail,
      artId: selectArtId(videoId),
      duration,
      addedBy: requester,
      addedAt: new Date(),
      plays: 0,
      source: 'web' as const,
    };

    const room = db.get('rooms', roomId);
    if (!room) return { success: false, message: 'Room not found.' };

    const playlist = room.playlist || [];
    const newPlaylist = [...playlist, newTrack];
    const updates: any = { playlist: newPlaylist };

    if (!room.isPlaying || !room.currentTrackId) {
      updates.currentTrackId = videoId;
      updates.isPlaying = true;
    }

    db.update('rooms', roomId, updates);
    console.log(`[!sr] Queued "${title}" in room ${roomId}`);

    return { success: true, message: `Queued up: "${title}"` };
  } catch (error: any) {
    console.error(`[!sr] Error:`, error);
    return { success: false, message: 'An internal error occurred.' };
  }
}

export async function updateRoomPlayState(roomId: string, isPlaying: boolean): Promise<{ success: boolean; message: string }> {
  if (!roomId) return { success: false, message: 'No room ID provided.' };
  await ensureDb();
  const room = db.get('rooms', roomId);
  if (!room) return { success: false, message: 'Room not found.' };
  if (!room.currentTrackId) return { success: false, message: 'No track is currently selected.' };
  db.update('rooms', roomId, { isPlaying });
  const trackTitle = room.playlist?.find((t: any) => t.id === room.currentTrackId)?.title || 'Current track';
  return { success: true, message: `${isPlaying ? 'Playing' : 'Paused'}: "${trackTitle}"` };
}

export async function skipTrack(roomId: string): Promise<{ success: boolean; message: string }> {
  if (!roomId) return { success: false, message: 'No room ID provided.' };
  await ensureDb();
  const room = db.get('rooms', roomId);
  if (!room) return { success: false, message: 'Room not found.' };
  const playlist = room.playlist || [];
  if (!playlist.length) return { success: false, message: 'Playlist is empty.' };
  const currentIndex = playlist.findIndex((t: any) => t.id === room.currentTrackId);
  const nextTrack = playlist[(currentIndex + 1) % playlist.length];
  db.update('rooms', roomId, { currentTrackId: nextTrack.id, isPlaying: true });
  return { success: true, message: 'Skipped to next track.' };
}

export async function getRoomState(roomId: string) {
  if (!roomId) return null;
  await ensureDb();
  const data = db.get('rooms', roomId);
  if (!data) return null;
  return {
    isPlaying: data.isPlaying || false,
    currentTrack: data.playlist?.find((t: any) => t.id === data.currentTrackId) || null,
    playlistLength: data.playlist?.length || 0,
    djDisplayName: data.djDisplayName || 'No DJ',
  };
}
