'use server';
/**
 * @fileOverview A flow to fetch metadata about YouTube videos.
 * It uses youtube-sr for searching and metadata.
 *
 * - getYoutubeInfo - A function that handles the entire process.
 * - GetYoutubeInfoInput - The input type for the getYoutubeInfo function.
 * - GetYoutubeInfoOutput - The return type for the getYoutubeInfo function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'zod';
import { PlaylistItem } from '@/types/playlist';
import { YouTube } from 'youtube-sr';

// --- Types and Schemas ---

const GetYoutubeInfoInputSchema = z.object({
  url: z.string().describe('The YouTube URL or search query for a video or playlist.'),
});
export type GetYoutubeInfoInput = z.infer<typeof GetYoutubeInfoInputSchema>;

const PlaylistItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  artId: z.string(),
  url: z.string(), // This will now be the original YouTube URL
  duration: z.number(),
});

const GetYoutubeInfoOutputSchema = z.array(PlaylistItemSchema);
export type GetYoutubeInfoOutput = z.infer<typeof GetYoutubeInfoOutputSchema>;


// --- Main exported function ---

export async function getYoutubeInfo(
  input: GetYoutubeInfoInput
): Promise<GetYoutubeInfoOutput> {
  return getYoutubeInfoFlow(input);
}


// --- Helper Functions ---

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
  const hash = simpleHash(videoId);
  return artIds[hash % artIds.length];
}

// --- Genkit Flow ---

const getYoutubeInfoFlow = ai.defineFlow(
  {
    name: 'getYoutubeInfoFlow',
    inputSchema: GetYoutubeInfoInputSchema,
    outputSchema: GetYoutubeInfoOutputSchema,
  },
  async (input) => {
    try {
        // Validate input is a YouTube URL
        const isUrl = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.?be)\/.+/.test(input.url);
        let videos: any[] = [];

        if (isUrl) {
            const isPlaylistUrl = /[?&]list=/.test(input.url);
            if (isPlaylistUrl) {
                // Fetching all videos can be slow, let's limit it for now.
                const playlist = await YouTube.getPlaylist(input.url, { fetchAll: true });
                if (!playlist || playlist.videos.length === 0) {
                    throw new Error(`I couldn't find that playlist or it's empty.`);
                }
                videos = playlist.videos;
            } else {
                const video = await YouTube.getVideo(input.url);
                if (!video) {
                    throw new Error(`I couldn't find a video at that URL.`);
                }
                videos.push(video);
            }
        } else {
            const searchResults = await YouTube.search(input.url, { limit: 1, type: 'video' });
            if (!searchResults || searchResults.length === 0) {
                throw new Error(`I couldn't find any songs matching "${input.url}".`);
            }
            videos.push(searchResults[0]);
        }
        
        if (videos.length === 0) {
            throw new Error(`I couldn't find any songs for "${input.url}".`);
        }

        const playlistItems = videos
            .filter(video => video && video.id)
            .map((video): PlaylistItem => {
                return {
                    id: video.id!,
                    title: video.title || 'Unknown Title',
                    artist: video.channel?.name || 'Unknown Artist',
                    artId: selectArtId(video.id!),
                    url: video.url, // The original YouTube URL
                    duration: (video.duration || 0) / 1000,
                    addedBy: 'system',
                    addedAt: new Date(),
                    plays: 0,
                    source: 'web' as const,
                };
            });

        return playlistItems;

    } catch (error) {
      console.error('An error occurred in the getYoutubeInfoFlow:', error);
      if (error instanceof Error) {
        throw new Error(`Failed to process request: ${error.message}`);
      }
      throw new Error('An unknown error occurred while fetching song info.');
    }
  }
);
