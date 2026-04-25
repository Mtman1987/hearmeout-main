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
      try {
        const results = await YouTube.search(songQuery, { limit: 3, type: 'video' });
        const valid = results?.filter(v => v?.id && v?.title);
        if (!valid?.length) {
          return { success: false, message: `No results for "${songQuery}". Try a different search.` };
        }
        const video = valid[0];
        videoId = video.id!;
        title = video.title || 'Untitled';
        artist = video.channel?.name || 'Unknown Artist';
        url = video.url;
        thumbnail = video.thumbnail?.url;
        duration = video.duration || 180000;
      } catch (searchErr) {
        console.error('[!sr] YouTube search error:', searchErr);
        return { success: false, message: `Search failed for "${songQuery}". Try a YouTube URL instead.` };
      }
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
      if (room.currentTrackId) {
        updates.playHistory = [...(room.playHistory || []), room.currentTrackId].slice(-50);
      }
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
  const updates: any = { currentTrackId: nextTrack.id, isPlaying: true };
  if (room.currentTrackId) {
    updates.playHistory = [...(room.playHistory || []), room.currentTrackId].slice(-50);
  }
  db.update('rooms', roomId, updates);
  return { success: true, message: 'Skipped to next track.' };
}

export async function autoRadioNext(roomId: string): Promise<{ success: boolean; message: string }> {
  if (!roomId) return { success: false, message: 'No room ID provided.' };
  await ensureDb();
  const room = db.get('rooms', roomId);
  if (!room) return { success: false, message: 'Room not found.' };
  if (!room.autoRadio) return { success: false, message: 'Auto-radio is not enabled.' };

  const playHistory: string[] = room.playHistory || [];
  const playlist: PlaylistItem[] = room.playlist || [];
  const recentTracks = [...playlist].reverse().slice(0, 8);

  const recentHistory = playHistory.slice(-25);
  const historyIds = new Set<string>([
    ...recentHistory,
    ...(room.currentTrackId ? [room.currentTrackId] : []),
  ]);

  const seedQueries = new Set<string>();
  seedQueries.add('music');
  seedQueries.add('official audio');
  seedQueries.add('radio edit');

  if (recentTracks.length > 0) {
    const seed = recentTracks[Math.floor(Math.random() * recentTracks.length)];
    if (seed.artist && seed.artist !== 'Unknown Artist' && seed.artist !== 'Unknown') {
      seedQueries.add(`${seed.artist} music`);
      seedQueries.add(`${seed.artist} official audio`);
      seedQueries.add(`${seed.artist} topic`);
    }
    if (seed.title) {
      seedQueries.add(seed.title);
    }
  }

  const queries = Array.from(seedQueries);

  try {
    for (const seedQuery of queries) {
      const results = await YouTube.search(seedQuery, { limit: 10, type: 'video' });
      const candidates = (results || []).filter((v) => v?.id && v?.title && !historyIds.has(v.id!));

      if (!candidates.length) {
        continue;
      }

      const video = candidates[Math.floor(Math.random() * Math.min(candidates.length, 5))];
      const videoId = video.id!;
      const newTrack: PlaylistItem = {
        id: videoId,
        title: video.title || 'Untitled',
        artist: video.channel?.name || 'Unknown Artist',
        url: video.url,
        thumbnail: video.thumbnail?.url,
        artId: selectArtId(videoId),
        duration: video.duration || 180000,
        addedBy: 'Auto-Radio',
        addedAt: new Date(),
        plays: 0,
        source: 'web' as const,
      };

      const newPlaylist = [...playlist, newTrack];
      const historySeed = room.currentTrackId
        ? [...playHistory, room.currentTrackId]
        : playHistory;
      const newHistory = [...historySeed, videoId].slice(-50);

      db.update('rooms', roomId, {
        playlist: newPlaylist,
        currentTrackId: videoId,
        isPlaying: true,
        playHistory: newHistory,
      });

      return { success: true, message: `Auto-radio queued: "${newTrack.title}"` };
    }

    const fallbackQuery = recentTracks[0]?.title || recentTracks[0]?.artist || 'music';
    const fallbackResults = await YouTube.search(fallbackQuery, { limit: 10, type: 'video' });
    const fallbackCandidates = (fallbackResults || []).filter((v) => v?.id && v?.title);

    if (!fallbackCandidates.length) {
      return { success: false, message: 'No new songs found for auto-radio.' };
    }

    const video = fallbackCandidates.find((v) => !historyIds.has(v.id!)) || fallbackCandidates[0];
    const videoId = video.id!;
    const newTrack: PlaylistItem = {
      id: videoId,
      title: video.title || 'Untitled',
      artist: video.channel?.name || 'Unknown Artist',
      url: video.url,
      thumbnail: video.thumbnail?.url,
      artId: selectArtId(videoId),
      duration: video.duration || 180000,
      addedBy: 'Auto-Radio',
      addedAt: new Date(),
      plays: 0,
      source: 'web' as const,
    };

    const newPlaylist = [...playlist, newTrack];
    const historySeed = room.currentTrackId
      ? [...playHistory, room.currentTrackId]
      : playHistory;
    const newHistory = [...historySeed, videoId].slice(-50);

    db.update('rooms', roomId, {
      playlist: newPlaylist,
      currentTrackId: videoId,
      isPlaying: true,
      playHistory: newHistory,
    });

    return { success: true, message: `Auto-radio queued: "${newTrack.title}"` };
  } catch (error: any) {
    console.error('[Auto-Radio] Error:', error);
    return { success: false, message: 'Auto-radio search failed.' };
  }
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
