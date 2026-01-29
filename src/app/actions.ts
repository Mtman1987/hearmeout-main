"use server";

import { moderateContent } from "@/ai/flows/sentiment-based-moderation";
import type { ModerateContentOutput } from "@/ai/flows/sentiment-based-moderation";
import { getYoutubeInfo as getYoutubeInfoFlow } from "@/ai/flows/get-youtube-info-flow";
import type { PlaylistItem } from "@/types/playlist";
import { AccessToken } from 'livekit-server-sdk';
import { sendControlEmbed } from '@/bots/discord-bot';

export async function runModeration(
  conversationHistory: string
): Promise<ModerateContentOutput> {
  try {
    const result = await moderateContent({ conversationHistory });
    return result;
  } catch (error) {
    console.error("Error running moderation:", error);
    return {
      overallSentiment: "Error",
      isHarmful: true,
      alertReason: "Failed to analyze content.",
    };
  }
}

export async function getYoutubeInfo(query: string): Promise<PlaylistItem[] | null> {
  try {
    const result = await getYoutubeInfoFlow({ url: query }) as PlaylistItem[] | null;
    return result;
  } catch (error) {
    console.error("Error getting YouTube info:", error);
    return null;
  }
}

export async function generateLiveKitToken(roomName: string, participantIdentity: string, participantName: string, participantMetadata: string) {
  try {
    // Check environment variables
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const livekitUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;

    console.log('[generateLiveKitToken] Checking environment variables...');
    console.log('[generateLiveKitToken] LIVEKIT_API_KEY exists:', !!apiKey);
    console.log('[generateLiveKitToken] LIVEKIT_API_SECRET exists:', !!apiSecret);
    console.log('[generateLiveKitToken] NEXT_PUBLIC_LIVEKIT_URL:', livekitUrl);

    if (!apiKey) {
      throw new Error('LIVEKIT_API_KEY is not configured in environment variables.');
    }
    if (!apiSecret) {
      throw new Error('LIVEKIT_API_SECRET is not configured in environment variables.');
    }
    if (!livekitUrl) {
      throw new Error('NEXT_PUBLIC_LIVEKIT_URL is not configured in environment variables.');
    }

    console.log('[generateLiveKitToken] Creating token for room:', roomName, 'participant:', participantIdentity);

    const at = new AccessToken(apiKey, apiSecret, {
      identity: participantIdentity,
      name: participantName,
      metadata: participantMetadata,
      ttl: '10m', // The token is valid for 10 minutes
    });

    at.addGrant({ room: roomName, roomJoin: true, canPublish: true, canSubscribe: true });
    const token = at.toJwt();

    console.log('[generateLiveKitToken] Token generated successfully');
    return token;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[generateLiveKitToken] Error:', errorMessage);
    throw error;
  }
}

export async function postToDiscord(
  channelId: string, 
  roomId: string,
  roomName: string,
  description?: string,
  link1Label?: string,
  link1Url?: string,
  link2Label?: string,
  link2Url?: string
) {
    if (!channelId) {
        throw new Error("Channel ID is required.");
    }
    await sendControlEmbed(channelId, roomId, roomName, description, link1Label, link1Url, link2Label, link2Url);
}
