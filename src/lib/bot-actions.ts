'use server';

import { exec } from 'child_process';
import util from 'util';
const execAsync = util.promisify(exec);
import { PlaylistItem } from "@/types/playlist";
import { db, ensureDb } from '@/lib/db';

const YT_DLP = process.env.YT_DLP_PATH
  || 'C:\\Users\\mtman\\AppData\\Local\\Microsoft\\WinGet\\Packages\\yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe\\yt-dlp.exe';

function simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash |= 0;
    }
    return Math.abs(hash);
}

function selectArtId(videoId: string): string {
    const artIds = ["album-art-1", "album-art-2", "album-art-3"];
    if (!videoId) return artIds[0];
    return artIds[simpleHash(videoId) % artIds.length];
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
    let videosToAdd: PlaylistItem[] = [];

    console.log(`[!sr YT-DLP] Query: ${songQuery} (URL: ${isUrl})`);

    try {
      const searchQuery = isUrl ? songQuery : `ytsearch1:${songQuery}`;
      const { stdout } = await execAsync(`"${YT_DLP}" --dump-json --no-download --flat-playlist "${searchQuery}"`);
      const lines = stdout.trim().split('\n').filter(Boolean);
      
      console.log(`[!sr YT-DLP] Found ${lines.length} result(s)`);

      if (lines.length === 0) {
        return { success: false, message: `I couldn't find any songs for "${songQuery}". Try a different search.` };
      }

      const videoJson = JSON.parse(lines[0]);
      const videoId = videoJson.id || videoJson.webpage_url_match?.[0];
      videosToAdd.push({
        id: videoId!,
        title: videoJson.title || 'Untitled',
        artist: videoJson.uploader || videoJson.channel || 'Unknown Artist',
        url: videoJson.webpage_url || videoJson.url || songQuery,
        artId: selectArtId(videoId),
        duration: (videoJson.duration || 180) * 1000,
        addedBy: requester,
        addedAt: new Date(),
        plays: 0,
        source: 'web' as const,
      });

      console.log(`[!sr YT-DLP] Selected: ${videoJson.title} (${videoId})`);

    } catch (e: any) {
      console.error(`[!sr YT-DLP] Failed:`, e.message);
      return { success: false, message: `YouTube lookup failed: ${e.message}. Try a URL or different song name.` };
    }

    if (videosToAdd.length === 0) return { success: false, message: `I couldn't find any songs for "${songQuery}".` };

    const room = db.get('rooms', roomId);
    if (!room) return { success: false, message: 'Room not found.' };

    const playlist = room.playlist || [];
    const newPlaylist = [...playlist, ...videosToAdd];
    const updates: any = { playlist: newPlaylist };

    if ((!room.isPlaying || !room.currentTrackId) && videosToAdd.length > 0) {
      updates.currentTrackId = videosToAdd[0].id;
      updates.isPlaying = true;
    }

    // Save playlist update to DB
    db.update('rooms', roomId, updates);
    console.log(`[!sr DEBUG] Saved playlist to DB for room ${roomId}`);

    console.log(`[!sr DEBUG] Triggering ripper for room ${roomId}, videoId ${videosToAdd[0]?.id}`);
    
    // Trigger ripper API
    try {
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001';
      const res = await fetch(`${baseUrl}/api/rip-trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          roomId, 
          videoId: updates.currentTrackId,
          youtubeUrl: videosToAdd[0]?.url 
        })
      });
      console.log(`[!sr DEBUG] rip-trigger API response:`, await res.json());
    } catch (err) {
      console.error(`[!sr DEBUG] rip-trigger API failed:`, err);
    }

    // Frontend will sync playlist via useDoc
    return {
      success: true,
      message: videosToAdd.length > 1
        ? `Queued up ${videosToAdd.length} songs from the playlist.`
        : `Queued up: "${videosToAdd[0].title}"`,
    };
  } catch (error: any) {
    console.error(`Error processing song request for room ${roomId}:`, error);
    return { success: false, message: 'An internal error occurred while processing your request.' };
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
