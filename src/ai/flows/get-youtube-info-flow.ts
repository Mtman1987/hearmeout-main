'use server';

import { z } from 'zod';
import { PlaylistItem } from '@/types/playlist';
import { YouTube } from 'youtube-sr';

const GetYoutubeInfoInputSchema = z.object({
  url: z.string().describe('The YouTube URL or search query for a video or playlist.'),
});
export type GetYoutubeInfoInput = z.infer<typeof GetYoutubeInfoInputSchema>;

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
  const artIds = ['album-art-1', 'album-art-2', 'album-art-3'];
  if (!videoId) return artIds[0];
  return artIds[simpleHash(videoId) % artIds.length];
}

export async function getYoutubeInfo(input: GetYoutubeInfoInput): Promise<PlaylistItem[] | null> {
  try {
    const isUrl = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.+/.test(input.url);
    let videos: any[] = [];

    if (isUrl) {
      const isPlaylistUrl = /[?&]list=/.test(input.url);
      if (isPlaylistUrl) {
        try {
          const playlist = await YouTube.getPlaylist(input.url, { fetchAll: true });
          if (!playlist || playlist.videos.length === 0) return null;
          videos = playlist.videos.filter(v => v?.id);
        } catch (err) {
          console.error('[YouTube Playlist] Error:', err);
          return null;
        }
      } else {
        try {
          const video = await YouTube.getVideo(input.url);
          if (!video) return null;
          videos.push(video);
        } catch (err) {
          console.error('[YouTube Video] Error:', err);
          return null;
        }
      }
    } else {
      try {
        const searchResults = await YouTube.search(input.url, { limit: 3, type: 'video' });
        const valid = searchResults?.filter(v => v?.id && v?.title);
        if (!valid?.length) return null;
        videos.push(valid[0]);
      } catch (searchErr) {
        console.error('[YouTube Search] Error:', searchErr);
        return null;
      }
    }

    if (videos.length === 0) return null;

    return videos.filter(v => v && v.id).map((video): PlaylistItem => ({
      id: video.id!,
      title: video.title || 'Unknown Title',
      artist: video.channel?.name || 'Unknown Artist',
      artId: selectArtId(video.id!),
      thumbnail: video.thumbnail?.url || `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`,
      url: video.url,
      duration: (video.duration || 0) / 1000,
      addedBy: 'system',
      addedAt: new Date(),
      plays: 0,
      source: 'web' as const,
    }));
  } catch (error) {
    console.error('getYoutubeInfo error:', error);
    return null;
  }
}
